-- 09_model_deprecations.sql — pattern-based model deprecation policy.
-- The gateway's discovery re-inserts discovered models with enabled=true on
-- every refresh cycle, so per-row manual disables would be wiped. Instead,
-- deprecation POLICIES are matched at ingest time: any model matching a
-- disabled pattern is re-disabled automatically, keeping the catalog to
-- current-generation models only (user directive: no old/unwanted models).
CREATE TABLE IF NOT EXISTS model_deprecations (
  id          BIGSERIAL PRIMARY KEY,
  pattern     TEXT NOT NULL UNIQUE,       -- case-insensitive ILIKE pattern on model id
  reason      TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'legacy',  -- legacy | batch | free | snapshot | deprecated
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  enabled     BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO model_deprecations(pattern, reason, kind) VALUES
  -- Legacy GPT generations
  ('%gpt-3.5-turbo%',        'Legacy GPT-3.5 family — superseded by gpt-5.x class', 'legacy'),
  ('%gpt-4-0314%',           'Dated GPT-4 snapshot', 'snapshot'),
  ('%gpt-4-0613%',           'Dated GPT-4 snapshot', 'snapshot'),
  ('%gpt-4-0125%',           'Dated GPT-4 turbo snapshot', 'snapshot'),
  ('%gpt-4-1106-preview%',   'Dated GPT-4 turbo preview', 'snapshot'),
  ('%gpt-4-turbo-preview%',  'Dated GPT-4 turbo preview', 'snapshot'),
  ('%gpt-4o-2024%',          'Dated GPT-4o snapshot — superseded by chatgpt-image-latest / gpt-5 class', 'snapshot'),
  ('%dall-e-2%',             'Legacy image model — superseded by gpt-image family', 'legacy'),
  -- Legacy Claude generations
  ('%claude-2%',             'Claude 2 — superseded by Claude 4/5 family', 'legacy'),
  ('%claude-3-haiku-20240%', 'Dated Claude 3 Haiku snapshot', 'snapshot'),
  ('%claude-3-sonnet-20240%','Dated Claude 3 Sonnet snapshot', 'snapshot'),
  ('%claude-3-opus-20240%',  'Dated Claude 3 Opus snapshot', 'snapshot'),
  ('%claude-3-5-sonnet-2024%','Dated Claude 3.5 Sonnet snapshot', 'snapshot'),
  -- Batch / free tier variants (not real-time routable)
  ('%:batch%',               'Batch variant — asynchronous tier, not for interactive chat', 'batch'),
  ('%:free%',                'Free tier — rate-limited/unstable, excluded from production routing', 'free'),
  -- Dated 2023/2024 snapshots
  ('%-2023-%',               '2023-dated model snapshot', 'snapshot'),
  ('%-2024-%',               '2024-dated model snapshot', 'snapshot'),
  ('0314',                   'Dated snapshot id', 'snapshot'),
  ('0914',                   'Dated snapshot id', 'snapshot'),
  ('1106-preview',           'Dated preview snapshot', 'snapshot'),
  -- Legacy open-weight generations
  ('%llama-2%',              'Llama 2 — superseded by Llama 4+', 'legacy'),
  ('%llama2%',               'Llama 2 — superseded', 'legacy'),
  ('%mixtral-8x7%',          'Mixtral 8x7B — superseded', 'legacy'),
  ('%mistral-7b%',           'Mistral 7B — superseded', 'legacy'),
  ('%gemini-1.0%',           'Gemini 1.0 — superseded', 'legacy')
ON CONFLICT (pattern) DO UPDATE SET reason = EXCLUDED.reason, kind = EXCLUDED.kind;