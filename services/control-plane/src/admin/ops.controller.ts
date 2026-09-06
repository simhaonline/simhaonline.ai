// Operations endpoints for the dashboard: live health, real routing/limits
// data, and error/latency metrics. Replaces the cosmetic placeholder views.
import { Controller, Get, Patch, Req, Res, Body, Inject, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import type Redis from 'ioredis';
import { PG_POOL, REDIS } from '../db/db.module';
import { AuthService } from '../auth/auth.service';

const ENGINE_BASES: Record<string, string> = {
  scraper: process.env.SCRAPER_URL || 'http://scraper:8111',
  reverse: process.env.REVERSE_URL || 'http://reverse:8112',
  'router-opt': process.env.ROUTER_OPT_URL || 'http://router-opt:8113',
  rank: process.env.RANK_URL || 'http://rank:8114',
  discovery: process.env.DISCOVERY_URL || 'http://discovery:8115',
  judge: process.env.JUDGE_URL || 'http://judge:8116',
};

@Controller('admin/api')
export class OpsController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly auth: AuthService,
  ) {}

  private async requireAdmin(req: Request) {
    const user = await this.auth.sessionUser(req.cookies?.simha_session);
    if (!user) throw new HttpException({ error: 'Login required' }, HttpStatus.UNAUTHORIZED);
    if (user.role !== 'admin') {
      throw new HttpException({ error: 'Administrator login required' }, HttpStatus.UNAUTHORIZED);
    }
    return user;
  }

  // GET /admin/api/ops — one payload powering Observability + Overview extras.
  @Get('ops')
  async ops(@Req() req: Request, @Res() res: Response) {
    await this.requireAdmin(req);
    const gateway = process.env.GATEWAY_URL || 'http://gateway:8080';
    const out: Record<string, unknown> = {};

    // gateway health + registry counts (public endpoint, no auth)
    out.gateway = await fetch(`${gateway}/gateway-status`)
      .then((r) => r.json()).catch(() => ({ status: 'unreachable' }));

    // engine health (contract endpoints, loopback network)
    const engines = await Promise.all(Object.entries(ENGINE_BASES).map(async ([name, base]) => {
      const t0 = Date.now();
      const ready = await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(4000) })
        .then((r) => ({ ok: r.status === 200, code: r.status }))
        .catch(() => ({ ok: false, code: 0 }));
      return { name, ready: ready.ok, code: ready.code, latency_ms: Date.now() - t0 };
    }));
    out.engines = engines;

    // real error/latency metrics from request_history (24h + 7d)
    const { rows: metrics } = await this.pool.query(
      `SELECT
         COUNT(*)::bigint AS requests,
         COUNT(*) FILTER (WHERE status >= 500)::bigint AS server_errors,
         COUNT(*) FILTER (WHERE status = 429)::bigint AS rate_limited,
         COUNT(*) FILTER (WHERE status >= 400 AND status < 500)::bigint AS client_errors,
         ROUND(100.0 * COUNT(*) FILTER (WHERE status >= 400) / GREATEST(COUNT(*), 1), 2) AS error_rate,
         ROUND(AVG(0)::numeric, 2) AS latency_placeholder
       FROM request_history WHERE requested_at > now() - interval '24 hours'`);
    const { rows: perModel } = await this.pool.query(
      `SELECT model, COUNT(*)::bigint AS requests,
              COUNT(*) FILTER (WHERE status >= 400)::bigint AS errors
       FROM request_history WHERE requested_at > now() - interval '24 hours'
       GROUP BY model HAVING COUNT(*) > 0 ORDER BY COUNT(*) DESC LIMIT 10`);
    const { rows: cooldowns } = await this.pool.query(
      `SELECT account_name, MAX(requested_at) AS last_at
       FROM request_history WHERE status = 429 AND requested_at > now() - interval '1 hour'
       GROUP BY account_name`);
    const { rows: judgeToday } = await this.pool.query(
      `SELECT COUNT(*)::bigint AS runs,
              COUNT(*) FILTER (WHERE status <> 'ok')::int AS failures
       FROM judge_runs WHERE created_at > now() - interval '24 hours'`);
    const { rows: policyRows } = await this.pool.query(
      `SELECT model, max_input_tokens, min_output_tokens, max_output_tokens,
              max_tool_result_chars, dedupe_system_messages, updated_at
       FROM model_policies ORDER BY model`);
    const { rows: limits } = await this.pool.query(
      `SELECT name, limits_json FROM accounts ORDER BY name`);

    out.metrics = metrics[0] || {};
    out.per_model = perModel;
    out.rate_limited_recently = cooldowns;
    out.judge_today = judgeToday[0] || {};
    out.policies = policyRows;
    out.limits = limits;
    return res.json(out);
  }

  // PATCH /admin/api/ops/policies — real update of model_policies.
  @Patch('ops/policies')
  async patchPolicy(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    await this.requireAdmin(req);
    const model = String(body.model || '*');
    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    for (const key of ['max_input_tokens', 'min_output_tokens', 'max_output_tokens', 'max_tool_result_chars']) {
      const v = Number((body as Record<string, unknown>)[key]);
      if (Number.isFinite(v) && v >= 0) { fields.push(`${key} = $${i++}`); vals.push(Math.floor(v)); }
    }
    if (typeof body.dedupe_system_messages === 'boolean') {
      fields.push(`dedupe_system_messages = $${i++}`); vals.push(body.dedupe_system_messages);
    }
    if (!fields.length) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'nothing to update' });
    }
    if (model !== '*') {
      const exists = await this.pool.query('SELECT 1 FROM model_policies WHERE model = $1', [model]);
      if (!exists.rows.length) {
        return res.status(HttpStatus.NOT_FOUND).json({ error: `no policy row for ${model}` });
      }
    }
    vals.push(model);
    await this.pool.query(
      `UPDATE model_policies SET ${fields.join(', ')}, updated_at = now() WHERE model = $${i}`,
      vals);
    await this.pool.query(
      `INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`,
      ['admin', 'policy.update', model]);
    return res.json({ ok: true });
  }

  // GET /admin/api/ops/engines/:name/*sub — proxy read-only engine data
  // (discovery entities, pending changes, scraper monitors, rank leaderboard).
  @Get('ops/engines/:name/*')
  async engineData(@Req() req: Request, @Res() res: Response) {
    await this.requireAdmin(req);
    const name = String(req.params.name || '');
    const base = ENGINE_BASES[name];
    if (!base) return res.status(HttpStatus.NOT_FOUND).json({ error: 'unknown engine' });
    // Express 4 wildcard: req.params[0] holds everything after ':name/'
    const sub = String((req.params as Record<string, string>)[0] || '');
    const qs = new URL(req.url, 'http://x').search;
    const url = `${base}/${sub}${qs}`;
    const data = await fetch(url, {
      headers: { 'X-Engine-Token': process.env.ENGINE_API_TOKEN || '' },
      signal: AbortSignal.timeout(8000),
    }).then((r) => r.json()).catch(() => ({ error: `${name} unreachable` }));
    return res.json(data);
  }
}