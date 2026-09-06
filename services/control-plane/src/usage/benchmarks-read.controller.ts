// GET /api/v1/benchmarks — benchmark leaderboard for the Control Center.
// Read-model over benchmark_models (+ benchmark_runs aggregates); only
// recorded data is returned (nulls stay null — never invented).
import { Controller, Get, Res, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@Controller('api/v1/benchmarks')
export class BenchmarksReadController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async list(@Res() res: Response) {
    const { rows } = await this.pool.query(
      `SELECT bm.model,
              bm.organization,
              bm.open_weights,
              bm.context_window,
              bm.modalities,
              NULL::numeric AS overall_score,
              NULL::numeric AS reasoning_score,
              NULL::numeric AS coding_score,
              NULL::numeric AS agentic_coding_score,
              NULL::numeric AS mathematics_score,
              NULL::numeric AS data_analysis_score,
              NULL::numeric AS language_score,
              NULL::numeric AS instruction_following_score,
              COALESCE(SUM(br.prompt_count), 0)::bigint AS llm_calls,
              COALESCE(SUM(br.prompt_count - br.pass_count), 0)::bigint AS errored_traces,
              NULL::numeric AS p50_latency_ms,
              NULL::numeric AS hallucination_rate,
              NULL::numeric AS feedback_avg
       FROM benchmark_models bm
       LEFT JOIN benchmark_runs br ON br.model = bm.model
       WHERE bm.enabled
       GROUP BY bm.model, bm.organization, bm.open_weights, bm.context_window, bm.modalities
       ORDER BY bm.model
       LIMIT 200`);
    return res.json({ models: rows });
  }
}