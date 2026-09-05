// Stripe integration: Checkout sessions, webhooks, customer portal.
// STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL from env.
import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { PG_POOL, REDIS } from '../db/db.module';
import { BillingService } from './billing.service';

@Injectable()
export class StripeService {
  private stripe: Stripe | null = null;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly billing: BillingService,
  ) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) this.stripe = new Stripe(key);
  }

  get enabled(): boolean {
    return !!this.stripe;
  }

  /** Ensure the Stripe Price exists for a plan (admin sync); returns price id. */
  async ensurePrice(planId: string): Promise<string | null> {
    if (!this.stripe) throw new Error('Stripe not configured (STRIPE_SECRET_KEY missing)');
    const { rows } = await this.pool.query(
      `SELECT id, name, price_monthly_usd, stripe_price_id FROM plans WHERE id = $1`,
      [planId],
    );
    if (!rows.length) throw new Error('Unknown plan');
    const plan = rows[0];
    if (plan.stripe_price_id) return plan.stripe_price_id as string;
    // create product + recurring monthly price
    const product = await this.stripe.products.create({
      name: `Simha Online ${plan.name}`,
      metadata: { plan_id: planId },
    });
    const price = await this.stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(Number(plan.price_monthly_usd) * 100),
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { plan_id: planId },
    });
    await this.pool.query(`UPDATE plans SET stripe_price_id = $1 WHERE id = $2`, [price.id, planId]);
    return price.id;
  }

  /** Create a Checkout Session for switching to a paid plan. */
  async createCheckout(userId: number, email: string, planId: string) {
    if (!this.stripe) throw new Error('Stripe not configured (STRIPE_SECRET_KEY missing)');
    const plan = await this.billing.getPlan(planId);
    if (!plan || Number(plan.price_monthly_usd) <= 0) throw new Error('Unknown paid plan');
    const priceId = await this.ensurePrice(planId);
    const base = process.env.STRIPE_SUCCESS_URL
      ? process.env.STRIPE_SUCCESS_URL.replace(/\/dashboard.*$/, '')
      : (process.env.STRIPE_CANCEL_URL || process.env.NEXT_PUBLIC_SITE_URL || '');
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId!, quantity: 1 }],
      success_url: `${base}/dashboard?billing=success`,
      cancel_url: `${base}/pricing?billing=cancelled`,
      client_reference_id: String(userId),
      metadata: { user_id: String(userId), plan_id: planId },
      subscription_data: { metadata: { user_id: String(userId), plan_id: planId } },
    });
    return { checkout_url: session.url };
  }

  /** Verify a webhook event's signature and process it. Returns true if handled. */
  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<boolean> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!this.stripe || !secret) return false;
    let event: Stripe.Event;
    try {
      if (!signature) return false;
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      return false;
    }
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const userId = Number(s.client_reference_id || s.metadata?.user_id || 0);
        const planId = s.metadata?.plan_id || '';
        const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id;
        if (userId && planId) await this.activatePaid(userId, planId, subId, s.customer as string);
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = Number(sub.metadata?.user_id || 0);
        const planId = sub.metadata?.plan_id || '';
        if (userId && planId) {
          const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
          await this.activatePaid(
            userId, planId, sub.id, typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
            periodEnd ? new Date(periodEnd * 1000) : undefined,
          );
          await this.pool.query(
            `UPDATE subscriptions SET cancel_at_period_end = $2, updated_at = now()
             WHERE user_id = $1`,
            [userId, !!sub.cancel_at_period_end],
          );
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const userId = Number(sub.metadata?.user_id || 0);
        if (userId) await this.billing.activateFree(userId);
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } };
        const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
        if (subId) {
          await this.pool.query(
            `UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = now()
             WHERE stripe_subscription_id = $1`,
            [subId],
          );
        }
        break;
      }
    }
    return true;
  }

  private async activatePaid(
    userId: number, planId: string, stripeSubId?: string, stripeCustomer?: string,
    periodEnd?: Date,
  ) {
    const pe = periodEnd || new Date(Date.now() + 30 * 864e5);
    await this.pool.query(
      `INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end,
                                  stripe_subscription_id, stripe_customer_id)
       VALUES ($1, $2, 'active', CURRENT_DATE, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
         SET plan_id = $2, status = 'active',
             current_period_start = CURRENT_DATE, current_period_end = $3,
             stripe_subscription_id = $4, stripe_customer_id = $5,
             cancel_at_period_end = FALSE, updated_at = now()`,
      [userId, planId, pe, stripeSubId || null, stripeCustomer || null],
    );
    await this.billing.refreshQuotaCache(userId);
  }

  /** Stripe customer portal for managing/canceling the subscription. */
  async createPortal(userId: number): Promise<string> {
    if (!this.stripe) throw new Error('Stripe not configured');
    const { rows } = await this.pool.query(
      `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1`,
      [userId],
    );
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) throw new Error('No Stripe customer yet');
    const base = process.env.STRIPE_CANCEL_URL || process.env.NEXT_PUBLIC_SITE_URL || '';
    const portal = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/dashboard`,
    });
    return portal.url;
  }
}