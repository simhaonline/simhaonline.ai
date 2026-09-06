// GET endpoints surfacing the platform catalogs to the Workbench:
// projects (Chats sidebar), skills/agents/MCP (Studio/Integrations tabs).
import { Controller, Get, Post, Patch, Delete, Param, Body, Req, Res, Inject, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL } from '../db/db.module';

@Controller('chat/api/v1')
export class WorkbenchCatalogController {
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

  // ── Projects ──────────────────────────────────────────────────────────────

  @Get('projects')
  async projects(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rows } = await this.pool.query(
      `SELECT p.id, p.name, p.description,
              (SELECT COUNT(*)::bigint FROM chat_history c WHERE c.project_id = p.id) AS conversation_count
       FROM projects p WHERE p.user_id = $1 ORDER BY p.updated_at DESC`, [user.id]);
    return res.json({ projects: rows });
  }

  @Post('projects')
  async createProject(
    @Req() req: Request, @Res() res: Response,
    @Body() body: { name?: string; description?: string },
  ) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const name = String(body.name || '').trim().slice(0, 120);
    if (!name) return res.status(HttpStatus.BAD_REQUEST).json({ error: 'name required' });
    const { rows } = await this.pool.query(
      `INSERT INTO projects(user_id, name, description) VALUES ($1, $2, $3)
       RETURNING id, name, description`,
      [user.id, name, String(body.description || '').slice(0, 500) || null]);
    return res.status(HttpStatus.CREATED).json({ ...rows[0], conversation_count: 0 });
  }

  @Patch('projects/:id')
  async patchProject(
    @Req() req: Request, @Res() res: Response, @Param('id') id: string,
    @Body() body: { name?: string; description?: string },
  ) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rows } = await this.pool.query(
      `UPDATE projects SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         updated_at = now()
       WHERE id = $1 AND user_id = $4 RETURNING id, name, description`,
      [Number(id), body.name ?? null, body.description ?? null, user.id]);
    if (!rows.length) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Project not found' });
    return res.json(rows[0]);
  }

  @Delete('projects/:id')
  async deleteProject(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rowCount } = await this.pool.query(
      `DELETE FROM projects WHERE id = $1 AND user_id = $2`, [Number(id), user.id]);
    if (!rowCount) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Project not found' });
    return res.json({ ok: true });
  }

  /** POST /projects/:id/conversations/:chatId — attach a chat to a project. */
  @Post('projects/:id/conversations/:chatId')
  async attachChat(
    @Req() req: Request, @Res() res: Response,
    @Param('id') id: string, @Param('chatId') chatId: string,
  ) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rowCount } = await this.pool.query(
      `UPDATE chat_history SET project_id = $1 WHERE id = $2 AND user_id = $3`,
      [Number(id), Number(chatId), user.id]);
    if (!rowCount) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Conversation not found' });
    return res.json({ ok: true });
  }

  // ── Capabilities: skills / agents / MCP servers ───────────────────────────

  @Get('capabilities')
  async capabilities(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rows } = await this.pool.query(
      `SELECT id, kind, slug, name, description, enabled
       FROM feature_catalog ORDER BY kind, name`);
    const skills = rows.filter((r) => r.kind === 'skill');
    const agents = rows.filter((r) => r.kind === 'agent');
    const plugins = rows.filter((r) => r.kind === 'plugin');
    // MCP servers from the discovery engine's registry (read-only, loopback)
    let mcp: Array<{ name: string; url: string; source: string }> = [];
    try {
      const r = await fetch(`${process.env.DISCOVERY_URL || 'http://discovery:8115'}/entities?kind=mcp`, {
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) {
        const d = (await r.json()) as { entities?: Array<{ name?: string; url?: string; source_name?: string }> };
        mcp = (d.entities || []).slice(0, 50).map((e) => ({
          name: String(e.name || 'MCP server'),
          url: String(e.url || ''),
          source: String(e.source_name || 'registry'),
        }));
      }
    } catch { /* discovery optional */ }
    return res.json({ skills, agents, plugins, mcp });
  }
}