// User-facing billing endpoints (BFF-forwarded via /api/billing/*).
import { Controller, Get, Post, Body, Req, Res, Param, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PG_POOL } from '../db/db.module';
import { Pool } from 'pg';

const COOKIE = 'simha_session';

@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
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
      const out = await this.billing.requestPlan(user.id, String(body.plan_id || ''));
      return res.status(HttpStatus.CREATED).json(out);
    } catch (e) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: (e as Error).message });
    }
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