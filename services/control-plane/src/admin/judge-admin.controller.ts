// Judge evaluation settings — Admin → Evaluation → Judge Settings.
// Fully registry-integrated: judge models are chosen from the SAME accounts +
// discovered_models tables the router uses. Policy is stored in app_settings
// ('judge_policy') so changes apply on the next judge call — no restarts.
// Credentials are never stored or re-entered here: judge hops reference an
// account by name and SIMHA uses that account's existing stored key.
import { Controller, Get, Post, Req, Res, Inject, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { AuthService } from '../auth/auth.service';

@Controller('admin/api/judge')
export class JudgeAdminController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly auth: AuthService,
  ) {}

  private async requireAdmin(req: Request) {
    const user = await this.auth.sessionUser(req.cookies?.simha_session);
    if (!user) {
      throw new HttpException({ error: 'Login required' }, HttpStatus.UNAUTHORIZED);
    }
    if (user.role !== 'admin') {
      throw new HttpException({ error: 'Administrator login required' }, HttpStatus.UNAUTHORIZED);
    }
    return user;
  }

  @Get('settings')
  async getSettings(@Req() req: Request, @Res() res: Response) {
    await this.requireAdmin(req);
    const policy = await this.pool.query(
      `SELECT value FROM app_settings WHERE key = 'judge_policy'`);
    const accounts = await this.pool.query(
      `SELECT a.name, a.provider, a.protocol, a.base_url,
              (SELECT COUNT(*)::int FROM discovered_models d
                WHERE d.account_name = a.name AND d.enabled
                  AND d.last_seen > now() - interval '7 days') AS model_count
       FROM accounts a ORDER BY a.name`);
    const models = await this.pool.query(
      `SELECT DISTINCT d.model, d.account_name, a.provider
       FROM discovered_models d JOIN accounts a ON a.name = d.account_name
       WHERE d.enabled AND d.last_seen > now() - interval '7 days'
       ORDER BY d.model LIMIT 500`);
    let judgePolicy: Record<string, unknown> = { mode: 'auto', chain: [], consensus_judges: 1 };
    if (policy.rows[0]?.value) {
      try { judgePolicy = JSON.parse(policy.rows[0].value as string); } catch { /* default */ }
    }
    const chainLen = Array.isArray(judgePolicy.chain) ? (judgePolicy.chain as unknown[]).length : 0;
    return res.json({
      policy: judgePolicy,
      accounts: accounts.rows,
      models: models.rows,
      heuristic_mode: judgePolicy.mode === 'heuristic_only' || chainLen === 0,
    });
  }

  @Post('policy')
  async savePolicy(@Req() req: Request, @Res() res: Response) {
    await this.requireAdmin(req);
    const body = req.body as Record<string, unknown>;
    const mode = ['auto', 'manual', 'heuristic_only'].includes(String(body.mode))
      ? String(body.mode) : 'auto';
    const hops = [body.primary, body.secondary, body.tie_breaker, body.fallback]
      .filter((x): x is { account: string; model: string } =>
        Boolean(x) && typeof x === 'object' && Boolean((x as Record<string, unknown>).account) &&
        Boolean((x as Record<string, unknown>).model));
    // every hop must reference a REAL account in the registry
    const names = await this.pool.query(`SELECT name FROM accounts`);
    const known = new Set(names.rows.map((r) => r.name as string));
    for (const hop of hops) {
      if (!known.has(hop.account)) {
        return res.status(HttpStatus.BAD_REQUEST).json(
          { error: `unknown account: ${hop.account}` });
      }
    }
    const doc = {
      mode,
      chain: hops.map((h) => ({ account: String(h.account), model: String(h.model) })),
      consensus_judges: Math.min(Math.max(Number(body.consensus_judges || 1), 1), 5),
      updated_at: new Date().toISOString(),
      updated_by: 'admin-dashboard',
    };
    await this.pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('judge_policy', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(doc)]);
    return res.status(HttpStatus.CREATED).json({ ok: true, policy: doc });
  }

  @Get('stats')
  async stats(@Req() req: Request, @Res() res: Response) {
    await this.requireAdmin(req);
    const agg = await this.pool.query(
      `SELECT backend, COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failures,
              COUNT(*) FILTER (WHERE status = 'degraded')::int AS degradations,
              ROUND(AVG(latency_ms)::numeric, 1) AS avg_latency,
              ROUND(AVG(failovers)::numeric, 2) AS avg_failovers,
              COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
              COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens
       FROM judge_runs GROUP BY backend`);
    const byModel = await this.pool.query(
      `SELECT judge_model, judge_account, COUNT(*)::int AS runs,
              COUNT(*) FILTER (WHERE status <> 'ok')::int AS failures,
              ROUND(AVG(latency_ms)::numeric, 1) AS avg_latency
       FROM judge_runs WHERE judge_model IS NOT NULL
       GROUP BY judge_model, judge_account ORDER BY runs DESC LIMIT 20`);
    const recent = await this.pool.query(
      `SELECT id, created_at, task_type, judge_account, judge_model, backend,
              status, latency_ms, failovers, error
       FROM judge_runs ORDER BY id DESC LIMIT 25`);
    const policy = await this.pool.query(
      `SELECT value FROM app_settings WHERE key = 'judge_policy'`);
    let judgePolicy: Record<string, unknown> = { mode: 'auto', chain: [] };
    if (policy.rows[0]?.value) {
      try { judgePolicy = JSON.parse(policy.rows[0].value as string); } catch { /* default */ }
    }
    const chainLen = Array.isArray(judgePolicy.chain) ? (judgePolicy.chain as unknown[]).length : 0;
    return res.json({
      heuristic_mode: judgePolicy.mode === 'heuristic_only' || chainLen === 0,
      mode: judgePolicy.mode || 'auto',
      backends: agg.rows,
      by_model: byModel.rows,
      recent_runs: recent.rows,
    });
  }

  @Post('probe')
  async probe(@Req() req: Request, @Res() res: Response) {
    await this.requireAdmin(req);
    // Ask the judge engine to probe its configured chain right now.
    const JUDGE_URL = process.env.JUDGE_URL || 'http://judge:8116';
    const r = await fetch(`${JUDGE_URL}/policy/validate`, { method: 'POST' })
      .then((x) => x.json()).catch(() => null);
    if (!r) return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: 'judge engine unreachable' });
    return res.json(r);
  }
}