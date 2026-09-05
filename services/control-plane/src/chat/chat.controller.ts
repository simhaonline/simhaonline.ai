// Chat workbench API — full legacy /chat/api surface: bootstrap, chats,
// messages, projects, features, settings, feedback, scheduled, library,
// generated content.
import { Controller, Get, Post, Patch, Delete, Req, Res, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { AuthService } from '../auth/auth.service';

const COOKIE = 'simha_session';

interface SessionUser {
  id: number;
  email: string;
  role: string;
}

function unauthorized(res: Response) {
  return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Authentication required' });
}

@Controller('chat/api')
export class ChatController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly auth: AuthService,
  ) {}

  private async user(req: Request): Promise<SessionUser | null> {
    return this.auth.sessionUser(req.cookies?.[COOKIE]);
  }

  @Get('bootstrap')
  async bootstrap(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const window = String((req.query.window as string) || 'all');
    let since: Date | null = null;
    if (window === '7d') since = new Date(Date.now() - 7 * 86400e3);
    else if (window === '30d') since = new Date(Date.now() - 30 * 86400e3);
    else if (window === 'month') {
      const d = new Date();
      since = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    const q = String((req.query.q as string) || '').toLowerCase();
    const { rows: chats } = await this.pool.query(
      `SELECT id, project_id, title, mode, model, archived, created_at, updated_at
       FROM chat_history
       WHERE user_id = $1 AND ($2::timestamptz IS NULL OR updated_at >= $2)
         AND ($3 = '' OR lower(title) LIKE '%' || $3 || '%')
       ORDER BY updated_at DESC LIMIT 100`,
      [user.id, since, q],
    );
    const { rows: projects } = await this.pool.query(
      `SELECT id, name, description, purpose, created_at, updated_at
       FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
      [user.id],
    );
    const { rows: features } = await this.pool.query(
      `SELECT f.id, f.kind, f.slug, f.name, f.description, f.permission,
              COALESCE(uf.enabled, f.enabled) AS enabled,
              COALESCE(uf.permission, f.permission) AS effective_permission
       FROM feature_catalog f
       LEFT JOIN user_features uf ON uf.feature_id = f.id AND uf.user_id = $1
       ORDER BY f.kind, f.name`,
      [user.id],
    );
    const { rows: scheduled } = await this.pool.query(
      `SELECT id, title, prompt, status, run_at, created_at
       FROM scheduled_tasks WHERE user_id = $1
       ORDER BY COALESCE(run_at, created_at) DESC LIMIT 50`,
      [user.id],
    );
    const { rows: settings } = await this.pool.query(
      `SELECT settings_json FROM user_settings WHERE user_id = $1`,
      [user.id],
    );
    return res.json({
      user,
      chats,
      projects,
      features,
      scheduled,
      settings: settings.length ? settings[0].settings_json : {},
      counts: { chats: chats.length, scheduled: scheduled.length, projects: projects.length },
    });
  }

  @Post('chats')
  async createChat(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const title = String(body.title || 'New conversation').slice(0, 160);
    const { rows } = await this.pool.query(
      `INSERT INTO chat_history(user_id, project_id, title, mode, model)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at, updated_at`,
      [user.id, body.project_id ?? null, title, String(body.mode || 'chat'), String(body.model || 'auto')],
    );
    return res.status(HttpStatus.CREATED).json({
      id: rows[0].id,
      title,
      created_at: rows[0].created_at,
      updated_at: rows[0].updated_at,
    });
  }

  @Patch('chats')
  async updateChat(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(body.id || 0);
    const { rowCount } = await this.pool.query(
      `UPDATE chat_history SET archived = $1, title = COALESCE($2, title), updated_at = now()
       WHERE id = $3 AND user_id = $4`,
      [Boolean(body.archived), body.title ?? null, id, user.id],
    );
    if (!rowCount) throw new HttpException({ error: 'Chat not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  @Delete('chats')
  async deleteChat(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(body.id || 0);
    const { rowCount } = await this.pool.query(
      `DELETE FROM chat_history WHERE id = $1 AND user_id = $2`,
      [id, user.id],
    );
    if (!rowCount) throw new HttpException({ error: 'Chat not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  @Get('chats/:id/messages')
  async messages(@Req() req: Request, @Res() res: Response, @Param('id') chatId: string) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT m.id, m.role, m.content, m.model, m.tokens, m.created_at
       FROM chat_messages m JOIN chat_history c ON c.id = m.chat_id
       WHERE m.chat_id = $1 AND c.user_id = $2 ORDER BY m.created_at ASC`,
      [Number(chatId), user.id],
    );
    return res.json({ messages: rows });
  }

  @Post('chats/:id/messages')
  async addMessage(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') chatId: string,
    @Body() body: { role?: string; content?: string; model?: string; tokens?: number },
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const role = String(body.role || 'user');
    const content = String(body.content || '');
    if (!['user', 'assistant', 'system', 'tool'].includes(role)) {
      throw new HttpException({ error: 'invalid role' }, HttpStatus.BAD_REQUEST);
    }
    const { rows } = await this.pool.query(
      `INSERT INTO chat_messages(chat_id, role, content, model, tokens)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [Number(chatId), role, content, body.model ?? null, Number(body.tokens || 0)],
    );
    await this.pool.query(
      `UPDATE chat_history SET updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [Number(chatId), user.id],
    );
    return res.status(HttpStatus.CREATED).json({ id: rows[0].id, created_at: rows[0].created_at });
  }

  @Get('projects')
  async listProjects(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT * FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
      [user.id],
    );
    return res.json({ projects: rows });
  }

  @Post('projects')
  async createProject(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `INSERT INTO projects(user_id, name, description, purpose)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        user.id,
        String(body.name || 'Untitled project').slice(0, 120),
        String(body.description || '').slice(0, 1000),
        String(body.purpose || '').slice(0, 500),
      ],
    );
    return res.status(HttpStatus.CREATED).json({ ok: true, id: rows[0].id });
  }

  @Patch('projects')
  async updateProject(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(body.id || 0);
    const { rowCount } = await this.pool.query(
      `UPDATE projects SET name = $1, description = $2, purpose = $3, updated_at = now()
       WHERE id = $4 AND user_id = $5`,
      [body.name, body.description ?? '', body.purpose ?? '', id, user.id],
    );
    if (!rowCount) throw new HttpException({ error: 'Project not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  @Delete('projects')
  async deleteProject(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(body.id || 0);
    const { rowCount } = await this.pool.query(
      `DELETE FROM projects WHERE id = $1 AND user_id = $2`,
      [id, user.id],
    );
    if (!rowCount) throw new HttpException({ error: 'Project not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  @Patch('features/:id')
  async toggleFeature(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') featureId: string,
    @Body() body: { enabled?: boolean; permission?: string },
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(`SELECT id FROM feature_catalog WHERE id = $1`, [
      Number(featureId),
    ]);
    if (!rows.length) throw new HttpException({ error: 'Capability not found' }, HttpStatus.NOT_FOUND);
    await this.pool.query(
      `INSERT INTO user_features(user_id, feature_id, enabled, permission)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, feature_id) DO UPDATE
         SET enabled = EXCLUDED.enabled,
             permission = COALESCE(EXCLUDED.permission, user_features.permission)`,
      [user.id, Number(featureId), body.enabled ?? true, body.permission ?? null],
    );
    await this.pool.query(
      `INSERT INTO usage_metrics(user_id, event, target) VALUES ($1, 'feature_toggle', $2)`,
      [user.id, featureId],
    );
    return res.json({ ok: true });
  }

  @Get('settings')
  async getSettings(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT settings_json FROM user_settings WHERE user_id = $1`,
      [user.id],
    );
    return res.json(rows.length ? rows[0].settings_json : {});
  }

  @Patch('settings')
  async setSettings(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    await this.pool.query(
      `INSERT INTO user_settings(user_id, settings_json)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET settings_json = EXCLUDED.settings_json, updated_at = now()`,
      [user.id, JSON.stringify(body).slice(0, 20000)],
    );
    return res.json({ ok: true, settings: body });
  }

  @Post('feedback')
  async feedback(@Req() req: Request, @Res() res: Response, @Body() body: { message?: string; category?: string }) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const message = String(body.message || '').trim();
    if (!message) {
      throw new HttpException({ error: 'Please enter feedback' }, HttpStatus.BAD_REQUEST);
    }
    await this.pool.query(`INSERT INTO feedback(user_id, category, message) VALUES ($1, $2, $3)`, [
      user.id,
      String(body.category || 'general').slice(0, 40),
      message.slice(0, 5000),
    ]);
    return res.status(HttpStatus.CREATED).json({ ok: true });
  }

  @Get('scheduled')
  async listScheduled(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT * FROM scheduled_tasks WHERE user_id = $1 ORDER BY COALESCE(run_at, created_at) DESC`,
      [user.id],
    );
    return res.json({ scheduled: rows });
  }

  @Post('scheduled')
  async createScheduled(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const runAt = body.run_at ? new Date(Number(body.run_at) * 1000) : null;
    const { rows } = await this.pool.query(
      `INSERT INTO scheduled_tasks(user_id, title, prompt, run_at)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        user.id,
        String(body.title || 'Scheduled task').slice(0, 160),
        String(body.prompt || '').slice(0, 10000),
        runAt,
      ],
    );
    return res.status(HttpStatus.CREATED).json({ ok: true, id: rows[0].id });
  }

  @Patch('scheduled')
  async updateScheduled(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(body.id || 0);
    const runAt = body.run_at ? new Date(Number(body.run_at) * 1000) : null;
    const { rowCount } = await this.pool.query(
      `UPDATE scheduled_tasks
       SET status = COALESCE($1::text, status), title = COALESCE($2::text, title),
           prompt = COALESCE($3::text, prompt), run_at = COALESCE($4::timestamptz, run_at)
       WHERE id = $5 AND user_id = $6`,
      [
        (body.status as string) || null,
        (body.title as string) || null,
        (body.prompt as string) || null,
        runAt,
        id,
        user.id,
      ],
    );
    if (!rowCount) throw new HttpException({ error: 'Task not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  @Delete('scheduled')
  async deleteScheduled(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(body.id || 0);
    const { rowCount } = await this.pool.query(
      `DELETE FROM scheduled_tasks WHERE id = $1 AND user_id = $2`,
      [id, user.id],
    );
    if (!rowCount) throw new HttpException({ error: 'Task not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  @Get('library')
  async listLibrary(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT * FROM saved_resources WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id],
    );
    return res.json({ resources: rows });
  }

  @Post('library')
  async addLibrary(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    await this.pool.query(
      `INSERT INTO saved_resources(user_id, title, kind, content) VALUES ($1, $2, $3, $4)`,
      [
        user.id,
        String(body.title || 'Untitled').slice(0, 160),
        String(body.kind || 'prompt').slice(0, 40),
        String(body.content || '').slice(0, 20000),
      ],
    );
    return res.status(HttpStatus.CREATED).json({ ok: true });
  }

  @Delete('library')
  async deleteLibrary(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    await this.pool.query(`DELETE FROM saved_resources WHERE id = $1 AND user_id = $2`, [
      Number(body.id || 0),
      user.id,
    ]);
    return res.json({ ok: true });
  }

  @Get('generated')
  async listGenerated(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT * FROM generated_content WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [user.id],
    );
    return res.json({ items: rows });
  }

  @Post('generated')
  async addGenerated(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    await this.pool.query(
      `INSERT INTO generated_content(user_id, kind, prompt, result_ref) VALUES ($1, $2, $3, $4)`,
      [
        user.id,
        String(body.kind || 'image').slice(0, 40),
        String(body.prompt || '').slice(0, 10000),
        (body.result_ref as string) || null,
      ],
    );
    return res.status(HttpStatus.CREATED).json({ ok: true });
  }
}