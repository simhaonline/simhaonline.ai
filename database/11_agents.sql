-- 11_agents.sql — Phase 5 agent runtime persistence.
-- Applied by docker-entrypoint-initdb.d on first boot AND live via
-- tools/apply-migrations.sh (idempotent: CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS agent_runs (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    goal          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','planning','running','awaiting_approval','completed','failed','cancelled')),
    result        TEXT,
    error         TEXT,
    max_steps     INT NOT NULL DEFAULT 12,
    max_tokens    INT NOT NULL DEFAULT 40000,
    tokens_used   INT NOT NULL DEFAULT 0,
    steps_used    INT NOT NULL DEFAULT 0,
    permissions   JSONB NOT NULL DEFAULT '[]'::jsonb,   -- tool names the run may call
    approved_by   BIGINT,                               -- approver user id when a gate was passed
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status) WHERE status IN ('queued','planning','running','awaiting_approval');

CREATE TABLE IF NOT EXISTS agent_steps (
    id           BIGSERIAL PRIMARY KEY,
    run_id       BIGINT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    seq          INT NOT NULL,
    kind         TEXT NOT NULL CHECK (kind IN ('plan','think','tool_call','tool_result','approval','final','error')),
    tool         TEXT,
    input        JSONB,
    output       TEXT,
    tokens       INT NOT NULL DEFAULT 0,
    ok           BOOLEAN,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id, seq);

CREATE TABLE IF NOT EXISTS agent_approvals (
    id           BIGSERIAL PRIMARY KEY,
    run_id       BIGINT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step_seq     INT NOT NULL,
    tool         TEXT NOT NULL,
    request_json JSONB NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
    decided_by   BIGINT,
    decided_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_pending ON agent_approvals(status) WHERE status = 'pending';