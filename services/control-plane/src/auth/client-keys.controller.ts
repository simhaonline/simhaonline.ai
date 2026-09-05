// Client API key management (legacy admin_client_keys + dashboard ownership).
import { Controller, Get, Post, Body, Req, Res, Param, Patch, Delete, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { AuthService, sha256Hex } from './auth.service';

const COOKIE = 'simha_session';

function unauthorized(res: Response) {
  return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
}

@Controller('api/client-keys')
export class ClientKeysController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly auth: AuthService,
  ) {}

  private async user(req: Request) {
    return this.auth.sessionUser(req.cookies?.[COOKIE]);
  }

  @Get()
  async list(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const ownerFilter = user.role === 'admin' ? '' : 'WHERE owner_user_id = $1';
    const params = user.role === 'admin' ? [] : [user.id];
    const { rows } = await this.pool.query(
      `SELECT id, name, key_prefix, active, created_at, last_used_at, expires_at, request_count
       FROM client_api_keys ${ownerFilter} ORDER BY created_at DESC`,
      params,
    );
    return res.json({ keys: rows });
  }

  @Post()
  async create(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: { name?: string; expires_at?: number | null },
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const name = (body.name || '').trim();
    if (!name || name.length > 80) {
      throw new HttpException(
        { error: 'name is required and must be 80 characters or fewer' },
        HttpStatus.BAD_REQUEST,
      );
    }
    let expiresAt: Date | null = null;
    if (body.expires_at) {
      const d = new Date(Number(body.expires_at) * 1000);
      if (isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        throw new HttpException(
          { error: 'expires_at must be a future Unix timestamp or null' },
          HttpStatus.BAD_REQUEST,
        );
      }
      expiresAt = d;
    }
    const raw = 'sek_' + crypto.randomBytes(30).toString('base64url');
    const ownerId = user.role === 'admin' ? null : user.id;
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO client_api_keys(name, key_hash, key_prefix, expires_at, owner_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [name, sha256Hex(raw), raw.slice(0, 12), expiresAt, ownerId],
      );
      return res.status(HttpStatus.CREATED).json({
        ok: true,
        id: rows[0].id,
        key: raw,
        warning: 'Copy this key now. It will not be shown again.',
      });
    } catch {
      throw new HttpException({ error: 'could not create client key' }, HttpStatus.CONFLICT);
    }
  }

  @Patch(':id')
  async modify(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') idParam: string,
    @Body() body: { active?: boolean; name?: string },
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(idParam);
    const { rows } = await this.pool.query(
      `SELECT owner_user_id FROM client_api_keys WHERE id = $1`,
      [id],
    );
    if (!rows.length) throw new HttpException({ error: 'not found' }, HttpStatus.NOT_FOUND);
    if (user.role !== 'admin' && rows[0].owner_user_id !== user.id) {
      throw new HttpException({ error: 'not your key' }, HttpStatus.FORBIDDEN);
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    if (typeof body.active === 'boolean') {
      params.push(body.active);
      sets.push(`active = $${params.length}`);
    }
    if (body.name) {
      params.push(body.name.trim().slice(0, 80));
      sets.push(`name = $${params.length}`);
    }
    if (!sets.length) return res.json({ ok: true });
    params.push(id);
    await this.pool.query(
      `UPDATE client_api_keys SET ${sets.join(', ')} WHERE id = $${params.length}`,
      params,
    );
    return res.json({ ok: true });
  }

  @Delete(':id')
  async revoke(@Req() req: Request, @Res() res: Response, @Param('id') idParam: string) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(idParam);
    const { rows } = await this.pool.query(
      `SELECT owner_user_id FROM client_api_keys WHERE id = $1`,
      [id],
    );
    if (!rows.length) throw new HttpException({ error: 'not found' }, HttpStatus.NOT_FOUND);
    if (user.role !== 'admin' && rows[0].owner_user_id !== user.id) {
      throw new HttpException({ error: 'not your key' }, HttpStatus.FORBIDDEN);
    }
    await this.pool.query(`UPDATE client_api_keys SET active = false WHERE id = $1`, [id]);
    return res.json({ ok: true });
  }
}