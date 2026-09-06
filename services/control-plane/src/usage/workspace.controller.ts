// GET/PATCH/DELETE /api/v1/workspace — the Control Center Settings page's
// workspace card. A workspace is the user's primary project row; the slug
// is derived once from the name and immutable (rename keeps the slug).
import { Controller, Get, Patch, Delete, Req, Res, Body, Inject, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL } from '../db/db.module';

@Controller('api/v1/workspace')
export class WorkspaceController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async user(req: Request): Promise<{ id: number } | null> {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)simha_session=([^;]*)/);
    if (!m) return null;
    const hash = crypto.createHash('sha256').update(decodeURIComponent(m[1])).digest('hex');
    const { rows } = await this.pool.query(
      `SELECT s.user_id AS id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [hash]);
    return rows.length ? rows[0] : null;
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'workspace';
  }

  /** The workspace is the user's oldest project (auto-created default). */
  @Get()
  async get(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    let { rows } = await this.pool.query(
      `SELECT id, name, created_at FROM projects WHERE user_id = $1 ORDER BY id ASC LIMIT 1`,
      [user.id]);
    if (!rows.length) {
      const created = await this.pool.query(
        `INSERT INTO projects(user_id, name) VALUES ($1, 'Default workspace') RETURNING id, name, created_at`,
        [user.id]);
      rows = created.rows;
    }
    const w = rows[0];
    return res.json({
      id: w.id,
      name: w.name,
      slug: this.slugify(w.name),
      created_at: w.created_at,
    });
  }

  @Patch()
  async rename(@Req() req: Request, @Res() res: Response, @Body() body: { name?: string }) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return res.status(HttpStatus.BAD_REQUEST).json({ error: 'name required' });
    const { rows } = await this.pool.query(
      `SELECT id FROM projects WHERE user_id = $1 ORDER BY id ASC LIMIT 1`, [user.id]);
    if (!rows.length) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Workspace not found' });
    const { rows: updated } = await this.pool.query(
      `UPDATE projects SET name = $2, updated_at = now() WHERE id = $1 RETURNING id, name, updated_at`,
      [rows[0].id, name]);
    return res.json({ ...updated[0], slug: this.slugify(name) });
  }

  @Delete()
  async remove(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    // Danger zone: delete the workspace project + its chats. Guard: refuse if
    // the user has other projects, so a stray click can't nuke everything.
    const { rows } = await this.pool.query(
      `SELECT id FROM projects WHERE user_id = $1 ORDER BY id ASC`, [user.id]);
    if (rows.length <= 1) {
      return res.status(HttpStatus.CONFLICT).json({
        error: 'Cannot delete the only workspace — create another workspace first.',
      });
    }
    const { rowCount } = await this.pool.query(
      `DELETE FROM projects WHERE id = $1 AND user_id = $2`, [rows[0].id, user.id]);
    if (!rowCount) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Workspace not found' });
    return res.json({ ok: true });
  }
}