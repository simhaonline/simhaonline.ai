// GET /api/v1/usage/overview — feeds the Control Center Overview page
// (KPIs, 7-day chart, plan usage, recent activity). All telemetry is
// privacy-safe metadata only; prompts are never stored.
import { Controller, Get, Req, Res, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@Controller('api/v1/usage')
export class UsageController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('overview')
  async overview(@Req() req: Request, @Res() res: Response) {
    const [today, month, models, failovers, perDay, recent, plan] = await Promise.all([
      this.pool.query(
        `SELECT COUNT(*)::bigint AS n FROM request_history WHERE requested_at > now() - interval '24 hours'`),
      this.pool.query(
        `SELECT COUNT(*)::bigint AS n FROM request_history WHERE requested_at > date_trunc('month', now())`),
      this.pool.query(
        `SELECT COUNT(DISTINCT model)::bigint AS n FROM discovered_models WHERE enabled AND last_seen > now() - interval '3 days'`),
      this.pool.query(
        // failover ≈ requests where the justification records a non-primary pick
        `SELECT COUNT(*)::bigint AS n FROM routing_decisions
         WHERE created_at > now() - interval '24 hours'
           AND justification ILIKE '%cooldown%'`),
      this.pool.query(
        `SELECT to_char(date_trunc('day', requested_at), 'YYYY-MM-DD') AS date, COUNT(*)::bigint AS requests
         FROM request_history WHERE requested_at > now() - interval '7 days'
         GROUP BY 1 ORDER BY 1`),
      this.pool.query(
        `SELECT requested_at AS timestamp, model, account_name AS provider,
                total_tokens AS tokens, NULL::bigint AS latency_ms, status
         FROM request_history ORDER BY requested_at DESC LIMIT 12`),
      this.pool.query(
        `SELECT s.plan_id, p.name, p.price_monthly_usd, s.current_period_end AS renews_at
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         WHERE s.status = 'active'
         ORDER BY s.id DESC LIMIT 1`),
    ]);

    const planRow = plan.rows[0];
    const planId = planRow?.plan_id || 'free';
    const dailyLimit = planId === 'business' ? null : planId === 'pro' ? 5000 : 200;
    const monthlyLimit = planId === 'business' ? null : planId === 'pro' ? 80000 : 3000;
    const monthCount = Number(month.rows[0].n);
    const todayCount = Number(today.rows[0].n);

    return res.json({
      requests_today: todayCount,
      requests_month: monthCount,
      active_models: Number(models.rows[0].n),
      failover_events: Number(failovers.rows[0].n),
      plan: {
        id: planId,
        name: planRow?.name || 'Free',
        price_monthly_usd: planRow?.price_monthly_usd || '0.00',
        renews_at: planRow?.renews_at ?? null,
      },
      plan_usage: {
        daily_percent: dailyLimit ? Math.min(100, Math.round((100 * todayCount) / dailyLimit)) : 0,
        monthly_percent: monthlyLimit ? Math.min(100, Math.round((100 * monthCount) / monthlyLimit)) : 0,
      },
      per_day: perDay.rows,
      recent: recent.rows.map((r: Record<string, unknown>) => ({
        ...r,
        timestamp: r.timestamp instanceof Date ? (r.timestamp as Date).toISOString() : r.timestamp,
      })),
    });
  }
}