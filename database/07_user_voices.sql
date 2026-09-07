-- 07_user_voices.sql — user voice profiles for TTS + voice cloning.
-- consented_at is NOT NULL: a voice profile can only exist with the
-- recorded consent confirmation (§93 trust model; §67 prompt-injection
-- era rule: trust gates before automation).
CREATE TABLE IF NOT EXISTS user_voices (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  provider     TEXT NOT NULL DEFAULT 'elevenlabs',
  voice_id     TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'cloned' CHECK (kind IN ('premade', 'cloned')),
  consent_text TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sample_meta  JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
CREATE INDEX IF NOT EXISTS idx_user_voices_user ON user_voices(user_id);