'use client';

// Public /arena — blind A/B model battles feeding the Leaderboard (rank engine).
// Two anonymous answers, one vote; identities revealed only after voting.
// Elo lives in the rank engine; this page is the §20/58 battle UI.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Swords, RefreshCw, Send, Scale, Check, Loader2 } from 'lucide-react';

type Side = 'a' | 'b' | 'tie';

interface BattleState {
  battleId: string;
  textA: string;
  textB: string;
  latencyA: number;
  latencyB: number;
}

interface LeaderRow {
  rank: number; model: string; rating: number; rating_ci95: number;
  votes: number; wins: number; losses: number; ties: number; win_rate: number;
}

const EXAMPLES = [
  'Explain quantum entanglement to a curious 10-year-old in three sentences.',
  'Write a haiku about debugging code at 3am.',
  'What are three practical habits that compound over a lifetime?',
];

export default function ArenaPage() {
  const [prompt, setPrompt] = useState('');
  const [battle, setBattle] = useState<BattleState | null>(null);
  const [voted, setVoted] = useState<{ winner: Side; modelA: string; modelB: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [voteBusy, setVoteBusy] = useState<Side | null>(null);
  const [error, setError] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderRow[] | null>(null);
  const voteLock = useRef(false);

  const loadLeaderboard = useCallback(async () => {
    try {
      const r = await fetch('/api/arena/leaderboard');
      if (r.ok) { const d = await r.json(); setLeaderboard(d.leaderboard || []); }
    } catch { /* table is optional decoration */ }
  }, []);
  useEffect(() => { void loadLeaderboard(); }, [loadLeaderboard]);

  async function runBattle() {
    if (busy || prompt.trim().length < 5) return;
    setBusy(true); setError(''); setBattle(null); setVoted(null);
    try {
      const r = await fetch('/api/arena/battle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Battle failed — try again.');
      setBattle({ battleId: d.battle_id, textA: d.response_a.text, textB: d.response_b.text, latencyA: d.response_a.latency_ms, latencyB: d.response_b.latency_ms });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Battle failed — try again.');
    } finally { setBusy(false); }
  }

  async function castVote(winner: Side) {
    if (!battle || voteLock.current) return;
    voteLock.current = true;
    setVoteBusy(winner);
    try {
      const r = await fetch('/api/arena/vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ battle_id: battle.battleId, winner }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Vote failed.');
      setVoted({ winner, modelA: d.models.a, modelB: d.models.b });
      void loadLeaderboard();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Vote failed.');
    } finally { setVoteBusy(null); voteLock.current = false; }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-violet-500 text-black"><Swords size={15} /></span>
            <div>
              <h1 className="text-sm font-semibold leading-tight">Leaderboard Battles</h1>
              <p className="text-[11px] text-zinc-500">Blind A/B — vote for the better answer</p>
            </div>
          </div>
          <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-200">simhaonline.ai</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {/* Prompt composer */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <textarea
            value={prompt} onChange={(e) => setPrompt(e.target.value)}
            maxLength={2000} rows={3}
            placeholder="Ask both models the same question…"
            className="w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-violet-500/60"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={() => void runBattle()} disabled={busy || prompt.trim().length < 5}
              className="flex items-center gap-2 rounded-md bg-violet-500 px-4 py-2 text-xs font-semibold text-black transition-colors hover:bg-violet-400 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {busy ? 'Running battle…' : 'Start battle'}
            </button>
            {EXAMPLES.map((ex) => (
              <button key={ex.slice(0, 20)} onClick={() => setPrompt(ex)}
                className="hidden rounded-full border border-zinc-800 px-3 py-1 text-[11px] text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 sm:block cursor-pointer">
                {ex.slice(0, 34)}…
              </button>
            ))}
          </div>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </section>

        {/* Battle panes */}
        {battle && (
          <section className="grid gap-4 lg:grid-cols-2">
            {(['a', 'b'] as const).map((side) => {
              const revealed = voted ? (side === 'a' ? voted.modelA : voted.modelB) : null;
              const isWinner = voted && voted.winner === side;
              return (
                <div key={side} className={`rounded-xl border p-4 ${isWinner ? 'border-violet-500/70 bg-violet-500/5' : 'border-zinc-800 bg-zinc-900/60'}`}>
                  <div className="flex items-center justify-between">
                    <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] font-bold tracking-wider text-zinc-300">
                      {revealed ? revealed : `MODEL ${side.toUpperCase()}`}
                    </span>
                    <span className="text-[11px] text-zinc-600">
                      {side === 'a' ? `${battle.latencyA}ms` : `${battle.latencyB}ms`}
                    </span>
                  </div>
                  <p className="mt-3 min-h-24 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
                    {side === 'a' ? battle.textA : battle.textB}
                  </p>
                  {!voted ? (
                    <div className="mt-4 flex gap-2">
                      <button onClick={() => void castVote(side)} disabled={voteBusy !== null}
                        className="flex-1 rounded-md border border-zinc-700 py-1.5 text-xs font-medium text-zinc-200 hover:border-violet-500 hover:text-violet-300 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                        {voteBusy === side ? 'Recording…' : '👈 This one is better'}
                      </button>
                    </div>
                  ) : isWinner ? (
                    <p className="mt-4 flex items-center gap-1 text-xs text-violet-400"><Check size={12} /> Your pick — vote recorded</p>
                  ) : null}
                </div>
              );
            })}
            {!voted && (
              <div className="lg:col-span-2">
                <button onClick={() => void castVote('tie')} disabled={voteBusy !== null}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-800 py-2 text-xs text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed">
                  <Scale size={13} /> {voteBusy === 'tie' ? 'Recording…' : "It's a tie"}
                </button>
              </div>
            )}
            {voted && (
              <div className="lg:col-span-2 flex justify-center">
                <button onClick={() => { setBattle(null); setVoted(null); setPrompt(''); }}
                  className="flex items-center gap-2 rounded-md bg-violet-500 px-4 py-2 text-xs font-semibold text-black hover:bg-violet-400 cursor-pointer">
                  <RefreshCw size={13} /> Next battle
                </button>
              </div>
            )}
          </section>
        )}

        {/* Leaderboard */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-semibold">Elo rankings</h2>
            <button onClick={() => void loadLeaderboard()} className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer">↻ Refresh</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-[11px] uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-2 font-medium">Rank</th><th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Rating</th><th className="px-4 py-2 font-medium">Votes</th>
                  <th className="px-4 py-2 font-medium">W/L/T</th><th className="px-4 py-2 font-medium">Win rate</th>
                </tr>
              </thead>
              <tbody>
                {(leaderboard || []).map((row) => (
                  <tr key={row.model} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-2 tabular-nums text-zinc-400">#{row.rank}</td>
                    <td className="px-4 py-2 font-mono text-xs">{row.model}</td>
                    <td className="px-4 py-2 tabular-nums text-violet-300">{row.rating.toFixed(0)}<span className="ml-1 text-[10px] text-zinc-600">±{row.rating_ci95.toFixed(0)}</span></td>
                    <td className="px-4 py-2 tabular-nums text-zinc-400">{row.votes}</td>
                    <td className="px-4 py-2 tabular-nums text-zinc-500">{row.wins}/{row.losses}/{row.ties}</td>
                    <td className="px-4 py-2 tabular-nums text-zinc-300">{(row.win_rate * 100).toFixed(0)}%</td>
                  </tr>
                ))}
                {!leaderboard?.length && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-600">No battles recorded yet — run the first one above.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-[11px] text-zinc-600">
            Ratings are Elo with 95% confidence intervals, updated live from pairwise blind votes.
          </p>
        </section>
      </main>
    </div>
  );
}