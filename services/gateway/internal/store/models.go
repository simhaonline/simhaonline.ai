// Accounts, model discovery, and policy loading.
package store

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
)

// inferredCapabilities is deliberately conservative. Provider model-list
// APIs rarely publish benchmarked modality metadata, so only capabilities
// reasonably inferred from the provider/model identifier are recorded.
func inferredCapabilities(model, protocol, provider string) []string {
	name := strings.ToLower(model + " " + provider)
	caps := []string{}
	if protocol == "openai" || protocol == "anthropic" || protocol == "ollama" {
		caps = append(caps, "text-generation")
	}
	checks := map[string][]string{
		"automatic-speech-recognition": {"whisper", "speech-to-text", "asr"},
		"text-to-speech":               {"tts", "text-to-speech", "speech-synthesis"},
		"feature-extraction":           {"embed", "embedding", "bge-", "e5-"},
		"image-text-to-text":           {"vision", "vl", "llava", "qwen-vl", "gemini", "gpt-4o", "claude-3", "claude-4"},
		"visual-question-answering":    {"vision", "vl", "llava", "qwen-vl", "gemini", "gpt-4o", "claude-3", "claude-4"},
		"image-to-text":                {"vision", "vl", "llava", "qwen-vl", "gemini", "gpt-4o"},
		"text-to-image":                {"dall-e", "stable-diffusion", "flux", "image-generation", "imagen"},
		"text-to-video":                {"video-generation", "sora", "veo", "runway"},
	}
	for cap, needles := range checks {
		for _, needle := range needles {
			if strings.Contains(name, needle) {
				caps = append(caps, cap)
				break
			}
		}
	}
	return caps
}

// LoadAccounts refreshes the in-memory account cache from PostgreSQL.
func (s *Store) LoadAccounts(ctx context.Context) error {
	rows, err := s.Pool.Query(ctx, `
		SELECT name, base_url, api_key, provider, protocol, api_prefix, auth_mode,
		       oauth_token_file, oauth_token_url, oauth_client_id, oauth_client_secret,
		       wildcard, limits_json
		FROM accounts ORDER BY name`)
	if err != nil {
		return err
	}
	defer rows.Close()

	accounts := make(map[string]*Account)
	for rows.Next() {
		a := &Account{}
		var limitsJSON []byte
		if err := rows.Scan(&a.Name, &a.BaseURL, &a.APIKey, &a.Provider, &a.Protocol,
			&a.APIPrefix, &a.AuthMode, &a.TokenFile, &a.TokenURL, &a.ClientID,
			&a.ClientSec, &a.Wildcard, &limitsJSON); err != nil {
			return err
		}
		a.Limits = Limits{}
		if len(limitsJSON) > 0 {
			_ = json.Unmarshal(limitsJSON, &a.Limits)
		}
		if a.APIPrefix == "" {
			a.APIPrefix = "/v1"
		}
		accounts[a.Name] = a
	}
	s.mu.Lock()
	s.accounts = accounts
	s.mu.Unlock()
	return rows.Err()
}

// Policy lookup: exact model match else '*' row from model_policies table,
// overlaid with the JSON policy file if present.
func (s *Store) Policy(ctx context.Context, model string) Policy {
	p := DefaultPolicy()
	var row struct {
		MaxInput     int
		MinOutput    int
		MaxOutput    int
		MaxToolChars int
		Dedupe       bool
	}
	err := s.Pool.QueryRow(ctx, `
		SELECT max_input_tokens, min_output_tokens, max_output_tokens, max_tool_result_chars, dedupe_system_messages
		FROM model_policies WHERE model = $1`, model).
		Scan(&row.MaxInput, &row.MinOutput, &row.MaxOutput, &row.MaxToolChars, &row.Dedupe)
	if err == nil {
		p.MaxInputTokens, p.MinOutputTokens, p.MaxOutputTokens = row.MaxInput, row.MinOutput, row.MaxOutput
		p.MaxToolResultChars, p.DedupeSystemMessages = row.MaxToolChars, row.Dedupe
	}
	// JSON file overlay (file wins where present — matches legacy precedence
	// where model_policies.json values were applied over defaults).
	if s.policyFile != nil {
		if fp, ok := s.policyFile[model]; ok {
			mergePolicy(&p, fp)
		} else if fp, ok := s.policyFile["*"]; ok {
			mergePolicy(&p, fp)
		}
	}
	return p
}

func mergePolicy(dst *Policy, src map[string]any) {
	if v, ok := src["max_input_tokens"].(float64); ok {
		dst.MaxInputTokens = int(v)
	}
	if v, ok := src["min_output_tokens"].(float64); ok {
		dst.MinOutputTokens = int(v)
	}
	if v, ok := src["max_output_tokens"].(float64); ok {
		dst.MaxOutputTokens = int(v)
	}
	if v, ok := src["max_tool_result_chars"].(float64); ok {
		dst.MaxToolResultChars = int(v)
	}
	if v, ok := src["dedupe_system_messages"].(bool); ok {
		dst.DedupeSystemMessages = v
	}
}

// LoadPolicyFile reads the optional JSON policy overlay.
func (s *Store) LoadPolicyFile(path string) {
	if path == "" {
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		log.Printf("[policy] no policy file at %s (using DB defaults)", path)
		return
	}
	var m map[string]map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		log.Printf("[policy] invalid policy file %s: %v", path, err)
		return
	}
	s.mu.Lock()
	s.policyFile = m
	s.mu.Unlock()
	log.Printf("[policy] loaded %d policies from %s", len(m), path)
}

// RefreshModels runs one discovery pass: query each account's model list and
// rebuild the Valkey model→accounts map. Uses a Valkey lock so only one
// replica discovers at a time.
func (s *Store) RefreshModels(ctx context.Context) {
	// Keep the hot account cache usable even when another replica owns the
	// discovery lock. A lock should serialize provider calls, not hide known
	// accounts from routing/status requests.
	if err := s.LoadAccounts(ctx); err != nil {
		log.Printf("[discovery] account cache refresh failed: %v", err)
	}
	// non-blocking leader lock (30s TTL)
	err := s.Valkey.Do(ctx, s.Valkey.B().Set().Key(keyLock).Value("1").Nx().ExSeconds(30).Build()).Error()
	if err != nil {
		// NX failure means someone else holds it
		log.Printf("[discovery] refresh skipped (lock held): %v", err)
		return
	}
	defer s.Valkey.Do(context.Background(), s.Valkey.B().Del().Key(keyLock).Build())

	mapping := map[string][]string{} // model → accounts
	all := map[string]struct{}{}
	for _, a := range s.snapshotAccounts() {
		models, err := s.fetchModels(ctx, a)
		if err != nil {
			log.Printf("[discovery] %s: %v", a.Name, err)
			continue
		}
		// Replace only after a successful fetch so a temporary provider outage
		// does not erase the last known catalog for that account.
		_, _ = s.Pool.Exec(ctx, `DELETE FROM discovered_models WHERE account_name = $1`, a.Name)
		for _, m := range models {
			// persist to DB for the dashboard
			_, _ = s.Pool.Exec(ctx, `
				INSERT INTO discovered_models(model, account_name, last_seen, enabled) VALUES($1,$2,now(),true)
				ON CONFLICT (model, account_name) DO UPDATE SET last_seen=now()`, m, a.Name)
			for _, cap := range inferredCapabilities(m, a.Protocol2(), a.ProviderName()) {
				_, _ = s.Pool.Exec(ctx, `
					INSERT INTO model_capabilities(account_name, model, capability_slug, input_modalities, output_modalities, confidence_score, source, enabled, last_verified_at)
					SELECT $1,$2,slug,input_modalities,output_modalities,65,'discovery-heuristic',true,now()
					FROM task_capabilities WHERE slug=$3
					ON CONFLICT (account_name, model, capability_slug) DO UPDATE SET
					 input_modalities=EXCLUDED.input_modalities, output_modalities=EXCLUDED.output_modalities,
					 confidence_score=EXCLUDED.confidence_score, last_verified_at=now(), updated_at=now()`, a.Name, m, cap)
			}
		}
	}
	// Rebuild the shared routing catalog from the persisted enabled flags.
	rows, err := s.Pool.Query(ctx, `SELECT model, account_name FROM discovered_models WHERE enabled = true`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var model, account string
			if rows.Scan(&model, &account) != nil {
				continue
			}
			all[model] = struct{}{}
			mapping[model] = append(mapping[model], account)
		}
	}

	// write to Valkey atomically-ish: replace hash + set
	_ = s.Valkey.Do(ctx, s.Valkey.B().Del().Key(keyModels).Build()).Error()
	_ = s.Valkey.Do(ctx, s.Valkey.B().Del().Key(keyAllMod).Build()).Error()
	for model, accs := range mapping {
		_ = s.Valkey.Do(ctx, s.Valkey.B().Hset().Key(keyModels).
			FieldValue().FieldValue(model, strings.Join(accs, ",")).Build()).Error()
	}
	for m := range all {
		_ = s.Valkey.Do(ctx, s.Valkey.B().Sadd().Key(keyAllMod).Member(m).Build()).Error()
	}
	log.Printf("[discovery] %d models known across %d accounts", len(all), len(s.snapshotAccounts()))
}

// AccountsForTask returns accounts whose discovered model has an explicit
// capability record. It is only used when a client opts into task routing.
func (s *Store) AccountsForTask(ctx context.Context, model, task, inputModality, outputModality string) []string {
	if task == "" {
		return nil
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT account_name FROM model_capabilities
		WHERE model=$1 AND capability_slug=$2 AND enabled=true
		  AND ($3='' OR $3 = ANY(input_modalities))
		  AND ($4='' OR $4 = ANY(output_modalities))`, model, task, inputModality, outputModality)
	if err != nil {
		return nil
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var account string
		if rows.Scan(&account) == nil {
			out = append(out, account)
		}
	}
	return out
}

// AutoModelForTask chooses a discovered model with a task capability and an
// eligible account. It returns empty when the provider catalog has no honest
// match, allowing the caller to return a clear unsupported-task response.
func (s *Store) AutoModelForTask(ctx context.Context, protocol, task, inputModality, outputModality string, threshold float64) string {
	if task == "" {
		return ""
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT DISTINCT mc.model FROM model_capabilities mc
		WHERE mc.capability_slug=$1 AND mc.enabled=true
		  AND ($2='' OR $2=ANY(mc.input_modalities))
		  AND ($3='' OR $3=ANY(mc.output_modalities))
		ORDER BY mc.confidence_score DESC NULLS LAST, mc.model`, task, inputModality, outputModality)
	if err != nil {
		return ""
	}
	defer rows.Close()
	for rows.Next() {
		var model string
		if rows.Scan(&model) == nil && len(s.EligibleAccounts(ctx, model, protocol, threshold)) > 0 {
			return model
		}
	}
	return ""
}

// fetchModels implements the legacy 3-tier fallback:
// <prefix>/models → /v1/models → ollama /api/tags
func (s *Store) fetchModels(ctx context.Context, a *Account) ([]string, error) {
	headers := s.UpstreamAuthHeaders(ctx, a)
	base := strings.TrimRight(a.BaseURL, "/")
	falAccount := strings.EqualFold(a.ProviderName(), "fal") || strings.Contains(strings.ToLower(base), "api.fal.ai") || strings.Contains(strings.ToLower(base), "fal.run")
	if falAccount {
		base = "https://api.fal.ai"
	}
	// Hugging Face's legacy api-inference host does not expose the OpenAI
	// compatible model catalog. Keep older saved accounts usable by routing
	// discovery through the current Inference Providers router.
	if strings.EqualFold(a.ProviderName(), "huggingface") && strings.Contains(strings.ToLower(base), "api-inference.huggingface.co") {
		base = "https://router.huggingface.co"
	}
	prefix := "/" + strings.Trim(a.APIPrefix, "/")

	type idList struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	type falList struct {
		Models []struct {
			EndpointID string `json:"endpoint_id"`
		} `json:"models"`
	}
	type tagList struct {
		Models []struct {
			Name string `json:"name"`
		} `json:"models"`
	}

	try := func(url string) ([]string, bool) {
		req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
		if err != nil {
			return nil, false
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		resp, err := s.httpClient.Do(req)
		if err != nil {
			return nil, false
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, false
		}
		var ids idList
		if err := json.NewDecoder(resp.Body).Decode(&ids); err == nil && len(ids.Data) > 0 {
			out := make([]string, 0, len(ids.Data))
			for _, d := range ids.Data {
				if d.ID != "" {
					out = append(out, d.ID)
				}
			}
			return out, true
		}
		return nil, false
	}

	if falAccount {
		if req, err := http.NewRequestWithContext(ctx, "GET", base+"/v1/models", nil); err == nil {
			for k, v := range headers {
				req.Header.Set(k, v)
			}
			if resp, err := s.httpClient.Do(req); err == nil {
				defer resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					var catalog falList
					if json.NewDecoder(resp.Body).Decode(&catalog) == nil {
						out := make([]string, 0, len(catalog.Models))
						for _, m := range catalog.Models {
							if m.EndpointID != "" {
								out = append(out, m.EndpointID)
							}
						}
						return out, nil
					}
				}
			}
		}
		return nil, nil
	}

	// tier 1: account prefix
	if ids, ok := try(base + prefix + "/models"); ok {
		return ids, nil
	}
	// tier 2: conventional /v1/models
	if prefix != "/v1" {
		if ids, ok := try(base + "/v1/models"); ok {
			return ids, nil
		}
	}
	// tier 3: ollama tags
	req, err := http.NewRequestWithContext(ctx, "GET", base+"/api/tags", nil)
	if err == nil {
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		if resp, err := s.httpClient.Do(req); err == nil {
			defer resp.Body.Close()
			if resp.StatusCode == 200 {
				var tags tagList
				if err := json.NewDecoder(resp.Body).Decode(&tags); err == nil {
					out := make([]string, 0, len(tags.Models))
					for _, m := range tags.Models {
						if m.Name != "" {
							out = append(out, m.Name)
						}
					}
					if len(out) > 0 {
						return out, nil
					}
				}
			}
		}
	}
	return nil, nil
}

// KnownModels returns the set of all discovered models.
func (s *Store) KnownModels(ctx context.Context) []string {
	msg := s.Valkey.Do(ctx, s.Valkey.B().Smembers().Key(keyAllMod).Build())
	arr, _ := msg.AsStrSlice()
	sort.Strings(arr)
	return arr
}

// ModelExists reports whether the model is in the discovered catalog.
// The keyAllMod set is authoritative (models the gateway can serve).
func (s *Store) ModelExists(ctx context.Context, model string) bool {
	if model == "" {
		return false
	}
	msg := s.Valkey.Do(ctx, s.Valkey.B().Sismember().Key(keyAllMod).Member(model).Build())
	n, err := msg.AsInt64()
	if err != nil {
		return false
	}
	return n == 1
}

// AccountsForModel returns account names eligible for a model.
func (s *Store) AccountsForModel(ctx context.Context, model string) []string {
	if model == "" {
		return nil
	}
	val, err := s.Valkey.Do(ctx, s.Valkey.B().Hget().Key(keyModels).Field(model).Build()).ToString()
	if err != nil || val == "" {
		return nil
	}
	return strings.Split(val, ",")
}

// GetAccount fetches a live account record by name.
func (s *Store) GetAccount(ctx context.Context, name string) *Account {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if a, ok := s.accounts[name]; ok {
		return a
	}
	return nil
}

// HTTPClient exposes the shared outbound client (fal media adapter).
func (s *Store) HTTPClient() *http.Client { return s.httpClient }

func (s *Store) snapshotAccounts() []*Account {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Account, 0, len(s.accounts))
	for _, a := range s.accounts {
		out = append(out, a)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}
