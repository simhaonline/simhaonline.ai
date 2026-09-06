'use client';

// (8) app/(dashboard)/dashboard/benchmarks/page.tsx — sortable benchmark
// leaderboard (TanStack Table v9: feature-based API) with side-by-side
// compare dialog for up to 3 models.

import { useEffect, useMemo, useState } from 'react';
import {
  columnVisibilityFeature,
  createCoreRowModel,
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
  type SortingState,
} from '@tanstack/react-table';
import { GitCompare, Star } from 'lucide-react';
import { api, ApiError, type BenchmarkModel } from '@/lib/api';
import { Badge, Button, Card, Dialog, Td, Th } from '@/components/ui/primitives';

const COLUMNS: Array<{ key: keyof BenchmarkModel; label: string }> = [
  { key: 'overall_score', label: 'Overall' },
  { key: 'reasoning_score', label: 'Reasoning' },
  { key: 'coding_score', label: 'Coding' },
  { key: 'agentic_coding_score', label: 'Agentic coding' },
  { key: 'mathematics_score', label: 'Mathematics' },
  { key: 'data_analysis_score', label: 'Data analysis' },
  { key: 'language_score', label: 'Language' },
  { key: 'instruction_following_score', label: 'Instruction following' },
  { key: 'llm_calls', label: 'LLM calls' },
  { key: 'errored_traces', label: 'Errored traces' },
  { key: 'p50_latency_ms', label: 'P50 latency ms' },
  { key: 'hallucination_rate', label: 'Hallucination rate %' },
  { key: 'feedback_avg', label: 'Feedback ★' },
];

// v9: register exactly the features used (sorting + column visibility for
// row.getVisibleCells) and their row models.
const features = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
});

function display(v: number | null | undefined, suffix = ''): string {
  if (v === null || v === undefined) return '—';
  return typeof v === 'number'
    ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) + suffix
    : String(v);
}

export default function BenchmarksPage() {
  const [models, setModels] = useState<BenchmarkModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'overall', desc: true }]);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const d = await api.benchmarks();
        if (alive) setModels(d.models || []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError && e.status === 401 ? 'Session expired — sign in again.' : String((e as Error).message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const table = useTable({
    features,
    data: models,
    columns: [
      { id: 'model', accessorKey: 'model', header: 'Model', sortFn: 'alphanumeric' },
      { id: 'organization', accessorKey: 'organization', header: 'Organization', sortFn: 'alphanumeric' },
      { id: 'open_weights', accessorKey: 'open_weights', header: 'Open', sortFn: 'basic' },
      ...COLUMNS.map((c) => ({
        id: String(c.key),
        accessorKey: String(c.key),
        header: c.label,
        sortFn: 'basic' as const,
      })),
      {
        id: 'compare',
        header: 'Compare',
        enableSorting: false,
      },
    ],
    state: { sorting },
    onSortingChange: setSorting,
  });

  const compared = compare
    .map((name) => models.find((m) => m.model === name))
    .filter((m): m is BenchmarkModel => Boolean(m));

  function toggleCompare(model: string) {
    setCompare((x) => (x.includes(model) ? x.filter((m) => m !== model) : x.length < 3 ? [...x, model] : x));
  }

  return (
    <>
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-400">Evaluation lab</p>
          <h1 className="text-lg font-semibold">Benchmarks</h1>
        </div>
        <Button size="sm" disabled={compare.length < 2} onClick={() => setCompareOpen(true)}>
          <GitCompare size={13} /> Compare selected ({compare.length})
        </Button>
      </header>

      <div className="flex-1 space-y-3 p-6">
        {error && <Card className="border-red-500/40 bg-red-500/5"><div className="p-3 text-sm text-red-400">{error}</div></Card>}
        {loading && <p className="pt-16 text-center text-xs text-zinc-600">Loading recorded performance…</p>}
        {!loading && !models.length && (
          <Card><div className="py-16 text-center text-sm text-zinc-600">
            No benchmarked models yet. Scores appear as soon as evaluations are recorded.
          </div></Card>
        )}
        {!loading && models.length > 0 && (
          <div className="max-h-[calc(100vh-190px)] overflow-auto rounded-md border border-zinc-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-zinc-900">
                  {table.getFlatHeaders().map((header) => {
                    const canSort = header.column.getCanSort();
                    const dir = header.column.getIsSorted();
                    const label = typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : header.column.id;
                    return (
                      <Th key={header.id} className="whitespace-nowrap border-r border-zinc-800 text-right">
                        {header.column.id === 'compare' ? (
                          label
                        ) : (
                          <button
                            onClick={() => header.column.toggleSorting()}
                            disabled={!canSort}
                            className="inline-flex items-center gap-1 uppercase hover:text-zinc-200 cursor-pointer disabled:cursor-default"
                          >
                            {label}
                            <span className={`text-[9px] ${dir ? 'text-violet-400' : 'text-zinc-700'}`}>
                              {dir ? (dir === 'desc' ? '↓' : '↑') : '↕'}
                            </span>
                          </button>
                        )}
                      </Th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {table.getSortedRowModel().rows.map((row) => {
                  const cells = row.getVisibleCells();
                  const model = row.original;
                  return (
                    <tr key={row.id} className="hover:bg-zinc-800/40">
                      {cells.map((cell) => {
                        const id = cell.column.id;
                        const value = cell.renderValue() as number | string | boolean | null | undefined;
                        return (
                          <Td key={cell.id} className="whitespace-nowrap">
                            {id === 'model' && <span className="font-mono text-xs font-medium text-zinc-100">{String(value)}</span>}
                            {id === 'organization' && String(value)}
                            {id === 'open_weights' && <Badge tone={value ? 'success' : 'outline'}>{value ? 'Open' : 'Closed'}</Badge>}
                            {COLUMNS.some((c) => String(c.key) === id) && (
                              <span className="tabular-nums text-zinc-300">
                                {display(value as number | null, id === 'hallucination_rate' ? '%' : '')}
                              </span>
                            )}
                            {id === 'compare' && (
                              <input
                                type="checkbox"
                                checked={compare.includes(model.model)}
                                onChange={() => toggleCompare(model.model)}
                                aria-label={`Compare ${model.model}`}
                                className="h-3.5 w-3.5 cursor-pointer accent-violet-500"
                              />
                            )}
                          </Td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-zinc-600">
          Unmeasured fields stay blank — this page never invents benchmark scores.
        </p>
      </div>

      <Dialog open={compareOpen} onClose={() => setCompareOpen(false)} title={`Compare models (${compared.length}/3)`} width="max-w-4xl">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <Th className="w-44">Metric</Th>
                {compared.map((m) => <Th key={m.model} className="font-mono text-xs normal-case text-zinc-200">{m.model}</Th>)}
              </tr>
            </thead>
            <tbody>
              {COLUMNS.map((c) => (
                <tr key={String(c.key)} className="hover:bg-zinc-800/40">
                  <Td className="font-medium text-zinc-400">{c.label}</Td>
                  {compared.map((m) => (
                    <Td key={m.model} className="tabular-nums">
                      {display(m[c.key] as number | null, c.key === 'hallucination_rate' ? '%' : '')}
                    </Td>
                  ))}
                </tr>
              ))}
              <tr>
                <Td className="font-medium text-zinc-400">Feedback ★</Td>
                {compared.map((m) => (
                  <Td key={m.model} className="tabular-nums">
                    <span className="inline-flex items-center gap-1 text-amber-400">
                      <Star size={12} /> {display(m.feedback_avg)}
                    </span>
                  </Td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </Dialog>
    </>
  );
}