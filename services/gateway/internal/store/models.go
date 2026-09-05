// Accounts, model discovery, and policy loading.
package store

import (
	"net/http"
	"context"
	"encoding/json"
	"log"
	"os"
	"sort"
	"strings"
)

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
		MaxInput       int
		MinOutput      int
		MaxOutput      int
		MaxToolChars   int
		Dedupe         bool
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
	// non-blocking leader lock (30s TTL)
	err := s.Valkey.Do(ctx, s.Valkey.B().Set().Key(keyLock).Value("1").Nx().ExSeconds(30).Build()).Error()
	if err != nil {
		// NX failure means someone else holds it
		log.Printf("[discovery] refresh skipped (lock held): %v", err)
		return
	}
	defer s.Valkey.Do(context.Background(), s.Valkey.B().Del().Key(keyLock).Build())

	s.LoadAccounts(ctx)

	mapping := map[string][]string{} // model → accounts
	all := map[string]struct{}{}
	for _, a := range s.snapshotAccounts() {
		models, err := s.fetchModels(ctx, a)
		if err != nil {
			log.Printf("[discovery] %s: %v", a.Name, err)
			continue
		}
		for _, m := range models {
			all[m] = struct{}{}
			if !a.Wildcard {
				mapping[m] = append(mapping[m], a.Name)
			}
			// persist to DB for the dashboard
			_, _ = s.Pool.Exec(ctx, `
				INSERT INTO discovered_models(model, account_name, last_seen) VALUES($1,$2,now())
				ON CONFLICT (model, account_name) DO UPDATE SET last_seen=now()`, m, a.Name)
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

// fetchModels implements the legacy 3-tier fallback:
// <prefix>/models → /v1/models → ollama /api/tags
func (s *Store) fetchModels(ctx context.Context, a *Account) ([]string, error) {
	headers := s.UpstreamAuthHeaders(ctx, a)
	base := strings.TrimRight(a.BaseURL, "/")
	prefix := "/" + strings.Trim(a.APIPrefix, "/")

	type idList struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
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

	// tier 1: account prefix
	if ids, ok := try(base+prefix+"/models"); ok {
		return ids, nil
	}
	// tier 2: conventional /v1/models
	if prefix != "/v1" {
		if ids, ok := try(base+"/v1/models"); ok {
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