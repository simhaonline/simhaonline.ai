// Package api: gateway HTTP surface — /v1 proxy, /v1/models, /healthz, /status.
package api

import (
	"bytes"
	"context"
	crand "crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/simhaonline/gateway/internal/store"
)

// Config holds gateway runtime settings.
type Config struct {
	Addr            string
	CooldownSeconds int
	UsageThreshold  float64
	RefreshInterval time.Duration
	PolicyFile      string
	ProviderCatalog string
	PlatformAPI     string
	UpstreamTimeout time.Duration
	UpstreamDial    time.Duration
}

// Server wires the store and config into HTTP handlers.
type Server struct {
	st  *store.Store
	cfg Config
}

// New constructs the gateway server.
func New(st *store.Store, cfg Config) *Server {
	st.LoadPolicyFile(cfg.PolicyFile)
	return &Server{st: st, cfg: cfg}
}

// Handler builds the route table.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealthz)
	mux.HandleFunc("/status", s.handleStatus)
	mux.HandleFunc("/gateway-status", s.handleGatewayStatus)
	mux.HandleFunc("/internal/refresh-models", s.handleRefreshModels)
	mux.HandleFunc("/v1/models", s.handleModels)
	mux.HandleFunc("/v1/", s.handleProxy)
	mux.HandleFunc("/v1", s.handleProxy)
	mux.HandleFunc("/api/", s.handleProxy) // ollama-native passthrough
	mux.HandleFunc("/api", s.handleProxy)
	return requestID(mux)
}

// requestID middleware (legacy X-Request-ID header).
func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = randomID()
		}
		w.Header().Set("X-Request-ID", id)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		next.ServeHTTP(w, r)
	})
}

func randomID() string {
	b := make([]byte, 8)
	_, _ = crand.Read(b)
	return hex.EncodeToString(b)
}

// ---- authentication ----

// authCtx carries the resolved identity for a request.
type authCtx struct {
	UserID      *int64
	ClientKeyID *int64
}

// authorize replicates legacy authorize_request: session cookie is not used on
// the gateway (sessions live in the control-plane); client keys authenticate
// via Authorization: Bearer / X-API-Key / x-api-key (sha256 lookup).
func (s *Server) authorize(r *http.Request) (*authCtx, int, string) {
	supplied := r.Header.Get("Authorization")
	if supplied == "" {
		if v := r.Header.Get("X-API-Key"); v != "" {
			supplied = "Bearer " + v
		} else if v := r.Header.Get("x-api-key"); v != "" {
			supplied = "Bearer " + v
		}
	}
	raw := strings.TrimSpace(supplied)
	if low := strings.ToLower(raw); strings.HasPrefix(low, "bearer ") {
		raw = strings.TrimSpace(raw[7:])
	}
	if raw == "" {
		return nil, 401, "Unauthorized"
	}
	sum := sha256.Sum256([]byte(raw))
	hash := hex.EncodeToString(sum[:])
	ctx := r.Context()

	var id int64
	var owner sql.NullInt64
	var active bool
	var expires *time.Time
	err := s.st.Pool.QueryRow(ctx, `
		SELECT id, owner_user_id, active, expires_at FROM client_api_keys WHERE key_hash = $1`, hash).
		Scan(&id, &owner, &active, &expires)
	if err != nil {
		return nil, 401, "Unauthorized"
	}
	if !active || (expires != nil && expires.Before(time.Now())) {
		return nil, 401, "Unauthorized"
	}
	_ = s.st.TouchClientKey(ctx, id)
	ac := &authCtx{ClientKeyID: &id}
	if owner.Valid && owner.Int64 > 0 {
		ownerID := owner.Int64
		ac.UserID = &ownerID
		// plan quota check (daily request ceiling; unlimited when negative)
		if code2, msg2 := s.checkQuota(ctx, ownerID); code2 != 0 {
			return nil, code2, msg2
		}
	}
	return ac, 0, ""
}

// checkQuota enforces the user's plan daily + monthly limits via Valkey counters
// (limits JSON cached by the control-plane billing service under quota:limits:<uid>;
// counters live at quota:<uid>:<day> and quota:m:<uid>:<yyyy-mm>).
func (s *Server) checkQuota(ctx context.Context, userID int64) (int, string) {
	raw, err := s.st.Valkey.Do(ctx, s.st.Valkey.B().Get().Key(fmt.Sprintf("quota:limits:%d", userID)).Build()).ToString()
	if err != nil || raw == "" {
		return 0, "" // no plan info → allow (unconfigured/dev)
	}
	var lim struct {
		Plan string `json:"plan"`
		Rpd  int64  `json:"rpd"`
		Rpm  int64  `json:"rpm"`
		Rpmo int64  `json:"rmo"` // requests per month, -1 unlimited
	}
	if json.Unmarshal([]byte(raw), &lim) != nil {
		return 0, ""
	}
	month := time.Now().UTC().Format("2006-01")
	if lim.Rpmo > 0 {
		mkey := fmt.Sprintf("quota:m:%d:%s", userID, month)
		mn, _ := s.st.Valkey.Do(ctx, s.st.Valkey.B().Incr().Key(mkey).Build()).ToInt64()
		if mn == 1 {
			s.st.Valkey.Do(ctx, s.st.Valkey.B().Expire().Key(mkey).Seconds(2678400).Build())
		}
		if mn > lim.Rpmo {
			s.st.Valkey.Do(ctx, s.st.Valkey.B().Decr().Key(mkey).Build())
			return 429, "Plan monthly request limit reached — upgrade at https://simhaonline.ai/pricing"
		}
	}
	if lim.Rpd < 0 {
		return 0, "" // unlimited
	}
	day := time.Now().UTC().Format("2006-01-02")
	dkey := fmt.Sprintf("quota:%d:%s", userID, day)
	n, _ := s.st.Valkey.Do(ctx, s.st.Valkey.B().Incr().Key(dkey).Build()).ToInt64()
	if n == 1 {
		s.st.Valkey.Do(ctx, s.st.Valkey.B().Expire().Key(dkey).Seconds(172800).Build())
	}
	if n > lim.Rpd {
		// keep counter from drifting upward unboundedly on rejected calls
		s.st.Valkey.Do(ctx, s.st.Valkey.B().Decr().Key(dkey).Build())
		return 429, "Plan daily request limit reached — upgrade at https://simhaonline.ai/pricing"
	}
	return 0, ""
}

func (s *Server) unauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("WWW-Authenticate", "Bearer")
	w.WriteHeader(401)
	_, _ = w.Write([]byte(`{"error":"Unauthorized"}`))
}

// ---- simple endpoints ----

func (s *Server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"status": "ok", "service": "simha-edge-router"})
}

// handleRefreshModels lets the worker/control-plane trigger one discovery
// pass (rate-limited by the caller's own loop; the gateway holds no lock).
func (s *Server) handleRefreshModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, map[string]any{"error": "method not allowed"})
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		s.st.RefreshModels(ctx)
	}()
	writeJSON(w, 202, map[string]any{"ok": true, "started": true})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if _, code, msg := s.authorize(r); code != 0 {
		s.unauthorized(w)
		_ = msg
		return
	}
	ctx := r.Context()
	models := len(s.st.KnownModels(ctx))
	accounts := s.st.SnapshotAccountStatus(ctx)
	available := 0
	for _, a := range accounts {
		if !a.CoolingDown && a.HasCapacity {
			available++
		}
	}
	writeJSON(w, 200, map[string]any{
		"status":             "ok",
		"accounts":           len(accounts),
		"available_accounts": available,
		"models":             models,
	})
}

// handleGatewayStatus is the PUBLIC (unauthenticated) usage snapshot served at
// /gateway-status — safe to expose via Plesk for the status page and uptime monitors.
// It reports counts only, never keys or provider credentials.
func (s *Server) handleGatewayStatus(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	models := len(s.st.KnownModels(ctx))
	accounts := s.st.SnapshotAccountStatus(ctx)
	available := 0
	for _, a := range accounts {
		if !a.CoolingDown && a.HasCapacity {
			available++
		}
	}
	writeJSON(w, 200, map[string]any{
		"status":             "ok",
		"service":            "simha-edge-router",
		"accounts":           len(accounts),
		"available_accounts": available,
		"models":             models,
	})
}

func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	if _, code, _ := s.authorize(r); code != 0 {
		s.unauthorized(w)
		return
	}
	models := s.st.KnownModels(r.Context())
	data := make([]map[string]any, 0, len(models))
	for _, m := range models {
		data = append(data, map[string]any{"id": m, "object": "model", "owned_by": "proxy"})
	}
	writeJSON(w, 200, map[string]any{"object": "list", "data": data})
}

// ---- request optimization (legacy optimize_request) ----

// optimize applies the model policy: dedupe system messages + trim tool output.
func optimize(data map[string]any, policy store.Policy) (map[string]any, []string) {
	var changes []string
	messages, ok := data["messages"].([]any)
	if !ok {
		return data, changes
	}
	if policy.DedupeSystemMessages {
		seen := map[string]bool{}
		kept := make([]any, 0, len(messages))
		for _, m := range messages {
			mm, ok := m.(map[string]any)
			if !ok {
				kept = append(kept, m)
				continue
			}
			if role, _ := mm["role"].(string); role == "system" {
				content, _ := mm["content"].(string)
				if seen[content] {
					changes = append(changes, "duplicate_system_message_removed")
					continue
				}
				seen[content] = true
			}
			kept = append(kept, m)
		}
		messages = kept
	}
	limit := policy.MaxToolResultChars
	for i, m := range messages {
		mm, ok := m.(map[string]any)
		if !ok {
			continue
		}
		if role, _ := mm["role"].(string); role == "tool" {
			if content, ok := mm["content"].(string); ok && len(content) > limit {
				head := limit / 2
				tail := limit - head
				mm["content"] = content[:head] + "\n...[tool output trimmed by Simha Edge Router]...\n" + content[len(content)-tail:]
				messages[i] = mm
				changes = append(changes, "tool_output_trimmed")
			}
		}
	}
	data["messages"] = messages
	return data, changes
}

// ---- main proxy ----

func (s *Server) handleProxy(w http.ResponseWriter, r *http.Request) {
	ac, code, msg := s.authorize(r)
	if code != 0 {
		if code == 429 {
			w.Header().Set("Retry-After", "60")
			writeJSON(w, 429, map[string]any{"error": msg})
			return
		}
		s.unauthorized(w)
		return
	}
	ctx := r.Context()

	// native ollama passthrough lives under /api/*
	nativeAPI := r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/")
	apiPrefix := "/v1"
	protocol := "openai"
	path := strings.TrimPrefix(r.URL.Path, "/v1")
	if nativeAPI {
		apiPrefix = "/api"
		protocol = "ollama"
		path = strings.TrimPrefix(r.URL.Path, "/api")
	} else if strings.Trim(path, "/") == "messages" {
		protocol = "anthropic"
	}
	path = strings.Trim(path, "/")

	// override via header (legacy X-Simha-Provider)
	if p := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Simha-Provider"))); p != "" {
		switch p {
		case "openai", "anthropic", "ollama":
			protocol = p
		}
	}

	body, _ := io.ReadAll(r.Body)
	defer r.Body.Close()

	var data map[string]any
	model := ""
	inferredTask := false
	task := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Simha-Task")))
	inputModality := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Simha-Input-Modality")))
	outputModality := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Simha-Output-Modality")))
	if len(body) > 0 {
		if err := json.Unmarshal(body, &data); err == nil {
			if m, ok := data["model"].(string); ok {
				model = m
			}
			if task == "" {
				if v, ok := data["task"].(string); ok {
					task = strings.ToLower(strings.TrimSpace(v))
				}
			}
			if inputModality == "" {
				if v, ok := data["input_modality"].(string); ok {
					inputModality = strings.ToLower(strings.TrimSpace(v))
				}
			}
			if outputModality == "" {
				if v, ok := data["output_modality"].(string); ok {
					outputModality = strings.ToLower(strings.TrimSpace(v))
				}
			}
			if task == "" {
				task = inferTask(data)
				inferredTask = true
			}
			policy := s.st.Policy(ctx, model)
			var changes []string
			data, changes = optimize(data, policy)
			if len(changes) > 0 {
				b2, _ := json.Marshal(data)
				body = b2
			}
		}
	}

	// auto model selection (legacy: model None/""/"auto")
	requestedModel := model
	if model == "" || model == "auto" {
		var selected store.RouteScore
		model, selected, _ = s.st.SelectModel(ctx, protocol, task, r.Header.Get("X-Simha-Routing-Mode"), 0.9)
		if model != "" {
			w.Header().Set("X-Simha-Route-Model", model)
			w.Header().Set("X-Simha-Task", task)
			w.Header().Set("X-Simha-Route-ELO", fmt.Sprintf("%.0f", selected.ELO))
			w.Header().Set("X-Simha-Route-Score", fmt.Sprintf("%.2f", selected.Total))
		}
		if model != "" && len(body) > 0 && data != nil {
			data["model"] = model
			b2, _ := json.Marshal(data)
			body = b2
		}
	}

	// compare mode (legacy X-Simha-Mode: compare)
	if strings.EqualFold(r.Header.Get("X-Simha-Mode"), "compare") && r.Method == http.MethodPost {
		s.handleCompare(w, r, ctx, ac, data, requestedModel, protocol)
		return
	}

	// An inferred task is a ranking signal, not a hard capability contract.
	// Explicit task metadata remains strict and can intentionally reject models
	// that do not advertise the requested modality/capability.
	candidateTask := task
	if inferredTask {
		candidateTask = ""
	}
	s.forward(w, r, ctx, ac, path, r.Method, body, model, apiPrefix, protocol, candidateTask, inputModality, outputModality)
}

// exhaustionReason explains why one candidate account could not serve the
// request, so a 429 from the gateway is always diagnosable from logs.
type exhaustionReason struct {
	Name     string `json:"name"`
	Cooling  bool   `json:"cooling"`
	NoModel  bool   `json:"no_model,omitempty"`
	NoTask   bool   `json:"no_task,omitempty"`
	NoCapacity bool `json:"no_capacity,omitempty"`
}

// inferTask is intentionally small and deterministic. Explicit task headers
// still win; this only supplies a useful routing signal for ordinary chat.
func inferTask(data map[string]any) string {
	if data == nil {
		return "text-generation"
	}
	var text strings.Builder
	if msgs, ok := data["messages"].([]any); ok {
		for _, raw := range msgs {
			if msg, ok := raw.(map[string]any); ok {
				if content, ok := msg["content"].(string); ok {
					text.WriteString(" ")
					text.WriteString(content)
				}
			}
		}
	}
	l := strings.ToLower(text.String())
	if strings.Contains(l, "translate") || strings.Contains(l, "translation") || strings.Contains(l, " in french") || strings.Contains(l, " in spanish") {
		return "translation"
	}
	if strings.Contains(l, "summarize") || strings.Contains(l, "summary") || strings.Contains(l, "tl;dr") {
		return "summarization"
	}
	if strings.Contains(l, "write code") || strings.Contains(l, "code review") || strings.Contains(l, "debug") || strings.Contains(l, "function ") || strings.Contains(l, "```") {
		return "code-generation"
	}
	if strings.Contains(l, "calculate") || strings.Contains(l, "solve") || strings.Contains(l, "equation") || strings.Contains(l, "mathematics") {
		return "mathematical-reasoning"
	}
	if strings.Contains(l, "classify") || strings.Contains(l, "sentiment") || strings.Contains(l, "label these") {
		return "text-classification"
	}
	if strings.Contains(l, "image") || strings.Contains(l, "photo") || strings.Contains(l, "visual") {
		return "image-text-to-text"
	}
	if strings.Contains(l, "audio") || strings.Contains(l, "transcribe") || strings.Contains(l, "speech") {
		return "automatic-speech-recognition"
	}
	return "text-generation"
}

// autoModel picks the first known model with eligible accounts.
func (s *Server) autoModel(ctx context.Context, protocol string) string {
	for _, m := range s.st.KnownModels(ctx) {
		if len(s.st.EligibleAccounts(ctx, m, protocol, s.cfg.UsageThreshold)) > 0 {
			return m
		}
	}
	return ""
}

// forward runs the candidate loop: pick best account, reserve, dispatch,
// handle 429/401/403/404/model-400 failover, stream the response back.
func (s *Server) forward(w http.ResponseWriter, r *http.Request, ctx context.Context,
	ac *authCtx, path, method string, body []byte, model, apiPrefix, protocol, task, inputModality, outputModality string) {

	candidates := s.st.EligibleAccountsForTask(ctx, model, protocol, task, inputModality, outputModality, s.cfg.UsageThreshold)
	if len(candidates) == 0 {
		// Diagnosability: when every account for the model is exhausted the
		// client only sees "no available account". Log the per-account reason
		// (cooldown / model absence / task capability / capacity) and include a
		// compact summary in the response so operators can trace the blocker.
		reasons := s.explainExhaustion(ctx, model, protocol, task, inputModality, outputModality)
		log.Printf("[forward] no eligible account for model=%q task=%q protocol=%s reasons=%s",
			model, task, protocol, mustJSON(reasons))
		w.Header().Set("Retry-After", "5")
		w.Header().Set("X-Simha-Exhaustion", string(mustJSON(reasons)))
		writeJSON(w, 429, map[string]any{"error": "No available account (all cooling down, at capacity, or lacking model).", "code": "upstream_capacity", "model": model, "retryable": true, "accounts": reasons})
		return
	}

	var lastAuth *http.Response
	defer func() {
		if lastAuth != nil {
			io.Copy(io.Discard, lastAuth.Body)
			lastAuth.Body.Close()
		}
	}()

	for i := 0; i < len(candidates); i++ {
		acc := s.st.SelectAccount(ctx, candidates, s.cfg.UsageThreshold)
		if acc == nil {
			break
		}
		// remove from candidates
		for j, c := range candidates {
			if c.Name == acc.Name {
				candidates = append(candidates[:j], candidates[j+1:]...)
				break
			}
		}

		prefix := acc.APIPrefix
		if acc.ProviderName() == "ollama" {
			if protocol == "ollama" {
				prefix = "/api"
			} else if protocol == "openai" {
				// Ollama's OpenAI-compatible endpoint is /v1, while /api is
				// reserved for native Ollama requests.
				prefix = "/v1"
			}
		}
		target := strings.TrimRight(acc.BaseURL, "/") + "/" + strings.Trim(prefix, "/")
		if path != "" {
			target += "/" + path
		}

		if !s.st.Reserve(ctx, acc, s.cfg.UsageThreshold) {
			continue
		}

		req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
		if err != nil {
			continue
		}
		for k, vals := range r.Header {
			if _, skip := store.HopHeaders[strings.ToLower(k)]; skip {
				continue
			}
			for _, v := range vals {
				req.Header.Add(k, v)
			}
		}
		for k, v := range s.st.UpstreamAuthHeaders(ctx, acc) {
			req.Header.Set(k, v)
		}

		resp, err := s.st.DoUpstream(ctx, req, s.cfg.UpstreamTimeout)
		if err != nil {
			log.Printf("[forward] %s: %v", acc.Name, err)
			s.st.SetCooldown(ctx, acc.Name, 10)
			continue
		}

		switch {
		case resp.StatusCode == http.StatusTooManyRequests:
			strikes := s.st.AddStrike(ctx, acc.Name)
			retryAfter := resp.Header.Get("Retry-After")
			secs := int64(0)
			if retryAfter != "" {
				if n, err := strconv.ParseInt(strings.TrimSpace(retryAfter), 10, 64); err == nil {
					secs = n
				} else if t, err := http.ParseTime(retryAfter); err == nil {
					secs = int64(time.Until(t).Seconds())
					if secs < 0 {
						secs = 0
					}
				}
			}
			if secs > 0 {
				s.st.SetCooldown(ctx, acc.Name, secs)
			} else {
				backoff := int64(s.cfg.CooldownSeconds) * (1 << min64(strikes-1, 10))
				if backoff > 86400 {
					backoff = 86400
				}
				s.st.SetCooldown(ctx, acc.Name, backoff)
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			continue

		case resp.StatusCode == 401 || resp.StatusCode == 403:
			if lastAuth != nil {
				io.Copy(io.Discard, lastAuth.Body)
				lastAuth.Body.Close()
			}
			lastAuth = resp
			s.st.SetCooldown(ctx, acc.Name, int64(s.cfg.CooldownSeconds))
			log.Printf("[forward] auth failed for %s (%d)", acc.Name, resp.StatusCode)
			continue

		case resp.StatusCode == 404 && model != "":
			s.st.SetCooldown(ctx, acc.Name, 5)
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			continue

		case resp.StatusCode == 400 && model != "" && isModelUnavailable(resp):
			s.st.SetCooldown(ctx, acc.Name, 5)
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			continue
		}

		// record usage for non-streaming JSON responses
		if !isStreamingBody(resp) {
			recordUsageFrom(resp, acc.Name, model, ac, s.st)
		}
		s.st.ClearStrikes(ctx, acc.Name)
		s.st.MarkUsed(ctx, acc.Name)
		s.streamUpstream(w, resp, path)
		return
	}

	// all candidates exhausted — surface the last auth error if any
	if lastAuth != nil {
		s.streamUpstream(w, lastAuth, path)
		return
	}
	reasons := s.explainExhaustion(ctx, model, protocol, task, inputModality, outputModality)
	log.Printf("[forward] candidates exhausted for model=%q task=%q reasons=%s", model, task, mustJSON(reasons))
	w.Header().Set("Retry-After", "5")
	w.Header().Set("X-Simha-Exhaustion", string(mustJSON(reasons)))
	writeJSON(w, 429, map[string]any{"error": "No available account (all cooling down, at capacity, or lacking model).", "code": "upstream_capacity", "model": model, "retryable": true, "accounts": reasons})
}

// explainExhaustion inspects every account that (in the Valkey catalog) serves
// the model and reports why each is currently unusable. Accounts in cooldown
// are reported with their remaining seconds; accounts that dropped out of the
// discovered catalog are flagged as no_model.
func (s *Server) explainExhaustion(ctx context.Context, model, protocol, task, inputModality, outputModality string) []exhaustionReason {
	out := []exhaustionReason{}
	threshold := s.cfg.UsageThreshold
	names := s.st.AccountsForModel(ctx, model)
	for _, name := range names {
		r := exhaustionReason{Name: name}
		acc := s.st.GetAccount(ctx, name)
		if acc == nil {
			r.NoModel = true
			out = append(out, r)
			continue
		}
		if s.st.IsCoolingDown(ctx, name) {
			r.Cooling = true
		}
		if protocol != "" && acc.Protocol2() != protocol &&
			!((protocol == "ollama" && acc.Protocol2() == "openai" && acc.ProviderName() == "ollama") ||
				(protocol == "openai" && acc.Protocol2() == "ollama" && acc.ProviderName() == "ollama")) {
			r.NoTask = true
			out = append(out, r)
			continue
		}
		if task != "" {
			if capable := s.st.EligibleAccountsForTask(ctx, model, protocol, task, inputModality, outputModality, threshold); len(capable) == 0 {
				r.NoTask = true
				out = append(out, r)
				continue
			}
		}
		lim := acc.Limits
		counts := s.st.WindowCounts(ctx, name)
		for _, c := range []struct {
			period string
			limit  int
		}{{"minute", lim.RPM}, {"day", lim.RPD}, {"week", lim.RPW}} {
			if c.limit > 0 && float64(counts[c.period]) >= float64(c.limit)*threshold {
				r.NoCapacity = true
				break
			}
		}
		out = append(out, r)
	}
	return out
}

// streamUpstream copies the upstream response to the client, filtering hop headers.
func (s *Server) streamUpstream(w http.ResponseWriter, resp *http.Response, path string) {
	for k, vals := range resp.Header {
		lk := strings.ToLower(k)
		if lk == "content-length" || lk == "transfer-encoding" || lk == "connection" {
			continue
		}
		for _, v := range vals {
			w.Header().Add(k, v)
		}
	}
	switch path {
	case "responses":
		w.Header().Set("X-Simha-Adapter", "openai-responses")
	case "messages":
		w.Header().Set("X-Simha-Adapter", "anthropic-messages")
	}
	w.WriteHeader(resp.StatusCode)
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				break
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			break
		}
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
}

// compare implements legacy X-Simha-Mode: compare — run up to 3 models,
// collect answers, judge, and return the synthesized response.
func (s *Server) handleCompare(w http.ResponseWriter, r *http.Request, ctx context.Context,
	ac *authCtx, data map[string]any, model, protocol string) {

	if data == nil {
		writeJSON(w, 400, map[string]any{"error": "compare mode requires a JSON body"})
		return
	}
	task := inferTask(data)
	_, _, ranked := s.st.SelectModel(ctx, protocol, task, "quality", s.cfg.UsageThreshold)
	var compareModels []string
	for _, candidate := range ranked {
		compareModels = append(compareModels, candidate.Model)
		if len(compareModels) >= 3 {
			break
		}
	}
	var answers []string
	for i, cm := range compareModels {
		cd := map[string]any{}
		for k, v := range data {
			cd[k] = v
		}
		cd["model"] = cm
		b, _ := json.Marshal(cd)
		ans := s.collectAnswer(ctx, r, "chat/completions", b, cm, protocol)
		if ans != "" {
			answers = append(answers, fmt.Sprintf("[candidate-%d]\n%s", i+1, ans))
		}
	}
	if len(answers) == 0 {
		writeJSON(w, 429, map[string]any{"error": "No eligible routing candidates are available."})
		return
	}
	judgeModel := model
	if judgeModel == "" || judgeModel == "auto" {
		for _, candidate := range ranked {
			if !containsString(compareModels, candidate.Model) {
				judgeModel = candidate.Model
				break
			}
		}
		if judgeModel == "" && len(compareModels) > 0 {
			judgeModel = compareModels[0]
		}
	}
	question := ""
	if msgs, ok := data["messages"].([]any); ok && len(msgs) > 0 {
		if last, ok := msgs[len(msgs)-1].(map[string]any); ok {
			question, _ = last["content"].(string)
		}
	}
	judgeMessages := []map[string]any{
		{"role": "system", "content": "You are Simha Judge. Evaluate each candidate from 0 to 10 for relevance, factuality, coherence, instruction following, safety, formatting, and task completion. Select the strongest candidate. Return strict JSON only: {\"winner\":\"candidate-1\",\"final_answer\":\"...\",\"evaluations\":[{\"candidate\":\"candidate-1\",\"relevance\":0,\"factuality\":0,\"coherence\":0,\"instruction_following\":0,\"safety\":0,\"formatting\":0,\"task_completion\":0,\"explanation\":\"...\"}]}"},
		{"role": "user", "content": question + "\n\nCandidate responses:\n" + strings.Join(answers, "\n\n---\n\n")},
	}
	judgeBody, _ := json.Marshal(map[string]any{
		"model": judgeModel, "messages": judgeMessages, "stream": false,
	})
	result := s.collectFull(ctx, r, "chat/completions", judgeBody, judgeModel, protocol)
	if result == nil {
		writeJSON(w, 503, map[string]any{"error": "The comparison judge is temporarily unavailable."})
		return
	}
	if judged, ok := parseJudgeResult(result); ok {
		s.recordJudgeResult(ctx, task, judgeModel, judged, compareModels)
		writeJSON(w, 200, map[string]any{"id": "simha-compare", "object": "chat.completion", "model": judged.Winner, "choices": []any{map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": judged.FinalAnswer}, "finish_reason": "stop"}}, "judge": judged})
		return
	}
	// A provider that ignores the JSON instruction still produces a usable
	// answer; do not discard it or charge the user another request.
	writeJSONRaw(w, 200, result)
}

type judgeEvaluation struct {
	Candidate            string  `json:"candidate"`
	Relevance            float64 `json:"relevance"`
	Factuality           float64 `json:"factuality"`
	Coherence            float64 `json:"coherence"`
	InstructionFollowing float64 `json:"instruction_following"`
	Safety               float64 `json:"safety"`
	Formatting           float64 `json:"formatting"`
	TaskCompletion       float64 `json:"task_completion"`
	Explanation          string  `json:"explanation"`
}

type judgeResult struct {
	Winner      string            `json:"winner"`
	FinalAnswer string            `json:"final_answer"`
	Evaluations []judgeEvaluation `json:"evaluations"`
}

func parseJudgeResult(raw []byte) (judgeResult, bool) {
	var envelope struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(raw, &envelope) != nil || len(envelope.Choices) == 0 {
		return judgeResult{}, false
	}
	content := strings.TrimSpace(envelope.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimSuffix(strings.TrimSpace(content), "```")
	var result judgeResult
	if json.Unmarshal([]byte(strings.TrimSpace(content)), &result) != nil || result.FinalAnswer == "" || len(result.Evaluations) == 0 {
		return judgeResult{}, false
	}
	return result, true
}

func (s *Server) recordJudgeResult(ctx context.Context, task, judgeModel string, result judgeResult, candidates []string) {
	for _, evaluation := range result.Evaluations {
		modelName := evaluation.Candidate
		if strings.HasPrefix(modelName, "candidate-") {
			var index int
			if _, err := fmt.Sscanf(modelName, "candidate-%d", &index); err == nil && index > 0 && index <= len(candidates) {
				modelName = candidates[index-1]
			}
		}
		quality := (evaluation.Relevance + evaluation.Factuality + evaluation.Coherence + evaluation.InstructionFollowing + evaluation.Safety + evaluation.Formatting + evaluation.TaskCompletion) / 7 * 10
		winnerModel := result.Winner
		if strings.HasPrefix(winnerModel, "candidate-") {
			var index int
			if _, err := fmt.Sscanf(winnerModel, "candidate-%d", &index); err == nil && index > 0 && index <= len(candidates) {
				winnerModel = candidates[index-1]
			}
		}
		isWinner := modelName == winnerModel
		_, _ = s.st.Pool.Exec(ctx, `INSERT INTO judge_evaluations(request_id, model, task_slug, quality_score, factuality_score, safety_score, format_score, verdict, explanation, metrics_json) VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10)`, "compare-"+result.Winner, modelName, task, quality, evaluation.Factuality*10, evaluation.Safety*10, evaluation.Formatting*10, map[bool]string{true: "winner", false: "candidate"}[isWinner], evaluation.Explanation, mustJSON(evaluation))
		_, _ = s.st.Pool.Exec(ctx, `INSERT INTO model_route_scores(model, task_slug, elo, quality_score, battle_count) VALUES ($1, COALESCE(NULLIF($2,''),'text-generation'), 1516, $3, 1) ON CONFLICT (model, task_slug) DO UPDATE SET elo = model_route_scores.elo + CASE WHEN $4 THEN 16 ELSE -16 END, quality_score = (model_route_scores.quality_score * model_route_scores.battle_count + EXCLUDED.quality_score) / (model_route_scores.battle_count + 1), battle_count = model_route_scores.battle_count + 1, updated_at = now()`, modelName, task, quality, isWinner)
	}
	_ = candidates
	_ = judgeModel
}

func mustJSON(value any) []byte { raw, _ := json.Marshal(value); return raw }

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

// collectAnswer performs one non-streaming dispatch and extracts the message content.
func (s *Server) collectAnswer(ctx context.Context, r *http.Request, path string, body []byte, model, protocol string) string {
	raw := s.collectFull(ctx, r, path, body, model, protocol)
	if raw == nil {
		return ""
	}
	var parsed struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	_ = json.Unmarshal(raw, &parsed)
	if len(parsed.Choices) > 0 {
		return parsed.Choices[0].Message.Content
	}
	return ""
}

// collectFull performs one dispatch to the best eligible account (no streaming).
func (s *Server) collectFull(ctx context.Context, r *http.Request, path string, body []byte, model, protocol string) []byte {
	cands := s.st.EligibleAccounts(ctx, model, protocol, s.cfg.UsageThreshold)
	if len(cands) == 0 {
		return nil
	}
	acc := s.st.SelectAccount(ctx, cands, s.cfg.UsageThreshold)
	if acc == nil || !s.st.Reserve(ctx, acc, s.cfg.UsageThreshold) {
		return nil
	}
	target := strings.TrimRight(acc.BaseURL, "/") + "/" + strings.Trim(acc.APIPrefix, "/") + "/" + path
	req, err := http.NewRequestWithContext(ctx, "POST", target, bytes.NewReader(body))
	if err != nil {
		return nil
	}
	for k, vals := range r.Header {
		if _, skip := store.HopHeaders[strings.ToLower(k)]; skip {
			continue
		}
		for _, v := range vals {
			req.Header.Add(k, v)
		}
	}
	for k, v := range s.st.UpstreamAuthHeaders(ctx, acc) {
		req.Header.Set(k, v)
	}
	resp, err := s.st.DoUpstream(ctx, req, s.cfg.UpstreamTimeout)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	return raw
}

// isModelUnavailable detects provider "model not available" 400 wording
// (legacy unavailable_markers) so those upstreams fail over instead of 400-ing.
func isModelUnavailable(resp *http.Response) bool {
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	// allow downstream re-read by replacing body
	resp.Body = io.NopCloser(bytes.NewReader(raw))
	if err != nil {
		return false
	}
	t := strings.ToLower(string(raw))
	checks := []struct{ a, b string }{
		{"model ", "not in allowed list"},
		{"model is not available", ""},
		{"service id does not exist", ""},
		{"model not found", ""},
	}
	for _, c := range checks {
		if c.b == "" && strings.Contains(t, c.a) {
			return true
		}
		if c.b != "" && strings.Contains(t, c.a) && strings.Contains(t, c.b) {
			return true
		}
	}
	return false
}

// isStreamingBody reports whether the response is an SSE stream.
func isStreamingBody(resp *http.Response) bool {
	ct := resp.Header.Get("Content-Type")
	return strings.Contains(ct, "text/event-stream")
}

// recordUsageFrom parses usage from a completed JSON response and stores it.
func recordUsageFrom(resp *http.Response, account, model string, ac *authCtx, st *store.Store) {
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	resp.Body = io.NopCloser(bytes.NewReader(raw))
	if err != nil {
		return
	}
	var parsed struct {
		Model string `json:"model"`
		Usage struct {
			PromptTokens     *int `json:"prompt_tokens"`
			CompletionTokens *int `json:"completion_tokens"`
			TotalTokens      *int `json:"total_tokens"`
			InputTokens      *int `json:"input_tokens"`
			OutputTokens     *int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return
	}
	prompt, completion := 0, 0
	if parsed.Usage.PromptTokens != nil {
		prompt = *parsed.Usage.PromptTokens
	} else if parsed.Usage.InputTokens != nil {
		prompt = *parsed.Usage.InputTokens
	}
	if parsed.Usage.CompletionTokens != nil {
		completion = *parsed.Usage.CompletionTokens
	} else if parsed.Usage.OutputTokens != nil {
		completion = *parsed.Usage.OutputTokens
	}
	total := prompt + completion
	if parsed.Usage.TotalTokens != nil {
		total = *parsed.Usage.TotalTokens
	}
	usageModel := model
	if usageModel == "" {
		usageModel = parsed.Model
	}
	_ = st.RecordUsage(context.Background(), account, usageModel, int64(resp.StatusCode),
		int64(prompt), int64(completion), int64(total), ac.UserID, ac.ClientKeyID)
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeJSONRaw(w http.ResponseWriter, status int, raw []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(raw)
}
