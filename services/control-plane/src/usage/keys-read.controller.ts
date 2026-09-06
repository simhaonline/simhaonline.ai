// GET /api/v1/client-keys — Control Center keys read-model. Adds the
// requests-30d column the dashboard table needs (owner-scoped).
import { Controller, Get, Req, Res, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@Controller('api/v1/client-keys')
export class KeysReadController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async list(@Req() req: Request, @Res() res: Response) {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)simha_session=([^;]*)/);
    if (!m) return res.status(401).json({ error: 'Login required' });
    const { rows: sess } = await this.pool.query(
      `SELECT s.user_id, u.role FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
      [require('crypto').createHash('sha256').update(decodeURIComponent(m[1])).digest('hex')],
    );
    if (!sess.length) return res.status(401).json({ error: 'Login required' });
    const { user_id: userId, role } = sess[0];
    const ownerFilter = role === 'admin' ? '' : 'WHERE k.owner_user_id = $1';
    const params = role === 'admin' ? [] : [userId];
    const { rows } = await this.pool.query(
      `SELECT k.id, k.name, k.key_prefix, k.active, k.created_at, k.last_used_at,
              (SELECT COUNT(*)::bigint FROM request_history r
                WHERE r.client_key_id = k.id AND r.requested_at > now() - interval '30 days') AS requests_30d
       FROM client_api_keys k ${ownerFilter} ORDER BY k.created_at DESC`,
      params,
    );
    return res.json({ keys: rows });
  }
}