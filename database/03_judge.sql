-- 03_judge.sql — Judge Engine integration (runs on first boot; apply live via
-- docker exec simha-postgres psql -U simha -d simhaonline -f - < this file).
-- Judge configuration itself lives in app_settings key 'judge_policy' (JSON),
-- so admins can change judge models without restarts. This table stores every
-- judge execution for health/latency/token/cost/failure statistics.

CREATE TABLE IF NOT EXISTS judge_runs (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    task_type TEXT NOT NULL DEFAULT 'single',          -- single|pairwise|multi|test
    subject_ref TEXT NOT NULL DEFAULT '',              -- chat msg id / battle id / ad-hoc
    mode TEXT NOT NULL DEFAULT 'auto',                 -- policy mode at execution time
    chain TEXT NOT NULL DEFAULT '[]',                  -- JSON array of {account, model} attempted
    judge_account TEXT,
    judge_model TEXT,
    backend TEXT NOT NULL DEFAULT 'heuristic',         -- llm|heuristic
    verdict JSONB,
    winner TEXT,                                       -- a|b|tie (pairwise only)
    consistency TEXT,                                  -- consistent|position_bias_detected
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    cost_estimate NUMERIC,                             -- null = UNKNOWN (no pricing source)
    latency_ms INTEGER,
    failovers INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','failed','degraded')),
    error TEXT
);
CREATE INDEX IF NOT EXISTS idx_judge_runs_created ON judge_runs (created_at);
CREATE INDEX IF NOT EXISTS idx_judge_runs_model ON judge_runs (judge_model, created_at);