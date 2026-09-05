// Billing domain: plans, subscriptions, invoices, quota checks.
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { PG_POOL, REDIS } from '../db/db.module';
import type { StripeService } from './stripe.service';

export interface PlanRow {
  id: string;
  name: string;
  price_monthly_usd: string;
  requests_per_day: number;
  requests_per_month: number;
  max_keys: number;
  rate_limit_per_min: number;
  sort_order: number;
  active: boolean;
}

@Injectable()
export class BillingService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async listPlans(): Promise<PlanRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name, price_monthly_usd, requests_per_day, requests_per_month,
              max_keys, rate_limit_per_min, sort_order, active
       FROM plans WHERE active = TRUE ORDER BY sort_order`,
    );
    return rows;
  }

  async getPlan(planId: string): Promise<PlanRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, name, price_monthly_usd, requests_per_day, requests_per_month,
              max_keys, rate_limit_per_min, sort_order, active
       FROM plans WHERE id = $1 AND active = TRUE`,
      [planId],
    );
    return rows[0] || null;
  }

  /** Effective subscription for a user — creates a free one lazily. */
  async getSubscription(userId: number) {
    const { rows } = await this.pool.query(
      `SELECT s.id, s.plan_id, s.status, s.current_period_start, s.current_period_end,
              s.cancel_at_period_end, p.name AS plan_name,
              p.price_monthly_usd, p.requests_per_day, p.requests_per_month,
              p.max_keys, p.rate_limit_per_min
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 AND s.status = 'active'
       ORDER BY s.id LIMIT 1`,
      [userId],
    );
    if (rows.length) return rows[0];
    // lazily enroll on free
    await this.pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, 'free', 'active', CURRENT_DATE, (CURRENT_DATE + INTERVAL '1 month')::date)
       ON CONFLICT (user_id) DO UPDATE
         SET plan_id = 'free', status = 'active',
             current_period_start = CURRENT_DATE,
             current_period_end = (CURRENT_DATE + INTERVAL '1 month')::date
       WHERE subscriptions.status <> 'active'`,
      [userId],
    );
    const { rows: r2 } = await this.pool.query(
      `SELECT s.id, s.plan_id, s.status, s.current_period_start, s.current_period_end,
              s.cancel_at_period_end, p.name AS plan_name,
              p.price_monthly_usd, p.requests_per_day, p.requests_per_month,
              p.max_keys, p.rate_limit_per_min
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 ORDER BY s.id LIMIT 1`,
      [userId],
    );
    return r2[0] || null;
  }

  /** User requests a plan change: free → instant; paid → Stripe Checkout (or manual invoice fallback). */
  async requestPlan(userId: number, planId: string, stripe: StripeService | null) {
    const plan = await this.getPlan(planId);
    if (!plan) throw new Error('Unknown plan');
    if (plan.price_monthly_usd === '0.00') {
      await this.activate(userId, planId);
      return { status: 'active', plan_id: planId };
    }
    if (stripe?.enabled) {
      const { rows } = await this.pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
      if (!rows.length) throw new Error('User not found');
      const out = await stripe.createCheckout(userId, rows[0].email, planId);
      return { status: 'checkout', checkout_url: out.checkout_url };
    }
    // Stripe unconfigured: fall back to manual pending invoice (admin confirms)
    const periodStart = new Date().toISOString().slice(0, 10);
    const periodEnd = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    await this.pool.query(
      `INSERT INTO invoices (user_id, plan_id, period_start, period_end, amount_usd, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (user_id, period_start)
       DO UPDATE SET plan_id = EXCLUDED.plan_id, amount_usd = EXCLUDED.amount_usd,
                     status = 'pending'`,
      [userId, planId, periodStart, periodEnd, plan.price_monthly_usd],
    );
    return { status: 'pending_payment', plan_id: planId, amount_usd: plan.price_monthly_usd };
  }

  /** Admin confirms payment → subscription becomes active. */
  async confirmInvoice(invoiceId: number, method: string, reference: string) {
    const { rows } = await this.pool.query(
      `UPDATE invoices SET status='paid', method=$2, reference=$3, paid_at=now()
       WHERE id=$1 AND status='pending' RETURNING user_id, plan_id, period_start, period_end`,
      [invoiceId, method || 'bank', reference || ''],
    );
    if (!rows.length) throw new Error('Invoice not pending');
    const inv = rows[0];
    await this.activate(inv.user_id, inv.plan_id, inv.period_start, inv.period_end);
    return { ok: true, user_id: inv.user_id, plan_id: inv.plan_id };
  }

  async cancelInvoice(invoiceId: number) {
    await this.pool.query(`UPDATE invoices SET status='cancelled' WHERE id=$1 AND status='pending'`, [invoiceId]);
    return { ok: true };
  }

  private async activate(userId: number, planId: string, periodStart?: string, periodEnd?: string) {
    const ps = periodStart || new Date().toISOString().slice(0, 10);
    const pe = periodEnd || new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    await this.pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, 'active', $3, $4)
       ON CONFLICT (user_id) DO UPDATE
         SET plan_id = $2, status = 'active',
             current_period_start = $3, current_period_end = $4,
             cancel_at_period_end = FALSE, updated_at = now()`,
      [userId, planId, ps, pe],
    );
    // refresh gateway quota cache immediately
    await this.refreshQuotaCache(userId);
  }

  async cancel(userId: number, atPeriodEnd: boolean) {
    if (atPeriodEnd) {
      await this.pool.query(
        `UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = now() WHERE user_id = $1`,
        [userId],
      );
      return { status: 'cancels_at_period_end' };
    }
    await this.activate(userId, 'free');
    return { status: 'active', plan_id: 'free' };
  }

  /** Public alias used by Stripe webhooks to drop a user back to free. */
  async activateFree(userId: number) {
    await this.activate(userId, 'free');
    return { status: 'active', plan_id: 'free' };
  }

  async listInvoices(userId: number) {
    const { rows } = await this.pool.query(
      `SELECT id, plan_id, period_start, period_end, amount_usd, status, method, reference,
              paid_at, created_at
       FROM invoices WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return rows;
  }

  async allInvoices(status?: string | undefined) {
    const { rows } = await this.pool.query(
      `SELECT i.id, i.user_id, u.email, i.plan_id, i.period_start, i.period_end,
              i.amount_usd, i.status, i.method, i.reference, i.paid_at, i.created_at
       FROM invoices i JOIN users u ON u.id = i.user_id
       WHERE ($1::text IS NULL OR i.status = $1)
       ORDER BY i.created_at DESC LIMIT 100`,
      [status || null],
    );
    return rows;
  }

  /** Daily+monthly counters and RPM in Valkey — the gateway reads these hot keys. */
  async refreshQuotaCache(userId: number) {
    const sub = await this.getSubscription(userId);
    if (!sub) return;
    const quota = {
      plan: sub.plan_id,
      rpd: Number(sub.requests_per_day),
      rpm: Number(sub.rate_limit_per_min),
      max_keys: Number(sub.max_keys),
    };
    const day = new Date().toISOString().slice(0, 10);
    const dkey = `quota:${userId}:${day}`;
    await this.redis.set(dkey, '0', 'EX', 172800);
    await this.redis.set(`quota:limits:${userId}`, JSON.stringify(quota));
  }

  /** Increment daily usage; returns remaining requests (null = unlimited). Throws over-quota. */
  async consumeQuota(userId: number): Promise<{ remaining: number | null }> {
    const sub = await this.getSubscription(userId);
    if (!sub) return { remaining: null };
    const rpd = Number(sub.requests_per_day);
    if (rpd < 0) return { remaining: null };
    const day = new Date().toISOString().slice(0, 10);
    const dkey = `quota:${userId}:${day}`;
    const n = await this.redis.incr(dkey);
    if (n === 1) await this.redis.expire(dkey, 172800);
    const remaining = rpd - n;
    if (remaining < 0) {
      await this.redis.decr(dkey);
      throw new Error('quota_exceeded');
    }
    return { remaining };
  }

  async usageSummary(userId: number) {
    const sub = await this.getSubscription(userId);
    const day = new Date().toISOString().slice(0, 10);
    const usedToday = parseInt((await this.redis.get(`quota:${userId}:${day}`)) || '0', 10);
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM request_history
       WHERE user_id = $1 AND requested_at > now() - interval '30 days'`,
      [userId],
    );
    return {
      plan: sub?.plan_id ?? 'free',
      plan_name: sub?.plan_name ?? 'Free',
      status: sub?.status ?? 'active',
      renews_at: sub?.current_period_end ?? null,
      cancel_at_period_end: sub?.cancel_at_period_end ?? false,
      requests_today: usedToday,
      requests_per_day: sub ? Number(sub.requests_per_day) : 200,
      requests_30d: rows[0]?.n ?? 0,
      requests_per_month: sub ? Number(sub.requests_per_month) : 3000,
      rate_limit_per_min: sub ? Number(sub.rate_limit_per_min) : 10,
    };
  }
}