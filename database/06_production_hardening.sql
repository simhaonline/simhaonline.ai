-- Additive production hardening. Safe to apply repeatedly.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_time ON audit_log(actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_history_user_time ON request_history(user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry_active ON sessions(expires_at);

INSERT INTO schema_migrations(version, checksum)
VALUES ('006-production-hardening', 'initial-additive-hardening')
ON CONFLICT (version) DO NOTHING;
