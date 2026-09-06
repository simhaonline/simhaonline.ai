-- Clean routing intelligence: additive model/task scores and provider pricing.
CREATE TABLE IF NOT EXISTS model_route_scores (
    model TEXT NOT NULL,
    task_slug TEXT NOT NULL REFERENCES task_capabilities(slug) ON DELETE CASCADE,
    elo NUMERIC(8,2) NOT NULL DEFAULT 1500,
    quality_score NUMERIC(5,2) NOT NULL DEFAULT 60,
    reliability_score NUMERIC(5,2) NOT NULL DEFAULT 90,
    avg_latency_ms NUMERIC(12,2),
    battle_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (model, task_slug)
);
CREATE INDEX IF NOT EXISTS idx_model_route_scores_task ON model_route_scores(task_slug, elo DESC, quality_score DESC);

CREATE TABLE IF NOT EXISTS model_pricing (
    account_name TEXT NOT NULL REFERENCES accounts(name) ON DELETE CASCADE,
    model TEXT NOT NULL,
    input_cost_per_million NUMERIC(14,6) NOT NULL DEFAULT 0,
    output_cost_per_million NUMERIC(14,6) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (account_name, model)
);
CREATE INDEX IF NOT EXISTS idx_model_pricing_model ON model_pricing(model, input_cost_per_million, output_cost_per_million);

-- Give newly discovered models an honest neutral prior for text routing.
INSERT INTO task_capabilities(slug, display_name, input_modalities, output_modalities, architecture_families)
VALUES
 ('code-generation', 'Code Generation', ARRAY['text'], ARRAY['text','code'], ARRAY['code transformer']),
 ('mathematical-reasoning', 'Mathematical Reasoning', ARRAY['text'], ARRAY['text','number'], ARRAY['reasoning transformer'])
ON CONFLICT (slug) DO UPDATE SET display_name=EXCLUDED.display_name, updated_at=now();

INSERT INTO model_route_scores(model, task_slug)
SELECT DISTINCT dm.model, 'text-generation'
FROM discovered_models dm
WHERE dm.enabled
ON CONFLICT (model, task_slug) DO NOTHING;

INSERT INTO model_route_scores(model, task_slug)
SELECT DISTINCT mc.model, mc.capability_slug
FROM model_capabilities mc
WHERE mc.enabled
ON CONFLICT (model, task_slug) DO NOTHING;

INSERT INTO schema_migrations(version, checksum)
VALUES ('007-smart-routing', 'model-task-elo-quality-pricing')
ON CONFLICT (version) DO NOTHING;
