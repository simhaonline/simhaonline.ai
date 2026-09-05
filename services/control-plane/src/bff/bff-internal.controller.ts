// Internal endpoints consumed server-to-server by the Next.js BFF:
//   POST /internal/chat-dispatch-key — mint a short-lived gateway client key
//   scoped to the calling user's session (never exposed to browsers).
//   GET  /chat/api/models — discovered model catalog (any operator).
import { Controller, Get, Post, Req, Res, Inject, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL } from '../db/db.module';
import { AuthService, sha256Hex } from '../auth/auth.service';

const COOKIE = 'simha_session';

@Controller()
export class BffInternalController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly auth: AuthService,
  ) {}

  @Post('internal/chat-dispatch-key')
  async dispatchKey(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Authentication required' });
    // Mint a per-use gateway key bound to this user for attribution.
    const raw = 'sekw_' + crypto.randomBytes(24).toString('base64url');
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO client_api_keys(name, key_hash, key_prefix, owner_user_id, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '1 hour') RETURNING id`,
        [`workbench:${user.email}`, sha256Hex(raw), raw.slice(0, 12), user.id],
      );
      // record usage attribution for request_history
      await this.pool.query(
        `INSERT INTO audit_log(actor, action, target) VALUES ($1, $2, $3)`,
        [user.email, 'chat.dispatch_key', String(rows[0].id)],
      );
      return res.status(HttpStatus.CREATED).json({ api_key: raw, user_id: user.id });
    } catch {
      return res.status(HttpStatus.CONFLICT).json({ error: 'could not mint key' });
    }
  }

  @Get('chat/api/models')
  async models(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Authentication required' });
    const { rows } = await this.pool.query(
      `SELECT DISTINCT model FROM discovered_models ORDER BY model`,
    );
    return res.json({ models: rows.map((r) => r.model) });
  }
}