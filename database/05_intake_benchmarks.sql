-- Simha Intake Dock + Benchmark observability.
-- Additive only: existing chat, router, and library tables remain unchanged.

CREATE TABLE IF NOT EXISTS user_storage_quotas (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    quota_bytes BIGINT NOT NULL DEFAULT 5368709120 CHECK (quota_bytes > 0),
    used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Normalize pre-preset Fal accounts without changing credentials or ownership.
UPDATE accounts
SET provider = 'fal', updated_at = now()
WHERE lower(provider) = 'custom'
  AND lower(base_url) LIKE '%api.fal.ai%';

CREATE TABLE IF NOT EXISTS file_ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','partial','failed','cancelled')),
    source TEXT NOT NULL DEFAULT 'local_upload' CHECK (source IN ('local_upload','web_search','library','generated')),
    options_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_file_ingestion_jobs_owner ON file_ingestion_jobs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_ingestion_jobs_status ON file_ingestion_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS file_ingestion_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES file_ingestion_jobs(id) ON DELETE CASCADE,
    owner_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    mime_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
    sha256 TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','blocked')),
    parser TEXT NOT NULL DEFAULT 'pending',
    extracted_text TEXT NOT NULL DEFAULT '',
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE file_ingestion_files ADD COLUMN IF NOT EXISTS storage_backend TEXT NOT NULL DEFAULT 'local';
ALTER TABLE file_ingestion_files ADD COLUMN IF NOT EXISTS storage_bucket TEXT;
CREATE INDEX IF NOT EXISTS idx_file_ingestion_files_job ON file_ingestion_files(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_file_ingestion_files_owner ON file_ingestion_files(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_file_ingestion_files_sha ON file_ingestion_files(owner_user_id, sha256);

CREATE TABLE IF NOT EXISTS file_ingestion_chunks (
    id BIGSERIAL PRIMARY KEY,
    file_id UUID NOT NULL REFERENCES file_ingestion_files(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    embedding vector(384),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(file_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_file_ingestion_chunks_file ON file_ingestion_chunks(file_id, chunk_index);

CREATE TABLE IF NOT EXISTS connector_runs (
    id BIGSERIAL PRIMARY KEY,
    owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    connector TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started','completed','failed','blocked')),
    request_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connector_runs_owner_time ON connector_runs(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_runs_connector_time ON connector_runs(connector, created_at DESC);

CREATE TABLE IF NOT EXISTS benchmark_models (
    model TEXT PRIMARY KEY,
    organization TEXT NOT NULL DEFAULT 'Unknown',
    open_weights BOOLEAN NOT NULL DEFAULT false,
    context_window INTEGER,
    modalities TEXT[] NOT NULL DEFAULT ARRAY['text']::TEXT[],
    specifications_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS benchmark_scores (
    model TEXT NOT NULL REFERENCES benchmark_models(model) ON DELETE CASCADE,
    category TEXT NOT NULL,
    score NUMERIC(7,3),
    sample_count INTEGER NOT NULL DEFAULT 0,
    confidence_low NUMERIC(7,3),
    confidence_high NUMERIC(7,3),
    measured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(model, category)
);
CREATE INDEX IF NOT EXISTS idx_benchmark_scores_category ON benchmark_scores(category, score DESC NULLS LAST);
CREATE TABLE IF NOT EXISTS benchmark_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model TEXT REFERENCES benchmark_models(model) ON DELETE SET NULL,
    category TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
    prompt_count INTEGER NOT NULL DEFAULT 0,
    pass_count INTEGER NOT NULL DEFAULT 0,
    metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_model_time ON benchmark_runs(model, created_at DESC);
