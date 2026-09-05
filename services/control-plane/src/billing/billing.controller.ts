// User-facing billing endpoints (BFF-forwarded via /api/billing/*).
import { Controller, Get, Post, Body, Req, Res, Param, Headers, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { PG_POOL } from '../db/db.module';
import { Pool } from 'pg';

const COOKIE = 'simha_session';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly stripe: StripeService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  private async user(req: Request) {
    const { rows } = await this.pool.query(
      `SELECT id, email, role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [require('crypto').createHash('sha256').update(req.cookies?.[COOKIE] || '').digest('hex')],
    );
    return rows[0] || null;
  }

  @Get('plans')
  async plans(@Res() res: Response) {
    return res.json({ plans: await this.billing.listPlans() });
  }

  @Get('subscription')
  async subscription(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const sub = await this.billing.getSubscription(user.id);
    return res.json({ subscription: sub });
  }

  @Get('usage')
  async usage(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    return res.json(await this.billing.usageSummary(user.id));
  }

  @Post('subscribe')
  async subscribe(@Req() req: Request, @Res() res: Response, @Body() body: { plan_id?: string }) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    try {
      const out = await this.billing.requestPlan(user.id, String(body.plan_id || ''), this.stripe);
      return res.status(HttpStatus.CREATED).json(out);
    } catch (e) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: (e as Error).message });
    }
  }

  /** Stripe customer portal (manage card / cancel). */
  @Post('portal')
  async portal(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    try {
      const url = await this.stripe.createPortal(user.id);
      return res.json({ portal_url: url });
    } catch (e) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: (e as Error).message });
    }
  }

  /**
   * Stripe webhook — MUST receive the raw body. Mounted in main.ts with
   * raw-body parsing before the JSON middleware (see bootstrap()).
   */
  @Post('webhook')
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Res() res: Response,
    @Headers('stripe-signature') signature: string,
  ) {
    const ok = await this.stripe.handleWebhook(
      (req.rawBody as Buffer) || Buffer.from(''),
      signature,
    );
    if (!ok) return res.status(HttpStatus.BAD_REQUEST).json({ error: 'invalid signature or stripe disabled' });
    return res.json({ received: true });
  }

  @Post('cancel')
  async cancel(@Req() req: Request, @Res() res: Response, @Body() body: { at_period_end?: boolean }) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    return res.json(await this.billing.cancel(user.id, body.at_period_end !== false));
  }

  @Get('invoices')
  async invoices(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    return res.json({ invoices: await this.billing.listInvoices(user.id) });
  }

  // -------- admin --------
  @Get('admin/invoices')
  async adminInvoices(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user || user.role !== 'admin') {
      return res.status(HttpStatus.FORBIDDEN).json({ error: 'Admin only' });
    }
    const status = (req.query.status as string) ?? undefined;
    return res.json({ invoices: await this.billing.allInvoices(status) });
  }

  @Post('admin/invoices/:id/confirm')
  async confirm(@Req() req: Request, @Res() res: Response, @Param('id') id: string,
                @Body() body: { method?: string; reference?: string }) {
    const user = await this.user(req);
    if (!user || user.role !== 'admin') {
      return res.status(HttpStatus.FORBIDDEN).json({ error: 'Admin only' });
    }
    try {
      const out = await this.billing.confirmInvoice(Number(id), body.method ?? '', body.reference ?? '');
      return res.json(out);
    } catch (e) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: (e as Error).message });
    }
  }

  @Post('admin/invoices/:id/cancel')
  async adminCancel(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user || user.role !== 'admin') {
      return res.status(HttpStatus.FORBIDDEN).json({ error: 'Admin only' });
    }
    return res.json(await this.billing.cancelInvoice(Number(id)));
  }
}