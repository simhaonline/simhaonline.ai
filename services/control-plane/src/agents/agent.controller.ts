// Agent runtime API (Phase 5) — session-authenticated proxy to the agents
// engine. Users see their own runs; admins see all + approve gated calls.
import { Controller, Get, Post, Param, Body, Req, Res, Inject, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL } from '../db/db.module';

const AGENTS_BASE = process.env.AGENTS_URL || 'http://agents:8117';

@Controller('chat/api/v1/agents')
export class AgentController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async user(req: Request): Promise<{ id: number; role: string } | null> {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)simha_session=([^;]*)/);
    if (!m) return null;
    const hash = crypto.createHash('sha256').update(decodeURIComponent(m[1])).digest('hex');
    const { rows } = await this.pool.query(
      `SELECT s.user_id AS id, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [hash]);
    return rows.length ? rows[0] : null;
  }

  private async engine<T>(path: string, init?: RequestInit): Promise<T | null> {
    try {
      const r = await fetch(`${AGENTS_BASE}${path}`, {
        signal: AbortSignal.timeout(8000),
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      });
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch { return null; }
  }

  // POST /chat/api/v1/agents/runs {goal, max_steps?}
  @Post('runs')
  async createRun(@Req() req: Request, @Res() res: Response,
      @Body() body: { goal?: string; max_steps?: number }) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const goal = String(body.goal || '').trim();
    if (goal.length < 10) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Describe the goal (min 10 chars).' });
    }
    const run = await this.engine<{ id: number; status: string }>('/runs', {
      method: 'POST',
      body: JSON.stringify({
        goal,
        user_id: user.id,
        max_steps: Math.min(Number(body.max_steps || 10), 20),
        permissions: ['llm', 'web_retrieval', 'http_fetch', 'memory_search'],
      }),
    });
    if (!run) return res.status(HttpStatus.BAD_GATEWAY).json({ error: 'Agent runtime unavailable.' });
    return res.status(HttpStatus.CREATED).json(run);
  }

  // GET /chat/api/v1/agents/runs — my runs (admin: all)
  @Get('runs')
  async listRuns(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const data = await this.engine<{ runs: unknown[] }>(
      user.role === 'admin' ? '/runs?limit=50' : `/runs?limit=50&user_id=${user.id}`);
    if (!data) return res.status(HttpStatus.BAD_GATEWAY).json({ error: 'Agent runtime unavailable.' });
    return res.json(data);
  }

  // GET /chat/api/v1/agents/runs/:id — trace; non-admins may only view their own
  @Get('runs/:id')
  async runDetail(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const data = await this.engine<{ run: { user_id: number | null } }>(`/runs/${Number(id)}`);
    if (!data) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Run not found.' });
    if (user.role !== 'admin' && data.run.user_id !== user.id) {
      return res.status(HttpStatus.FORBIDDEN).json({ error: 'Not your run.' });
    }
    return res.json(data);
  }

  // GET /chat/api/v1/agents/runs/:id/status — light poll
  @Get('runs/:id/status')
  async runStatus(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const data = await this.engine<{ user_id?: number; status: string }>(`/runs/${Number(id)}/status`);
    if (!data) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Run not found.' });
    return res.json(data);
  }

  // POST /chat/api/v1/agents/runs/:id/cancel
  @Post('runs/:id/cancel')
  async cancelRun(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    await this.engine(`/runs/${Number(id)}/cancel`, { method: 'POST', body: '{}' });
    return res.json({ ok: true });
  }

  // GET /chat/api/v1/agents/approvals/pending — admin queue
  @Get('approvals/pending')
  async pendingApprovals(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user || user.role !== 'admin') {
      return res.status(HttpStatus.FORBIDDEN).json({ error: 'Administrator required.' });
    }
    // pull runs awaiting approval, expose their pending approval rows
    const data = await this.engine<{ runs: Array<{ id: number; status: string }> }>('/runs?limit=50');
    const pending: Array<Record<string, unknown>> = [];
    for (const r of data?.runs || []) {
      if (r.status !== 'awaiting_approval') continue;
      const detail = await this.engine<{ approvals: Array<Record<string, unknown>>; run: { goal: string } }>(`/runs/${r.id}`);
      for (const a of detail?.approvals || []) {
        if (a.status === 'pending') pending.push({ ...a, run_id: r.id, goal: detail?.run.goal });
      }
    }
    return res.json({ pending });
  }

  // POST /chat/api/v1/agents/approvals/:id/decide — admin only
  @Post('approvals/:id/decide')
  async decide(@Req() req: Request, @Res() res: Response,
      @Param('id') id: string, @Body() body: { approve?: boolean }) {
    const user = await this.user(req);
    if (!user || user.role !== 'admin') {
      return res.status(HttpStatus.FORBIDDEN).json({ error: 'Administrator required.' });
    }
    const out = await this.engine(`/approvals/${Number(id)}/decide`, {
      method: 'POST',
      body: JSON.stringify({ approved: Boolean(body.approve), decided_by: user.id }),
    });
    if (!out) return res.status(HttpStatus.BAD_GATEWAY).json({ error: 'Agent runtime unavailable.' });
    return res.json(out);
  }
}