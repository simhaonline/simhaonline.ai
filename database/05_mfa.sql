-- 05_mfa.sql — audit.md M6: TOTP two-factor for dashboard accounts.
-- Secret is stored encrypted (AES-256-GCM, key = OAUTH_ENCRYPTION_KEY).
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret_enc TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_hash TEXT;