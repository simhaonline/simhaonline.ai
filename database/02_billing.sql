-- Simha Online — billing: plans, plan limits, subscriptions, invoices
-- Idempotent: safe to re-run against a live database.

-- ============ plans ============

CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,                       -- free | pro | business
    name TEXT NOT NULL,
    price_monthly_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
    -- limits
    requests_per_day BIGINT NOT NULL DEFAULT -1,   -- -1 = unlimited
    requests_per_month BIGINT NOT NULL DEFAULT -1,
    max_keys INT NOT NULL DEFAULT 3,
    rate_limit_per_min INT NOT NULL DEFAULT 20,    -- gateway RPM
    models_scope TEXT NOT NULL DEFAULT 'all',      -- 'all' | 'fast' (later: per-model)
    sort_order INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ invoices (manual/bank billing; gateway for Stripe later) ============

CREATE TABLE IF NOT EXISTS invoices (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    amount_usd NUMERIC(10,2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','paid','cancelled','refunded')),
    method TEXT,                               -- bank / card / crypto note
    reference TEXT,                            -- bank ref / tx id entered by admin
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id, created_at DESC);

-- ============ subscriptions: extend the legacy-shaped table ============
-- Existing: id, user_id UNIQUE, provider, external_id, tier, status, created_at, updated_at

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES plans(id),
    ADD COLUMN IF NOT EXISTS current_period_start DATE,
    ADD COLUMN IF NOT EXISTS current_period_end DATE,
    ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;

-- ============ seed default plans ============

INSERT INTO plans (id, name, price_monthly_usd, requests_per_day, requests_per_month,
                   max_keys, rate_limit_per_min, sort_order)
VALUES
    ('free',     'Free',             0.00,  200,  3000,  1, 10,  0),
    ('pro',      'Pro',             19.00, 5000,  80000, 5, 60,  1),
    ('business', 'Business',        99.00,   -1,    -1, 20, 300, 2)
ON CONFLICT (id) DO NOTHING;

-- ============ usage rollup view for quota checks (last 24h / 30d per user) ============

CREATE MATERIALIZED VIEW IF NOT EXISTS user_usage_daily AS
SELECT user_id,
       count(*) FILTER (WHERE requested_at > now() - interval '24 hours') AS requests_24h,
       count(*) FILTER (WHERE requested_at > now() - interval '30 days') AS requests_30d
FROM request_history
WHERE user_id IS NOT NULL
GROUP BY user_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_usage_daily_uid ON user_usage_daily(user_id);