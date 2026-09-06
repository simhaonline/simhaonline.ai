package store

import (
	"context"
	"math"
	"sort"
	"strings"
)

// RouteScore is the small, explainable score used for model selection.
type RouteScore struct {
	Model        string
	ELO          float64
	Quality      float64
	Reliability  float64
	LatencyMS    float64
	InputCost    float64
	OutputCost   float64
	AccountCount int
	Total        float64
}

// SelectModel chooses a model only after checking that at least one account
// can actually serve it. Task scores fall back to the neutral text prior until
// a task has recorded evaluations; this prevents unmeasured models from being
// silently excluded.
func (s *Store) SelectModel(ctx context.Context, protocol, task, mode string, threshold float64) (string, RouteScore, []RouteScore) {
	rows, err := s.Pool.Query(ctx, `
		SELECT dm.model,
		       COALESCE(task.elo, text.elo, 1500),
		       COALESCE(task.quality_score, text.quality_score, 60),
		       COALESCE(task.reliability_score, text.reliability_score, 90),
		       COALESCE(task.avg_latency_ms, text.avg_latency_ms, 0),
		       COALESCE(price.input_cost_per_million, 0),
		       COALESCE(price.output_cost_per_million, 0)
		FROM (SELECT DISTINCT model FROM discovered_models WHERE enabled=true) dm
		LEFT JOIN model_route_scores task ON task.model=dm.model AND task.task_slug=$1
		LEFT JOIN model_route_scores text ON text.model=dm.model AND text.task_slug='text-generation'
		LEFT JOIN (
			SELECT model, MIN(input_cost_per_million) AS input_cost_per_million,
			       MIN(output_cost_per_million) AS output_cost_per_million
			FROM model_pricing GROUP BY model
		) price ON price.model=dm.model`, task)
	if err != nil {
		return "", RouteScore{}, nil
	}
	defer rows.Close()
	all := make([]RouteScore, 0, 64)
	for rows.Next() {
		var score RouteScore
		if rows.Scan(&score.Model, &score.ELO, &score.Quality, &score.Reliability, &score.LatencyMS, &score.InputCost, &score.OutputCost) != nil {
			continue
		}
		eligible := s.EligibleAccounts(ctx, score.Model, protocol, threshold)
		// For an explicit specialist task, prefer accounts that have a
		// discovered capability record. If discovery has not produced one yet,
		// retain the normal model eligibility as a compatibility fallback; the
		// caller still applies strict task validation before forwarding.
		if task != "" && task != "text-generation" {
			if capable := s.EligibleAccountsForTask(ctx, score.Model, protocol, task, "", "", threshold); len(capable) > 0 {
				eligible = capable
			}
		}
		if len(eligible) == 0 {
			continue
		}
		score.AccountCount = len(eligible)
		score.Total = routeTotal(score, mode)
		all = append(all, score)
	}
	if len(all) == 0 {
		return "", RouteScore{}, nil
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].Total != all[j].Total {
			return all[i].Total > all[j].Total
		}
		return all[i].Model < all[j].Model
	})
	return all[0].Model, all[0], all
}

func routeTotal(s RouteScore, mode string) float64 {
	elo := clamp((s.ELO-1000)/10, 0, 100)
	quality := clamp(s.Quality, 0, 100)
	reliability := clamp(s.Reliability, 0, 100)
	// A model served by several healthy accounts is materially more reliable
	// than an otherwise equal model backed by one upstream account.
	redundancy := clamp(float64(s.AccountCount)*20, 20, 100)
	reliability = reliability*.75 + redundancy*.25
	latency := 100.0
	if s.LatencyMS > 0 {
		latency = clamp(100-(s.LatencyMS/20), 0, 100)
	}
	cost := 100.0
	if total := s.InputCost + s.OutputCost; total > 0 {
		cost = clamp(100-(total*20), 0, 100)
	} else {
		// Unknown pricing is neutral; it must not win "cheapest" routing by
		// pretending to be free.
		cost = 50
	}
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "quality", "best-quality":
		return elo*.40 + quality*.35 + reliability*.20 + latency*.03 + cost*.02
	case "fast", "fastest":
		return latency*.40 + reliability*.25 + elo*.20 + quality*.10 + cost*.05
	case "cost", "cheapest":
		return cost*.40 + reliability*.30 + quality*.15 + elo*.10 + latency*.05
	default:
		return elo*.30 + quality*.30 + reliability*.20 + latency*.10 + cost*.10
	}
}

func clamp(v, low, high float64) float64 { return math.Max(low, math.Min(high, v)) }
