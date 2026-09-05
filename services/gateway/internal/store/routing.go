// Routing: cooldowns (Valkey), capacity budgets (rolling windows in Valkey),
// account selection (most remaining capacity, LRU tie-break), upstream auth.
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

const usageThresholdEnv = "USAGE_THRESHOLD"

// Protocol returns the normalized wire protocol for an account.
func (a *Account) Protocol2() string {
	switch strings.ToLower(a.Protocol) {
	case "openai", "anthropic", "ollama":
		return strings.ToLower(a.Protocol)
	}
	return "openai"
}

// Provider returns the display provider, falling back via hostname.
func (a *Account) ProviderName() string {
	if a.Provider != "" {
		return strings.ToLower(a.Provider)
	}
	return a.Protocol2()
}

// isCoolingDown checks the Valkey cooldown key.
func (s *Store) isCoolingDown(ctx context.Context, name string) bool {
	v, err := s.Valkey.Do(ctx, s.Valkey.B().Get().Key(keyCooldown+name).Build()).ToString()
	if err != nil {
		return false
	}
	until, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return false
	}
	return time.Now().Unix() < until
}

// SetCooldown stores a cooldown until timestamp in Valkey.
func (s *Store) SetCooldown(ctx context.Context, name string, seconds int64) {
	until := time.Now().Unix() + seconds
	s.Valkey.Do(ctx, s.Valkey.B().Set().Key(keyCooldown+name).
		Value(strconv.FormatInt(until, 10)).Build())
}

// addStrike increments consecutive 429 strikes and returns the new count.
func (s *Store) AddStrike(ctx context.Context, name string) int64 {
	n, _ := s.Valkey.Do(ctx, s.Valkey.B().Incr().Key(keyStrikes+name).Build()).ToInt64()
	s.Valkey.Do(ctx, s.Valkey.B().Expire().Key(keyStrikes+name).Seconds(86400).Build())
	return n
}

// clearStrikes resets the throttle strike counter after success.
func (s *Store) ClearStrikes(ctx context.Context, name string) {
	s.Valkey.Do(ctx, s.Valkey.B().Del().Key(keyStrikes+name).Build())
}

// markUsed records a successful dispatch timestamp (LRU tie-break).
func (s *Store) MarkUsed(ctx context.Context, name string) {
	s.Valkey.Do(ctx, s.Valkey.B().Set().Key(keyLastUsed+name).
		Value(strconv.FormatInt(time.Now().Unix(), 10)).Build())
}

// lastUsed returns the unix timestamp of the last success (0 if none).
func (s *Store) lastUsed(ctx context.Context, name string) int64 {
	v, err := s.Valkey.Do(ctx, s.Valkey.B().Get().Key(keyLastUsed+name).Build()).ToString()
	if err != nil {
		return 0
	}
	ts, _ := strconv.ParseInt(v, 10, 64)
	return ts
}

// reserve atomically records a request in the rolling windows and returns
// whether the account still has capacity (90% threshold on any window).
func (s *Store) Reserve(ctx context.Context, a *Account, threshold float64) bool {
	now := time.Now()
	pipe := s.Valkey.B()
	// zadd timestamps into minute/day/week sorted sets, then count
	counts := map[string]int64{}
	for _, w := range []struct {
		name   string
		window time.Duration
	}{
		{"minute", time.Minute}, {"day", 24 * time.Hour}, {"week", 7 * 24 * time.Hour},
	} {
		key := fmt.Sprintf("%s%s:%s", keyWin, a.Name, w.name)
		cutoff := strconv.FormatFloat(float64(now.Add(-w.window).Unix()), 'f', 0, 64)
		// count existing
		if n, err := s.Valkey.Do(ctx, pipe.Zcount().Key(key).Min(cutoff).Max("+inf").Build()).ToInt64(); err == nil {
			counts[w.name] = n
		}
	}
	// capacity check BEFORE recording
	lim := a.Limits
	checks := []struct {
		period string
		limit  int
	}{{"minute", lim.RPM}, {"day", lim.RPD}, {"week", lim.RPW}}
	for _, c := range checks {
		if c.limit > 0 && float64(counts[c.period]) >= float64(c.limit)*threshold {
			return false
		}
	}
	// record the request in each window
	tsf := float64(now.Unix())
	ts := strconv.FormatFloat(tsf, 'f', 0, 64)
	for _, w := range []string{"minute", "day", "week"} {
		key := fmt.Sprintf("%s%s:%s", keyWin, a.Name, w)
		_ = s.Valkey.Do(ctx, s.Valkey.B().Zadd().Key(key).ScoreMember().ScoreMember(tsf, ts).Build()).Error()
		// trim old entries lazily (keep sets bounded)
		_ = s.Valkey.Do(ctx, s.Valkey.B().Zremrangebyscore().Key(key).Min("-inf").Max(
			strconv.FormatFloat(float64(now.Add(-7*24*time.Hour).Unix()), 'f', 0, 64)).Build()).Error()
	}
	return true
}

// WindowCounts returns {minute,day,week} request counts for an account.
func (s *Store) WindowCounts(ctx context.Context, name string) map[string]int64 {
	now := time.Now()
	out := map[string]int64{}
	for _, w := range []struct {
		name   string
		window time.Duration
	}{
		{"minute", time.Minute}, {"day", 24 * time.Hour}, {"week", 7 * 24 * time.Hour},
	} {
		key := fmt.Sprintf("%s%s:%s", keyWin, name, w.name)
		cutoff := strconv.FormatFloat(float64(now.Add(-w.window).Unix()), 'f', 0, 64)
		if n, err := s.Valkey.Do(ctx, s.Valkey.B().Zcount().Key(key).Min(cutoff).Max("+inf").Build()).ToInt64(); err == nil {
			out[w.name] = n
		} else {
			out[w.name] = 0
		}
	}
	return out
}

// candidate describes one eligible account for selection.
type candidate struct {
	acc      *Account
	score    float64
	lastUsed int64
}

// SelectAccount implements the legacy scoring: unlimited accounts preferred,
// then most remaining capacity ratio (min across windows), then LRU.
func (s *Store) SelectAccount(ctx context.Context, cands []*Account, threshold float64) *Account {
	if len(cands) == 0 {
		return nil
	}
	list := make([]candidate, 0, len(cands))
	for _, a := range cands {
		score := float64(1 << 30) // effectively infinite for unlimited accounts
		lim := a.Limits
		counts := s.WindowCounts(ctx, a.Name)
		ratios := []float64{}
		if lim.RPM > 0 {
			ratios = append(ratios, 1-float64(counts["minute"])/float64(lim.RPM))
		}
		if lim.RPD > 0 {
			ratios = append(ratios, 1-float64(counts["day"])/float64(lim.RPD))
		}
		if lim.RPW > 0 {
			ratios = append(ratios, 1-float64(counts["week"])/float64(lim.RPW))
		}
		if len(ratios) > 0 {
			score = ratios[0]
			for _, r := range ratios[1:] {
				if r < score {
					score = r
				}
			}
		}
		list = append(list, candidate{acc: a, score: score, lastUsed: s.lastUsed(ctx, a.Name)})
	}
	// stable sort: score desc, then lastUsed asc
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].score != list[j].score {
			return list[i].score > list[j].score
		}
		return list[i].lastUsed < list[j].lastUsed
	})
	return list[0].acc
}

// EligibleAccounts filters accounts for a model: not cooling down, has
// capacity, serves the model (wildcard or discovered mapping).
func (s *Store) EligibleAccounts(ctx context.Context, model, protocol string, threshold float64) []*Account {
	var out []*Account
	for _, a := range s.snapshotAccounts() {
		if protocol != "" && a.Protocol2() != protocol {
			// legacy carve-out: ollama accounts historically used openai protocol
			if !(protocol == "ollama" && a.Protocol2() == "openai" && a.ProviderName() == "ollama") {
				continue
			}
		}
		if s.isCoolingDown(ctx, a.Name) {
			continue
		}
		if model != "" && !a.Wildcard {
			mapping := s.AccountsForModel(ctx, model)
			found := false
			for _, n := range mapping {
				if n == a.Name {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		// capacity pre-check (without recording)
		lim := a.Limits
		counts := s.WindowCounts(ctx, a.Name)
		blocked := false
		for _, c := range []struct {
			period string
			limit  int
		}{{"minute", lim.RPM}, {"day", lim.RPD}, {"week", lim.RPW}} {
			if c.limit > 0 && float64(counts[c.period]) >= float64(c.limit)*threshold {
				blocked = true
				break
			}
		}
		if blocked {
			continue
		}
		out = append(out, a)
	}
	return out
}

// upstreamAuthHeaders builds provider-specific auth headers. OAuth accounts
// delegate to the control-plane token broker via PlatformAPI (token stays
// server-side); token-file accounts are read by the control-plane too.
func (s *Store) UpstreamAuthHeaders(ctx context.Context, a *Account) map[string]string {
	if strings.EqualFold(a.AuthMode, "oauth2") || strings.EqualFold(a.AuthMode, "oauth") {
		token := s.oauthToken(ctx, a)
		if token != "" {
			return map[string]string{"Authorization": "Bearer " + token}
		}
		return map[string]string{}
	}
	if a.APIKey == nil || *a.APIKey == "" {
		return map[string]string{}
	}
	if a.Protocol2() == "anthropic" {
		return map[string]string{
			"x-api-key":         *a.APIKey,
			"anthropic-version": "2023-06-01",
		}
	}
	return map[string]string{"Authorization": "Bearer " + *a.APIKey}
}

// oauthToken asks the control-plane for a valid upstream access token
// (it owns the encrypted credentials + refresh logic).
func (s *Store) oauthToken(ctx context.Context, a *Account) string {
	if s.platformAPI == "" {
		return ""
	}
	req, err := http.NewRequestWithContext(ctx, "POST",
		strings.TrimRight(s.platformAPI, "/")+"/internal/oauth/token",
		strings.NewReader(fmt.Sprintf(`{"account":%q}`, a.Name)))
	if err != nil {
		return ""
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return ""
	}
	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return ""
	}
	return body.AccessToken
}

// DoUpstream executes an upstream request with dial+overall timeouts.
func (s *Store) DoUpstream(ctx context.Context, req *http.Request, overall time.Duration) (*http.Response, error) {
	client := &http.Client{
		Timeout:   overall,
		Transport: s.httpClient.Transport,
	}
	return client.Do(req)
}

// AccountStatus is a dashboard-friendly account health snapshot.
type AccountStatus struct {
	Name        string `json:"name"`
	CoolingDown bool   `json:"cooling_down"`
	HasCapacity bool   `json:"has_capacity"`
}

// SnapshotAccountStatus summarizes all cached accounts.
func (s *Store) SnapshotAccountStatus(ctx context.Context) []AccountStatus {
	var out []AccountStatus
	for _, a := range s.snapshotAccounts() {
		st := AccountStatus{Name: a.Name}
		st.CoolingDown = s.isCoolingDown(ctx, a.Name)
		counts := s.WindowCounts(ctx, a.Name)
		st.HasCapacity = true
		lim := a.Limits
		for _, c := range []struct {
			period string
			limit  int
		}{{"minute", lim.RPM}, {"day", lim.RPD}, {"week", lim.RPW}} {
			if c.limit > 0 && float64(counts[c.period]) >= float64(c.limit)*0.9 {
				st.HasCapacity = false
				break
			}
		}
		out = append(out, st)
	}
	return out
}

// HopHeaders lists headers never forwarded upstream (legacy forward filter).
var HopHeaders = map[string]struct{}{
	"host": {}, "content-length": {}, "connection": {}, "accept-encoding": {},
	"authorization": {}, "x-api-key": {}, "anthropic-version": {},
}