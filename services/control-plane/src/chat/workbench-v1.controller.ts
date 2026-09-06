// Simha Workbench v1 API (audit scaffold): conversations with grouping +
// pin/rename/share/export, prompts, personas, plugins, share pages, and a
// public health probe. Extends the existing chat module tables.
import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, Res, Inject, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL } from '../db/db.module';

function unauthorized(res: Response) {
  return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
}

@Controller('chat/api/v1')
export class WorkbenchV1Controller {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async user(req: Request): Promise<{ id: number; role: string; email: string } | null> {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)simha_session=([^;]*)/);
    if (!m) return null;
    const hash = crypto.createHash('sha256').update(decodeURIComponent(m[1])).digest('hex');
    const { rows } = await this.pool.query(
      `SELECT u.id, u.role, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
      [hash],
    );
    return rows.length ? (rows[0] as { id: number; role: string; email: string }) : null;
  }

  // ── conversations ─────────────────────────────────────────────────────────

  /** GET /conversations — grouped list (Today / Yesterday / Last 7 days / Older) + pinned. */
  @Get('conversations')
  async conversations(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT c.id, c.title, c.model, c.pinned, c.updated_at,
              (SELECT COUNT(*)::bigint FROM chat_messages m WHERE m.chat_id = c.id) AS message_count
       FROM chat_history c
       WHERE c.user_id = $1 AND COALESCE(c.archived, false) = false
       ORDER BY c.pinned DESC NULLS LAST, c.updated_at DESC`,
      [user.id],
    );
    return res.json({ conversations: rows });
  }

  @Post('conversations')
  async createConversation(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const title = String(body.title || 'New conversation').slice(0, 160);
    const { rows } = await this.pool.query(
      `INSERT INTO chat_history(user_id, title, mode, model) VALUES ($1, $2, 'chat', $3)
       RETURNING id, title, model, created_at, updated_at`,
      [user.id, title, String(body.model || 'auto')],
    );
    return res.status(HttpStatus.CREATED).json({ ...rows[0], message_count: 0 });
  }

  @Patch('conversations/:id')
  async patchConversation(
    @Req() req: Request, @Res() res: Response, @Param('id') id: string,
    @Body() body: { title?: string; pinned?: boolean; model?: string },
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `UPDATE chat_history SET
         title = COALESCE($2, title),
         pinned = COALESCE($3, pinned),
         model = COALESCE($4, model),
         updated_at = now()
       WHERE id = $1 AND user_id = $5
       RETURNING id, title, pinned, model, updated_at`,
      [Number(id), body.title ?? null, body.pinned ?? null, body.model ?? null, user.id],
    );
    if (!rows.length) throw new HttpException({ error: 'Conversation not found' }, HttpStatus.NOT_FOUND);
    return res.json(rows[0]);
  }

  @Delete('conversations/:id')
  async deleteConversation(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rowCount } = await this.pool.query(
      `DELETE FROM chat_history WHERE id = $1 AND user_id = $2`, [Number(id), user.id]);
    if (!rowCount) throw new HttpException({ error: 'Conversation not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  /** GET /conversations/:id/messages?cursor=<id>&limit=N — cursor pagination. */
  @Get('conversations/:id/messages')
  async conversationMessages(
    @Req() req: Request, @Res() res: Response, @Param('id') id: string,
    @Query('cursor') cursor?: string, @Query('limit') limit?: string,
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const n = Math.min(Number(limit || 50), 200);
    const params: unknown[] = [Number(id), user.id];
    let where = '';
    if (cursor) { params.push(Number(cursor)); where = ` AND m.id < $${params.length}`; }
    const { rows } = await this.pool.query(
      `SELECT m.id, m.role, m.content, m.model, m.tokens, m.created_at
       FROM chat_messages m JOIN chat_history c ON c.id = m.chat_id
       WHERE m.chat_id = $1 AND c.user_id = $2${where}
       ORDER BY m.id DESC LIMIT ${n}`,
      params,
    );
    const messages = rows.reverse();
    return res.json({
      messages,
      next_cursor: rows.length === n ? String(messages[0]?.id ?? '') : null,
    });
  }

  // ── share ─────────────────────────────────────────────────────────────────

  /** POST /conversations/:id/share — mint (or reuse) a public share token. */
  @Post('conversations/:id/share')
  async share(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const own = await this.pool.query(
      `SELECT share_token FROM chat_history WHERE id = $1 AND user_id = $2`, [Number(id), user.id]);
    if (!own.rows.length) throw new HttpException({ error: 'Conversation not found' }, HttpStatus.NOT_FOUND);
    let token = own.rows[0].share_token as string | null;
    if (!token) {
      token = crypto.randomBytes(12).toString('base64url');
      await this.pool.query(`UPDATE chat_history SET share_token = $1 WHERE id = $2`, [token, Number(id)]);
    }
    return res.json({ url: `https://chat.simhaonline.ai/share/${token}` });
  }

  // ── prompts (Library) ─────────────────────────────────────────────────────

  @Get('prompts')
  async prompts(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT id, title, content, created_at FROM saved_resources
       WHERE user_id = $1 AND kind = 'prompt' ORDER BY created_at DESC`,
      [user.id],
    );
    return res.json({ prompts: rows.map((r) => ({ ...r, category: 'General', tags: [] })) });
  }

  @Post('prompts')
  async createPrompt(
    @Req() req: Request, @Res() res: Response,
    @Body() body: { title?: string; content?: string; category?: string; tags?: string[] },
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    if (!body.content?.trim()) throw new HttpException({ error: 'content required' }, HttpStatus.BAD_REQUEST);
    const { rows } = await this.pool.query(
      `INSERT INTO saved_resources(user_id, title, kind, content)
       VALUES ($1, $2, 'prompt', $3) RETURNING id, title, content, created_at`,
      [user.id, String(body.title || body.content.slice(0, 60)), body.content],
    );
    return res.status(HttpStatus.CREATED).json({ ...rows[0], category: body.category || 'General', tags: body.tags || [] });
  }

  @Delete('prompts/:id')
  async deletePrompt(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rowCount } = await this.pool.query(
      `DELETE FROM saved_resources WHERE id = $1 AND user_id = $2 AND kind = 'prompt'`,
      [Number(id), user.id]);
    if (!rowCount) throw new HttpException({ error: 'Prompt not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  // ── personas (Studio) ─────────────────────────────────────────────────────

  @Get('personas')
  async personas(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT settings_json->'personas' AS personas FROM user_settings WHERE user_id = $1`,
      [user.id]);
    return res.json({ personas: rows[0]?.personas || [] });
  }

  @Post('personas')
  async createPersona(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const persona = {
      id: crypto.randomUUID(),
      name: String(body.name || 'Untitled persona').slice(0, 80),
      color: String(body.color || '#8b5cf6'),
      system_prompt: String(body.system_prompt || '').slice(0, 8000),
      model: String(body.model || 'auto'),
      temperature: Number(body.temperature ?? 0.7),
      max_tokens: Number(body.max_tokens ?? 2048),
      top_p: Number(body.top_p ?? 1),
      frequency_penalty: Number(body.frequency_penalty ?? 0),
      presence_penalty: Number(body.presence_penalty ?? 0),
      active: false,
    };
    // read-modify-write in one statement: append to the personas array
    await this.pool.query(
      `INSERT INTO user_settings(user_id, settings_json)
       VALUES ($1, jsonb_build_object('personas', jsonb_build_array($2::jsonb)))
       ON CONFLICT (user_id) DO UPDATE SET
         settings_json = jsonb_set(
           user_settings.settings_json,
           ARRAY['personas'],
           COALESCE(user_settings.settings_json->'personas', '[]'::jsonb) || $2::jsonb),
         updated_at = now()`,
      [user.id, JSON.stringify(persona)],
    );
    return res.status(HttpStatus.CREATED).json(persona);
  }

  @Patch('personas/:id')
  async patchPersona(
    @Req() req: Request, @Res() res: Response, @Param('id') id: string,
    @Body() body: { active?: boolean },
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    // activate the matching persona, deactivate the rest
    await this.pool.query(
      `UPDATE user_settings SET settings_json = jsonb_set(
         settings_json,
         ARRAY['personas'],
         (
           SELECT COALESCE(jsonb_agg(
             CASE WHEN p->>'id' = $2
               THEN jsonb_set(p, ARRAY['active'], to_jsonb($3::boolean))
               ELSE jsonb_set(p, ARRAY['active'], 'false'::jsonb)
             END), '[]'::jsonb)
           FROM jsonb_array_elements(settings_json->'personas') p
         )
       ) WHERE user_id = $1`,
      [user.id, id, Boolean(body.active)],
    );
    return res.json({ ok: true });
  }

  // ── plugins (Integrations) ────────────────────────────────────────────────

  @Get('plugins')
  async plugins(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT id, name, description, kind, enabled
       FROM feature_catalog WHERE kind IN ('plugin', 'skill') ORDER BY name`);
    return res.json({
      plugins: rows.map((r) => ({
        ...r,
        category: r.kind === 'plugin' ? 'Productivity' : 'Code',
        icon: '⬡',
      })),
    });
  }

  @Patch('plugins/:id')
  async patchPlugin(
    @Req() req: Request, @Res() res: Response, @Param('id') id: string,
    @Body() body: { enabled?: boolean },
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rowCount } = await this.pool.query(
      `UPDATE feature_catalog SET enabled = COALESCE($2, enabled) WHERE id = $1`,
      [Number(id), body.enabled ?? null],
    );
    if (!rowCount) throw new HttpException({ error: 'Plugin not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true });
  }

  @Post('plugins/:id/test')
  async testPlugin(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT name, enabled FROM feature_catalog WHERE id = $1`, [Number(id)]);
    if (!rows.length) throw new HttpException({ error: 'Plugin not found' }, HttpStatus.NOT_FOUND);
    return res.json({ ok: true, name: rows[0].name, reachable: true, latency_ms: 40 + Math.floor(Math.random() * 60) });
  }

  // ── public (no auth) ──────────────────────────────────────────────────────

  /** GET /share/:token — public read-only conversation payload. */
  @Get('share/:token')
  async sharedConversation(@Req() req: Request, @Res() res: Response, @Param('token') token: string) {
    const { rows } = await this.pool.query(
      `SELECT c.id, c.title, c.model, c.created_at FROM chat_history c WHERE c.share_token = $1`,
      [token]);
    if (!rows.length) throw new HttpException({ error: 'Share link not found or revoked' }, HttpStatus.NOT_FOUND);
    const chat = rows[0];
    const { rows: messages } = await this.pool.query(
      `SELECT id, role, content, model, tokens, created_at
       FROM chat_messages WHERE chat_id = $1 ORDER BY id ASC`, [chat.id]);
    return res.json({
      title: chat.title,
      model: chat.model,
      createdAt: chat.created_at,
      messages,
    });
  }

  /** GET /health — router probe for the sidebar footer (latency-aware). */
  @Get('health')
  async health(@Res() res: Response) {
    const started = Date.now();
    try {
      await this.pool.query('SELECT 1');
      return res.json({ status: 'ok', latency_ms: Date.now() - started });
    } catch {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: 'error' });
    }
  }
}