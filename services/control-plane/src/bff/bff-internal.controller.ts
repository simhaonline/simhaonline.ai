// Internal endpoints consumed server-to-server by the Next.js BFF:
//   POST /internal/chat-dispatch-key — mint a short-lived gateway client key
//   scoped to the calling user's session (never exposed to browsers).
//   GET  /chat/api/models — discovered model catalog (any operator).
import { Controller, Get, Post, Req, Res, Inject, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL, REDIS } from '../db/db.module';
import { AuthService, sha256Hex } from '../auth/auth.service';
import type Redis from 'ioredis';

const COOKIE = 'simha_session';
// One live dispatch key per user at a time. The raw key is cached in Valkey
// (db1) alongside its row id; the row expires in PostgreSQL after an hour and
// the gateway's maintenance loop purges expired rows, while the Valkey cache
// TTL keeps a slightly shorter lifetime so a fresh key is minted just before
// the old one dies.
const DISPATCH_KEY_TTL_SECONDS = 3300;

@Injectable()
@Controller()
export class BffInternalController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly auth: AuthService,
  ) {}

  @Post('internal/chat-dispatch-key')
  async dispatchKey(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Authentication required' });
    // Reuse the user's still-valid dispatch key: one row per user instead of
    // one row per request (prevents unbounded client_api_keys growth).
    const cacheKey = `chat:dispatch-key:${user.id}`;
    const cached = await this.redis.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        const doc = JSON.parse(cached) as { key_id: number; api_key: string };
        const { rows } = await this.pool.query(
          `SELECT 1 FROM client_api_keys WHERE id = $1 AND active = TRUE AND expires_at > now()`,
          [doc.key_id],
        );
        if (rows.length) {
          return res.json({ api_key: doc.api_key, user_id: user.id, reused: true });
        }
        await this.redis.del(cacheKey).catch(() => undefined);
      } catch {
        await this.redis.del(cacheKey).catch(() => undefined);
      }
    }
    // Mint a per-use gateway key bound to this user for attribution.
    const raw = 'sekw_' + crypto.randomBytes(24).toString('base64url');
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO client_api_keys(name, key_hash, key_prefix, owner_user_id, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '1 hour') RETURNING id`,
        [`workbench:${user.email}`, sha256Hex(raw), raw.slice(0, 12), user.id],
      );
      const keyId = rows[0].id as number;
      // record usage attribution for request_history
      await this.pool.query(
        `INSERT INTO audit_log(actor, action, target) VALUES ($1, $2, $3)`,
        [user.email, 'chat.dispatch_key', String(keyId)],
      );
      await this.redis
        .set(cacheKey, JSON.stringify({ key_id: keyId, api_key: raw }), 'EX', DISPATCH_KEY_TTL_SECONDS)
        .catch(() => undefined);
      return res.status(HttpStatus.CREATED).json({ api_key: raw, user_id: user.id, reused: false });
    } catch {
      return res.status(HttpStatus.CONFLICT).json({ error: 'could not mint key' });
    }
  }

  @Get('chat/api/models')
  async models(@Req() req: Request, @Res() res: Response) {
    const user = await this.auth.sessionUser(req.cookies?.[COOKIE]);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Authentication required' });
    const { rows } = await this.pool.query(
      `SELECT DISTINCT model FROM discovered_models WHERE enabled = true ORDER BY model`,
    );
    return res.json({ models: rows.map((r) => r.model) });
  }
}
