'use client';

// AgentRunner — Phase 5 agent runtime UI (§30): launch a run, watch the live
// trace (plan → tool calls → final), cancel, and (admin) approve gated calls.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Loader2, Square, ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RunSummary {
  id: number; goal: string; status: string;
  steps_used: number; tokens_used: number; created_at: string;
}
interface Step {
  seq: number; kind: string; tool: string | null;
  output: string; ok: boolean | null;
}
interface Approval {
  id: number; tool: string; request_json: string; status: string;
}
interface RunDetail {
  run: RunSummary & { result: string | null; error: string | null; permissions: string[] };
  steps: Step[];
  approvals: Approval[];
}

const STATUS_TONE: Record<string, string> = {
  queued: 'text-zinc-400', planning: 'text-amber-300', running: 'text-cyan-300',
  awaiting_approval: 'text-amber-300', completed: 'text-green-300',
  failed: 'text-red-300', cancelled: 'text-zinc-500',
};

export default function AgentRunner() {
  const [goal, setGoal] = useState('');
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch('/api/chat/api/v1/agents/runs');
      if (r.ok) setRuns((await r.json()).runs || []);
    } catch { /* optional */ }
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/api/chat/api/v1/agents/runs/${id}`);
      if (r.ok) {
        setDetail(await r.json());
        const st = (await (await fetch(`/api/chat/api/v1/agents/runs/${id}/status`)).json());
        if (['completed', 'failed', 'cancelled', 'awaiting_approval'].includes(st.status) && poll.current) {
          clearInterval(poll.current); poll.current = null;
        }
      }
    } catch { /* keep last view */ }
  }, []);

  useEffect(() => {
    void loadRuns();
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [loadRuns]);

  function watch(id: number) {
    if (poll.current) clearInterval(poll.current);
    void loadDetail(id);
    poll.current = setInterval(() => void loadDetail(id), 2500);
  }

  async function launch() {
    if (busy || goal.trim().length < 10) return;
    setBusy(true); setError(''); setDetail(null);
    try {
      const r = await fetch('/api/chat/api/v1/agents/runs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim(), max_steps: 10 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not start the run.');
      await loadRuns();
      watch(d.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the run.');
    } finally { setBusy(false); }
  }

  async function decide(approvalId: number, approve: boolean) {
    await fetch(`/api/chat/api/v1/agents/approvals/${approvalId}/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve }),
    });
    if (detail) watch(detail.run.id);
  }

  async function cancel() {
    if (!detail) return;
    await fetch(`/api/chat/api/v1/agents/runs/${detail.run.id}/cancel`, { method: 'POST' });
    watch(detail.run.id);
  }

  const run = detail?.run;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <textarea
          value={goal} onChange={(e) => setGoal(e.target.value)} rows={2}
          maxLength={2000}
          placeholder="Give the agent a goal — e.g. “Research the top 3 MCP servers for database work and summarise them.”"
          className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-950 p-2.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
        />
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => void launch()} disabled={busy || goal.trim().length < 10}
            className="flex items-center gap-1.5 rounded-md bg-violet-500 px-3 py-1.5 text-[11px] font-semibold text-black hover:bg-violet-400 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run agent
          </button>
          <span className="text-[10px] text-zinc-600">Tools: llm · web_retrieval · http_fetch · memory_search</span>
        </div>
        {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}
      </div>

      {run && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-zinc-200">Run #{run.id}</span>
            <span className={cn('text-[11px] font-medium', STATUS_TONE[run.status] || 'text-zinc-400')}>{run.status}</span>
          </div>
          <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto" aria-live="polite">
            {(detail?.steps || []).map((s) => (
              <div key={s.seq} className="rounded-md bg-zinc-900/70 px-2.5 py-1.5 text-[11px]">
                <div className="flex items-center gap-1.5">
                  {s.kind === 'final' ? <CheckCircle2 size={11} className="text-green-400" />
                    : s.kind === 'error' ? <XCircle size={11} className="text-red-400" />
                    : <span className="text-zinc-600">#{s.seq}</span>}
                  <b className="text-zinc-300">{s.tool || s.kind}</b>
                  {s.ok === false && <span className="text-red-400">(failed)</span>}
                </div>
                {s.output && <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-zinc-500">{s.output.slice(0, 400)}</p>}
              </div>
            ))}
            {(detail?.approvals || []).filter((a) => a.status === 'pending').map((a) => (
              <div key={a.id} className="rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[11px]">
                <div className="flex items-center gap-1.5 text-amber-300">
                  <ShieldCheck size={11} /> Approval needed: <b>{a.tool}</b>
                </div>
                <p className="mt-1 text-zinc-500">{a.request_json.slice(0, 160)}</p>
                <div className="mt-1.5 flex gap-1.5">
                  <button onClick={() => void decide(a.id, true)} className="rounded border border-green-600/50 px-2 py-0.5 text-[10px] text-green-300 hover:bg-green-500/10 cursor-pointer">Approve</button>
                  <button onClick={() => void decide(a.id, false)} className="rounded border border-red-600/50 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-500/10 cursor-pointer">Deny</button>
                </div>
              </div>
            ))}
          </div>
          {run.status === 'awaiting_approval' && <p className="mt-1.5 text-[10px] text-amber-300">Waiting for admin approval of a gated tool call.</p>}
          {run.result && <p className="mt-2 whitespace-pre-wrap rounded-md border border-green-600/30 bg-green-500/5 p-2 text-[11px] text-green-100">{run.result}</p>}
          {run.error && <p className="mt-1.5 text-[10px] text-red-400">{run.error}</p>}
          {['running', 'planning', 'queued'].includes(run.status) && (
            <button onClick={() => void cancel()} className="mt-2 flex items-center gap-1 text-[10px] text-zinc-500 hover:text-red-400 cursor-pointer">
              <Square size={9} /> Cancel run
            </button>
          )}
        </div>
      )}

      <div>
        <p className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-zinc-600">Recent runs</p>
        {runs.map((r) => (
          <button key={r.id} onClick={() => watch(r.id)}
            className="flex w-full items-center gap-2 rounded-md bg-zinc-900/60 px-2.5 py-1.5 text-left hover:bg-zinc-800/60 cursor-pointer">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full',
              r.status === 'completed' ? 'bg-green-400' : r.status === 'failed' ? 'bg-red-400' : 'bg-amber-400')} aria-hidden />
            <b className="min-w-0 flex-1 truncate text-[11.5px] text-zinc-200">{r.goal}</b>
            <span className="shrink-0 text-[9px] uppercase tracking-wide text-zinc-600">{r.status}</span>
          </button>
        ))}
        {!runs.length && <p className="px-1 py-2 text-center text-[11px] text-zinc-600">No agent runs yet.</p>}
      </div>
    </div>
  );
}