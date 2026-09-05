-- Simha Online — full schema (PostgreSQL 16 + pgvector + TimescaleDB)
-- Loaded by docker-entrypoint-initdb.d on first boot.
-- Extensions must exist before TimescaleDB extension creation (timescaledb-ha image ships them).

CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============ core identity ============

CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    -- pbkdf2$<salt>$<hex> — legacy-compatible format (250k iterations sha256)
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin','operator')),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE client_api_keys (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    -- sha256 hex of raw key
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    request_count BIGINT NOT NULL DEFAULT 0,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL
);

-- upstream provider accounts
CREATE TABLE accounts (
    name TEXT PRIMARY KEY,
    base_url TEXT NOT NULL,
    api_key TEXT,
    provider TEXT NOT NULL DEFAULT 'ollama',
    protocol TEXT NOT NULL DEFAULT 'openai' CHECK (protocol IN ('openai','anthropic','ollama')),
    api_prefix TEXT NOT NULL DEFAULT '/v1',
    auth_mode TEXT NOT NULL DEFAULT 'api_key' CHECK (auth_mode IN ('api_key','oauth2')),
    oauth_token_file TEXT,
    oauth_token_url TEXT,
    oauth_client_id TEXT,
    oauth_client_secret TEXT,
    wildcard BOOLEAN NOT NULL DEFAULT FALSE,
    limits_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE discovered_models (
    model TEXT NOT NULL,
    account_name TEXT NOT NULL REFERENCES accounts(name) ON DELETE CASCADE,
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (model, account_name)
);

CREATE TABLE model_policies (
    model TEXT PRIMARY KEY,
    max_input_tokens INTEGER NOT NULL DEFAULT 128000,
    min_output_tokens INTEGER NOT NULL DEFAULT 8192,
    max_output_tokens INTEGER NOT NULL DEFAULT 16384,
    max_tool_result_chars INTEGER NOT NULL DEFAULT 24000,
    dedupe_system_messages BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- '*' wildcard policy row acts as the default
INSERT INTO model_policies(model) VALUES ('*');

CREATE TABLE oauth_provider_configs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    client_id TEXT NOT NULL,
    client_secret_enc BYTEA,
    client_secret_nonce BYTEA,
    client_secret_tag BYTEA,
    authorization_url TEXT NOT NULL,
    token_url TEXT NOT NULL,
    scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    flow_type TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    extra_config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, name)
);

CREATE TABLE oauth_states (
    state_hash TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    nonce TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);

CREATE TABLE oauth_authorization_sessions (
    id TEXT PRIMARY KEY,
    state_hash TEXT UNIQUE NOT NULL,
    pkce_verifier_enc BYTEA,
    pkce_verifier_nonce BYTEA,
    pkce_verifier_tag BYTEA,
    provider_config_id TEXT NOT NULL REFERENCES oauth_provider_configs(id),
    account_profile_id TEXT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_oauth_sessions_expiry ON oauth_authorization_sessions(expires_at);

CREATE TABLE oauth_credentials (
    account_name TEXT PRIMARY KEY,
    provider_config_id TEXT NOT NULL REFERENCES oauth_provider_configs(id),
    access_token_enc BYTEA,
    access_token_nonce BYTEA,
    access_token_tag BYTEA,
    refresh_token_enc BYTEA,
    refresh_token_nonce BYTEA,
    refresh_token_tag BYTEA,
    expires_at TIMESTAMPTZ,
    scope_json JSONB NOT NULL DEFAULT '[]'::pg_catalog.jsonb,
    reauthentication_required BOOLEAN NOT NULL DEFAULT FALSE,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ chat workbench ============

CREATE TABLE projects (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    purpose TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE chat_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id BIGINT REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'chat',
    model TEXT NOT NULL DEFAULT 'auto',
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_user_updated ON chat_history(user_id, archived, updated_at DESC);
CREATE INDEX idx_chat_project ON chat_history(project_id, updated_at DESC);

CREATE TABLE chat_messages (
    id BIGSERIAL PRIMARY KEY,
    chat_id BIGINT NOT NULL REFERENCES chat_history(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
    content TEXT NOT NULL,
    model TEXT,
    tokens INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_chat_time ON chat_messages(chat_id, created_at);

CREATE TABLE saved_resources (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'prompt',
    content TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scheduled_tasks (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed','cancelled')),
    run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_settings (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feature_catalog (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('plugin','agent','skill')),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    permission TEXT NOT NULL DEFAULT 'ask_first' CHECK (permission IN ('allowed','ask_first','disabled')),
    enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE user_features (
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_id BIGINT NOT NULL REFERENCES feature_catalog(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    permission TEXT CHECK (permission IN ('allowed','ask_first','disabled')),
    PRIMARY KEY (user_id, feature_id)
);

CREATE TABLE generated_content (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    prompt TEXT NOT NULL,
    result_ref TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT,
    external_id TEXT,
    tier TEXT NOT NULL DEFAULT 'free',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE feedback (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_metrics (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    target TEXT,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_usage_metrics_user_time ON usage_metrics(user_id, created_at DESC);

CREATE TABLE status_subscriptions (
    email TEXT PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail_json JSONB
);
CREATE INDEX idx_audit_time ON audit_log(created_at DESC);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============ TimescaleDB: request telemetry ============

CREATE TABLE request_history (
    requested_at TIMESTAMPTZ NOT NULL,
    account_name TEXT,
    model TEXT,
    status INTEGER,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    user_id BIGINT,
    client_key_id BIGINT
);
SELECT create_hypertable('request_history', 'requested_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE);
CREATE INDEX idx_request_history_time ON request_history(requested_at DESC);
CREATE INDEX idx_request_history_user ON request_history(user_id, requested_at DESC);
CREATE INDEX idx_request_history_account ON request_history(account_name, requested_at DESC);
-- per-minute/day/week rolling windows and 30-day uptime read from this
CREATE INDEX idx_request_history_bucket ON request_history(requested_at, account_name);

ALTER TABLE request_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'account_name,model'
);
SELECT add_compression_policy('request_history', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('request_history', INTERVAL '180 days', if_not_exists => TRUE);

-- daily status health snapshots (public 30-day uptime)
CREATE TABLE status_checks (
    checked_at TIMESTAMPTZ NOT NULL,
    provider_ok BOOLEAN NOT NULL,
    models_ok BOOLEAN NOT NULL
);
SELECT create_hypertable('status_checks', 'checked_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE);
SELECT add_retention_policy('status_checks', INTERVAL '90 days', if_not_exists => TRUE);

-- ============ pgvector: semantic memory ============

CREATE TABLE semantic_memory (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    embedding vector(384) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_semantic_embedding ON semantic_memory
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- rolling per-account request windows (mirrors legacy request_windows, pruned by worker)
CREATE TABLE request_windows (
    id BIGSERIAL,
    account_name TEXT NOT NULL REFERENCES accounts(name) ON DELETE CASCADE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, requested_at)
);
CREATE INDEX idx_request_windows_account_time ON request_windows(account_name, requested_at DESC);
SELECT create_hypertable('request_windows', 'requested_at',
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE);
SELECT add_retention_policy('request_windows', INTERVAL '8 days', if_not_exists => TRUE);

-- ============ seed: feature catalog (same slugs as legacy) ============

INSERT INTO feature_catalog (kind, slug, name, description, permission) VALUES
    ('plugin','web-search','Web search','Search and cite live sources','allowed'),
    ('plugin','github-tools','GitHub tools','Issues, pull requests, and repositories','ask_first'),
    ('plugin','linear-workspace','Linear workspace','Projects, issues, and cycles','ask_first'),
    ('agent','general-assistant','General assistant','Clear answers and safe tool use','allowed'),
    ('agent','research-agent','Research agent','Source-aware research workflows','ask_first'),
    ('skill','system-design','System design','Architecture and rollout planning','allowed'),
    ('skill','python','Python','Implementation and debugging support','allowed'),
    ('skill','writing','Writing','Editing, structure, and tone','allowed');

INSERT INTO app_settings (key, value) VALUES
    ('schema_version', '1'),
    ('legacy_imported', 'false');