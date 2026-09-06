// simha-router-opt — standalone routing-optimization engine (OmniRoute-inspired).
//
// Re-implements three methodology pillars as an advisory, read-only optimizer:
//   1. pool deduplication    — one upstream account can be reached via many
//     provider entries; dedupe by base URL+model to expose true pool capacity.
//   2. credit tier management — accounts carry credit tiers with usage
//     thresholds and cooldowns; pick accounts with tier headroom first.
//   3. provider terms parsing — rate limits / concurrency / TOS phrases are
//     parsed into structured facts used to gate advisory picks.
//
// Fully isolated: no DB, no imports from the main stack, and it never mutates
// gateway state — picks are advisory output only.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ProviderEntry describes one upstream account entry (input shape).
type ProviderEntry struct {
	ID          string    `json:"id"`
	Provider    string    `json:"provider"`
	BaseURL     string    `json:"base_url"`
	Model       string    `json:"model"`
	CreditTier  int       `json:"credit_tier"` // 1=premium ... 4=free/overflow
	TierName    string    `json:"tier_name,omitempty"`
	CreditsLeft float64   `json:"credits_left"`
	CreditsMax  float64   `json:"credits_max"`
	UsageRatio  float64   `json:"usage_ratio"` // 0..1
	CooldownTil time.Time `json:"cooldown_until,omitempty"`
	RPMLimit    int       `json:"rpm_limit,omitempty"`
	TPMLimit    int       `json:"tpm_limit,omitempty"`
	ConcLimit   int       `json:"concurrency_limit,omitempty"`
	TermsNotes  string    `json:"terms_notes,omitempty"`
}

// TermsFacts is the structured output of provider-terms parsing.
type TermsFacts struct {
	EntryID    string   `json:"entry_id"`
	RPMLimit   int      `json:"rpm_limit,omitempty"`
	TPMLimit   int      `json:"tpm_limit,omitempty"`
	ConcLimit  int      `json:"concurrency_limit,omitempty"`
	NoResale   bool     `json:"no_resale"`
	NoSubusers bool     `json:"no_subusers"`
	Restrict   []string `json:"restrictions"`
	Raw        string   `json:"raw_excerpt,omitempty"`
}

// PoolDedupRow collapses duplicate upstream accounts reachable via several
// provider entries into one deduplicated capacity row.
type PoolDedupRow struct {
	Model       string   `json:"model"`
	BaseURL     string   `json:"base_url"`
	UniqueCount int      `json:"unique_count"`
	EntryIDs    []string `json:"entry_ids"`
	Providers   []string `json:"via_providers"`
	Healthy     int      `json:"healthy"`
}

// AccountPick is one advisory account choice.
type AccountPick struct {
	EntryID      string  `json:"entry_id"`
	Provider     string  `json:"provider"`
	Model        string  `json:"model"`
	Score        float64 `json:"score"`
	CreditTier   int     `json:"credit_tier"`
	TierHeadroom float64 `json:"tier_headroom"`
	UsageRatio   float64 `json:"usage_ratio"`
	Advisory     bool    `json:"advisory"`
	Reason       string  `json:"reason"`
}

// Report is the combined /optimize output.
type Report struct {
	GeneratedAt string         `json:"generated_at"`
	PoolDedup   []PoolDedupRow `json:"pool_dedup"`
	Picks       []AccountPick  `json:"picks"`
	Terms       []TermsFacts   `json:"terms"`
	Summary     map[string]any `json:"summary"`
}

// ── provider terms parsing ───────────────────────────────────────────────────

var (
	rpmRe = regexp.MustCompile(`(?i)(\d{1,6})\s*(?:requests?|reqs?)\s*(?:/|per\s+)?\s*min(?:ute)?\b|\brpm\b\s*[:=]?\s*(\d{1,6})`)
	tpmRe = regexp.MustCompile(`(?i)(\d{1,9})\s*tokens?\s*(?:/|per\s+)?\s*min(?:ute)?\b|\btpm\b\s*[:=]?\s*(\d{1,9})`)
	concRe = regexp.MustCompile(`(?i)(\d{1,4})\s*(?:concurrent|parallel)\s*(?:requests?|connections?|sessions?|users?|streams?)?`)
	noResaleRe  = regexp.MustCompile(`(?i)(?:no|not)\s+(?:\w+\s+){0,3}?(?:resale|reselling|resold|resell)|(?:resale|reselling|resold|resell)[^.;]{0,30}(?:prohibited|forbidden|not allowed)`)
	noSubuserRe = regexp.MustCompile(`(?i)(?:no|not)\s+(?:\w+\s+){0,3}?(?:sub-?users?|sub-?accounts?|sharing|shared)\b|(?:sub-?users?|sub-?accounts?)[^.;]{0,30}(?:prohibited|forbidden|not allowed|disallowed)`)
	restrictPhrases = []string{
		"personal use only", "single seat", "single user", "no api access",
		"fair use", "non-commercial", "educational use only", "not for production",
		"internal use only",
	}
)

func parseTerms(entryID, text string) TermsFacts {
	facts := TermsFacts{EntryID: entryID, Restrict: []string{}}
	if m := rpmRe.FindStringSubmatch(text); m != nil {
		val := m[1]
		if val == "" {
			val = m[2]
		}
		if v, err := strconv.Atoi(val); err == nil {
			facts.RPMLimit = v
		}
	}
	if m := tpmRe.FindStringSubmatch(text); m != nil {
		val := m[1]
		if val == "" {
			val = m[2]
		}
		if v, err := strconv.Atoi(val); err == nil {
			facts.TPMLimit = v
		}
	}
	if m := concRe.FindStringSubmatch(text); m != nil {
		if v, err := strconv.Atoi(m[1]); err == nil {
			facts.ConcLimit = v
		}
	}
	if noResaleRe.MatchString(text) {
		facts.NoResale = true
		facts.Restrict = append(facts.Restrict, "no-resale")
	}
	if noSubuserRe.MatchString(text) {
		facts.NoSubusers = true
		facts.Restrict = append(facts.Restrict, "no-subusers")
	}
	lower := strings.ToLower(text)
	for _, phrase := range restrictPhrases {
		if strings.Contains(lower, phrase) {
			facts.Restrict = append(facts.Restrict, phrase)
		}
	}
	facts.Raw = excerpt(text, 400)
	return facts
}

func excerpt(text string, n int) string {
	text = strings.Join(strings.Fields(text), " ")
	if len(text) > n {
		return text[:n] + "…"
	}
	return text
}

// ── pool deduplication ───────────────────────────────────────────────────────

func dedupePool(entries []ProviderEntry, now time.Time) []PoolDedupRow {
	type key struct{ base, model string }
	byKey := map[key]*PoolDedupRow{}
	order := []key{}
	for _, e := range entries {
		base := e.BaseURL
		base = strings.TrimPrefix(base, "https://")
		base = strings.TrimPrefix(base, "http://")
		base = strings.TrimSuffix(base, "/")
		k := key{base, e.Model}
		row, ok := byKey[k]
		if !ok {
			row = &PoolDedupRow{Model: e.Model, BaseURL: base}
			byKey[k] = row
			order = append(order, k)
		}
		row.EntryIDs = append(row.EntryIDs, e.ID)
		row.Providers = append(row.Providers, e.Provider)
		row.UniqueCount++
		if healthy(e, now) {
			row.Healthy++
		}
	}
	out := make([]PoolDedupRow, 0, len(order))
	for _, k := range order {
		r := byKey[k]
		r.Providers = uniqueStrings(r.Providers)
		out = append(out, *r)
	}
	return out
}

func healthy(e ProviderEntry, now time.Time) bool {
	if !e.CooldownTil.IsZero() && e.CooldownTil.After(now) {
		return false
	}
	if e.UsageRatio >= 0.95 {
		return false
	}
	if e.CreditsMax > 0 && e.CreditsLeft <= 0 {
		return false
	}
	return true
}

func uniqueStrings(in []string) []string {
	seen := map[string]struct{}{}
	out := []string{}
	for _, s := range in {
		if _, dup := seen[s]; !dup {
			seen[s] = struct{}{}
			out = append(out, s)
		}
	}
	return out
}

// ── credit-tier pick logic ───────────────────────────────────────────────────

func eligible(e ProviderEntry, threshold float64, now time.Time) (bool, string) {
	if !e.CooldownTil.IsZero() && e.CooldownTil.After(now) {
		return false, fmt.Sprintf("cooldown until %s", e.CooldownTil.UTC().Format(time.RFC3339))
	}
	if e.UsageRatio >= threshold {
		return false, fmt.Sprintf("usage %.0f%% >= threshold %.0f%%", e.UsageRatio*100, threshold*100)
	}
	if e.CreditsMax > 0 && e.CreditsLeft <= 0 {
		return false, "exhausted credits"
	}
	return true, ""
}

// pickAccounts scores eligible entries: tier headroom dominates, then usage
// ratio, then a small penalty for higher (more constrained) tier numbers.
func pickAccounts(entries []ProviderEntry, model string, threshold float64) ([]AccountPick, error) {
	now := time.Now()
	cands := []ProviderEntry{}
	for _, e := range entries {
		if model == "" || strings.EqualFold(e.Model, model) || e.Model == "" {
			cands = append(cands, e)
		}
	}
	if len(cands) == 0 {
		return nil, fmt.Errorf("no entries for model %q", model)
	}
	picks := []AccountPick{}
	for _, e := range cands {
		ok, why := eligible(e, threshold, now)
		if !ok {
			continue
		}
		headroom := 1.0 - e.UsageRatio
		score := headroom*100.0 - float64(e.CreditTier)*5.0
		if e.RPMLimit > 0 || e.ConcLimit > 0 {
			score += 2.0 // known limits beat unknown ones
		}
		reason := fmt.Sprintf("tier %d headroom %.0f%%", e.CreditTier, headroom*100)
		if why == "" && e.TierName != "" {
			reason += " (" + e.TierName + ")"
		}
		picks = append(picks, AccountPick{
			EntryID:      e.ID,
			Provider:     e.Provider,
			Model:        e.Model,
			Score:        round2(score),
			CreditTier:   e.CreditTier,
			TierHeadroom: round2(headroom),
			UsageRatio:   e.UsageRatio,
			Advisory:     true,
			Reason:       reason,
		})
	}
	sort.Slice(picks, func(i, j int) bool { return picks[i].Score > picks[j].Score })
	return picks, nil
}

func round2(f float64) float64 { return float64(int(f*100+0.5)) / 100 }

// ── HTTP layer ───────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func thresholdOr(v float64) float64 {
	if v <= 0 || v >= 1 {
		return 0.9
	}
	return v
}

type TermsParseReq struct {
	Text string `json:"text"`
}

type PoolDedupReq struct {
	Entries []ProviderEntry `json:"entries"`
}

type TierPickReq struct {
	Entries        []ProviderEntry `json:"entries"`
	Model          string          `json:"model"`
	UsageThreshold float64         `json:"usage_threshold"`
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lmsgprefix)
	log.SetPrefix("simha-router-opt ")

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"status": "ok", "service": "simha-router-opt"})
	})

	mux.HandleFunc("/terms/parse", func(w http.ResponseWriter, r *http.Request) {
		var req TermsParseReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, 400, map[string]string{"error": "bad json"})
			return
		}
		facts := parseTerms("ad-hoc", req.Text)
		writeJSON(w, 200, facts)
	})

	mux.HandleFunc("/pool/dedup", func(w http.ResponseWriter, r *http.Request) {
		var req PoolDedupReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, 400, map[string]any{"error": "bad json"})
			return
		}
		rows := dedupePool(req.Entries, time.Now())
		writeJSON(w, 200, map[string]any{"rows": rows, "unique_models": len(rows)})
	})

	mux.HandleFunc("/picks", func(w http.ResponseWriter, r *http.Request) {
		var req TierPickReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, 400, map[string]any{"error": "bad json"})
			return
		}
		picks, err := pickAccounts(req.Entries, req.Model, thresholdOr(req.UsageThreshold))
		if err != nil {
			writeJSON(w, 422, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, 200, map[string]any{"picks": picks, "count": len(picks)})
	})

	mux.HandleFunc("/optimize", func(w http.ResponseWriter, r *http.Request) {
		var req TierPickReq
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, 400, map[string]any{"error": "bad json"})
			return
		}
		now := time.Now()
		rows := dedupePool(req.Entries, now)
		picks, err := pickAccounts(req.Entries, req.Model, thresholdOr(req.UsageThreshold))
		if err != nil {
			writeJSON(w, 422, map[string]any{"error": err.Error()})
			return
		}
		terms := make([]TermsFacts, 0, len(req.Entries))
		for _, e := range req.Entries {
			if strings.TrimSpace(e.TermsNotes) != "" {
				terms = append(terms, parseTerms(e.ID, e.TermsNotes))
			}
		}
		totalUnique := 0
		for _, row := range rows {
			totalUnique += row.UniqueCount
		}
		report := Report{
			GeneratedAt: now.UTC().Format(time.RFC3339),
			PoolDedup:   rows,
			Picks:       picks,
			Terms:       terms,
			Summary: map[string]any{
				"input_entries":    len(req.Entries),
				"deduped_pools":    len(rows),
				"dedup_collisions": totalUnique - len(rows),
				"advisory_picks":   len(picks),
				"advisory_only":    true,
			},
		}
		writeJSON(w, 200, report)
	})

	addr := os.Getenv("ROUTER_OPT_ADDR")
	if addr == "" {
		addr = ":8113"
	}
	log.Printf("listening on %s", addr)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}