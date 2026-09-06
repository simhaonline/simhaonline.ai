-- Simha capability abstraction and tenant operating data.
-- Additive migration: provider accounts, raw model names, and existing APIs stay intact.

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    region TEXT NOT NULL DEFAULT 'global',
    policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS organization_members (
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id, organization_id);

CREATE TABLE IF NOT EXISTS capability_buckets (
    slug TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 50,
    judge_weight NUMERIC(5,4) NOT NULL DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO capability_buckets(slug, display_name, description, priority) VALUES
 ('reasoning-heavy','Reasoning Heavy','Multi-step reasoning, math, planning, and research.',90),
 ('coding-specialist','Coding Specialist','Code generation, review, debugging, and technical agents.',85),
 ('multilingual','Multilingual','Translation and mixed-language understanding.',75),
 ('instruction-following','Instruction Following','Reliable structured and constrained responses.',70),
 ('creative-generation','Creative Generation','Writing, ideation, and style-sensitive generation.',60),
 ('data-analysis','Data Analysis','Tables, extraction, classification, and analytical work.',80),
 ('general-purpose','General Purpose','Safe fallback for ordinary text requests.',50)
ON CONFLICT (slug) DO UPDATE SET display_name=EXCLUDED.display_name, description=EXCLUDED.description, priority=EXCLUDED.priority;

CREATE TABLE IF NOT EXISTS canonical_models (
    id BIGSERIAL PRIMARY KEY,
    canonical_name TEXT UNIQUE NOT NULL,
    bucket_slug TEXT NOT NULL REFERENCES capability_buckets(slug),
    public_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS model_aliases (
    provider_model TEXT NOT NULL,
    account_name TEXT NOT NULL REFERENCES accounts(name) ON DELETE CASCADE,
    canonical_model_id BIGINT NOT NULL REFERENCES canonical_models(id) ON DELETE CASCADE,
    capability_score NUMERIC(5,2) NOT NULL DEFAULT 60,
    confidence_score NUMERIC(5,2) NOT NULL DEFAULT 50,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_verified_at TIMESTAMPTZ,
    PRIMARY KEY (provider_model, account_name)
);
CREATE INDEX IF NOT EXISTS idx_model_aliases_canonical ON model_aliases(canonical_model_id, enabled);
CREATE INDEX IF NOT EXISTS idx_model_aliases_provider_model ON model_aliases(provider_model, enabled);

CREATE TABLE IF NOT EXISTS model_capability_buckets (
    model TEXT NOT NULL,
    bucket_slug TEXT NOT NULL REFERENCES capability_buckets(slug) ON DELETE CASCADE,
    score NUMERIC(5,2) NOT NULL DEFAULT 60,
    confidence NUMERIC(5,2) NOT NULL DEFAULT 50,
    source TEXT NOT NULL DEFAULT 'discovery',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(model, bucket_slug)
);
CREATE INDEX IF NOT EXISTS idx_model_bucket_rank ON model_capability_buckets(bucket_slug, score DESC, confidence DESC);

-- Seed one neutral canonical bucket per discovered model. Operators can merge
-- equivalent aliases later without changing provider-facing model parameters.
INSERT INTO canonical_models(canonical_name, bucket_slug, public_name)
SELECT 'provider:' || md5(model), 'general-purpose', model
FROM (SELECT DISTINCT model FROM discovered_models WHERE enabled) discovered
ON CONFLICT (canonical_name) DO NOTHING;
INSERT INTO model_aliases(provider_model, account_name, canonical_model_id, capability_score, confidence_score, last_verified_at)
SELECT dm.model, dm.account_name, cm.id, 60, 50, dm.last_seen
FROM discovered_models dm
JOIN canonical_models cm ON cm.canonical_name = 'provider:' || md5(dm.model)
WHERE dm.enabled
ON CONFLICT (provider_model, account_name) DO UPDATE SET last_verified_at=EXCLUDED.last_verified_at;

-- Conservative name signals create useful initial buckets. Judge outcomes and
-- operator edits can replace these scores; no benchmark claims are invented.
INSERT INTO model_capability_buckets(model, bucket_slug, score, confidence, source)
SELECT DISTINCT model,
 CASE
   WHEN lower(model) ~ '(reason|r1|o1|o3|math|qwq|thinking)' THEN 'reasoning-heavy'
   WHEN lower(model) ~ '(code|coder|codestral|starcoder|dev)' THEN 'coding-specialist'
   WHEN lower(model) ~ '(translate|trans|aya|seamless|multilingual)' THEN 'multilingual'
   WHEN lower(model) ~ '(creative|story|writer)' THEN 'creative-generation'
   WHEN lower(model) ~ '(vision|vl|llava|qwen2-vl|gemini|gpt-4o|claude)' THEN 'instruction-following'
   WHEN lower(model) ~ '(tabular|table|sql|analyst|data)' THEN 'data-analysis'
   ELSE 'general-purpose'
 END,
 60, 50, 'discovery-heuristic'
FROM discovered_models
WHERE enabled
ON CONFLICT (model, bucket_slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS organization_budgets (
    organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
    monthly_limit_usd NUMERIC(14,2) CHECK (monthly_limit_usd IS NULL OR monthly_limit_usd >= 0),
    alert_threshold_percent NUMERIC(5,2) NOT NULL DEFAULT 80 CHECK (alert_threshold_percent BETWEEN 1 AND 100),
    auto_downgrade BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_cost_events (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    client_key_id BIGINT REFERENCES client_api_keys(id) ON DELETE SET NULL,
    project TEXT,
    model TEXT NOT NULL,
    task_slug TEXT REFERENCES task_capabilities(slug) ON DELETE SET NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd NUMERIC(14,8) NOT NULL DEFAULT 0,
    cache_hit BOOLEAN NOT NULL DEFAULT FALSE,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_cost_org_time ON usage_cost_events(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_cost_key_time ON usage_cost_events(client_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_cost_model_time ON usage_cost_events(model, created_at DESC);

CREATE TABLE IF NOT EXISTS prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    active_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organization_id, slug)
);
CREATE TABLE IF NOT EXISTS prompt_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id UUID NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    body TEXT NOT NULL,
    variables_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    changelog TEXT NOT NULL DEFAULT '',
    quality_score NUMERIC(5,2),
    usage_count BIGINT NOT NULL DEFAULT 0,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(prompt_id, version)
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id, version DESC);

CREATE TABLE IF NOT EXISTS knowledge_bases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    embedding_dimensions INTEGER NOT NULL DEFAULT 384,
    policy_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    knowledge_base_id UUID NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    source_uri TEXT,
    title TEXT NOT NULL,
    checksum TEXT NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(knowledge_base_id, checksum)
);
CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(384),
    token_estimate INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(document_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_kb ON knowledge_documents(knowledge_base_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document ON knowledge_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge_chunks USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

INSERT INTO schema_migrations(version, checksum)
VALUES ('008-capability-abstraction', 'capability-buckets-aliases-budgets-prompts-rag')
ON CONFLICT (version) DO NOTHING;
