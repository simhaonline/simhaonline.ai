-- Simha Asset Library: reusable AI assets for Chat and Router.
-- Additive migration; saved_resources remains intact for legacy compatibility.

CREATE TABLE IF NOT EXISTS library_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    asset_type TEXT NOT NULL CHECK (asset_type IN ('prompt_kit','skill_module','agent_profile','mcp_connector','plugin_package','code_recipe','dataset','tool_definition','template','workflow','knowledge_hub')),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team','unlisted','public')),
    lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle IN ('draft','review','published','deprecated','archived')),
    current_version TEXT NOT NULL DEFAULT '1.0.0',
    tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    search_vector TSVECTOR,
    embedding vector(1536),
    usage_count BIGINT NOT NULL DEFAULT 0,
    quality_score NUMERIC(5,2),
    elo_rating NUMERIC(8,2) NOT NULL DEFAULT 1500,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(owner_user_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_library_assets_type_lifecycle ON library_assets(asset_type, lifecycle);
CREATE INDEX IF NOT EXISTS idx_library_assets_owner_updated ON library_assets(owner_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_assets_metadata ON library_assets USING GIN(metadata_json jsonb_path_ops);
CREATE INDEX IF NOT EXISTS idx_library_assets_search ON library_assets USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_library_assets_embedding ON library_assets USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=200);

CREATE TABLE IF NOT EXISTS library_asset_versions (
    id BIGSERIAL PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    content_json JSONB NOT NULL,
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    changelog TEXT NOT NULL DEFAULT '',
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(asset_id, version)
);
CREATE INDEX IF NOT EXISTS idx_library_asset_versions_asset ON library_asset_versions(asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS library_tags (
    id BIGSERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    parent_id BIGINT REFERENCES library_tags(id) ON DELETE SET NULL,
    synonyms TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS library_asset_tags (
    asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES library_tags(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'user',
    PRIMARY KEY(asset_id, tag_id)
);

CREATE TABLE IF NOT EXISTS library_asset_relationships (
    source_asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    target_asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL CHECK (relationship IN ('uses','depends_on','complements','alternative','derived_from','contains')),
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(source_asset_id, target_asset_id, relationship)
);
CREATE TABLE IF NOT EXISTS library_asset_permissions (
    asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('viewer','editor','admin')),
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(asset_id, user_id)
);
CREATE TABLE IF NOT EXISTS library_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','team','public')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS library_collection_items (
    collection_id UUID NOT NULL REFERENCES library_collections(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(collection_id, asset_id)
);
CREATE TABLE IF NOT EXISTS library_asset_favorites (
    asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(asset_id, user_id)
);
CREATE TABLE IF NOT EXISTS library_asset_usage (
    id BIGSERIAL,
    asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    outcome TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(id, created_at)
);
SELECT create_hypertable('library_asset_usage', 'created_at', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_library_asset_usage_asset ON library_asset_usage(asset_id, created_at DESC);
CREATE TABLE IF NOT EXISTS library_asset_ratings (
    asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(asset_id, user_id)
);
CREATE TABLE IF NOT EXISTS library_asset_reviews (
    id BIGSERIAL PRIMARY KEY,
    asset_id UUID NOT NULL REFERENCES library_assets(id) ON DELETE CASCADE,
    user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    review TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','hidden')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS library_asset_audit (
    id BIGSERIAL PRIMARY KEY,
    asset_id UUID REFERENCES library_assets(id) ON DELETE SET NULL,
    actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    before_json JSONB,
    after_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_library_asset_audit_asset ON library_asset_audit(asset_id, created_at DESC);

CREATE OR REPLACE FUNCTION library_assets_search_vector() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description,'')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.content_json::text,'')), 'C') ||
    setweight(to_tsvector('simple', coalesce(array_to_string(NEW.tags,' '),'')), 'D');
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_library_assets_search ON library_assets;
CREATE TRIGGER trg_library_assets_search BEFORE INSERT OR UPDATE ON library_assets
FOR EACH ROW EXECUTE FUNCTION library_assets_search_vector();
