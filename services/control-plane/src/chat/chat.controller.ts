// Chat workbench API — full legacy /chat/api surface: bootstrap, chats,
// messages, projects, features, settings, feedback, scheduled, library,
// generated content.
import { Controller, Get, Post, Patch, Delete, Query, Req, Res, Body, Param, HttpException, HttpStatus, Inject, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PG_POOL, REDIS } from '../db/db.module';
import { AuthService } from '../auth/auth.service';
import type Redis from 'ioredis';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const COOKIE = 'simha_session';
const OBJECT_STORAGE_BACKEND = process.env.OBJECT_STORAGE_BACKEND || 's3';
const OBJECT_STORAGE_BUCKET = process.env.OBJECT_STORAGE_BUCKET || 'simha-user-files';
const objectStorage = new S3Client({
  endpoint: process.env.OBJECT_STORAGE_ENDPOINT || 'http://minio:9000',
  region: process.env.OBJECT_STORAGE_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY || '',
    secretAccessKey: process.env.OBJECT_STORAGE_SECRET_KEY || '',
  },
});

interface SessionUser {
  id: number;
  email: string;
  role: string;
}

function unauthorized(res: Response) {
  return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Authentication required' });
}

const INGESTION_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/ogg',
  'application/pdf', 'application/json', 'application/zip', 'application/x-7z-compressed',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'text/markdown', 'text/html', 'application/xml', 'text/xml',
  'application/javascript', 'application/x-javascript', 'application/typescript', 'text/css',
]);
const INGESTION_EXT = /\.(jpe?g|png|gif|webp|svg|mp4|webm|mov|mp3|wav|ogg|pdf|json|zip|7z|xls|xlsx|csv|ppt|pptx|txt|md|html?|xml|js|jsx|ts|tsx|css|py|go|rs|java|c|cpp|h|hpp|sh|sql|yaml|yml)$/i;

@Controller('chat/api')
export class ChatController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
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

  @Get('models')
  async models(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT DISTINCT model FROM discovered_models
       WHERE enabled = true AND last_seen > now() - interval '7 days'
       ORDER BY model`,
    );
    return res.json({ models: rows.map((row) => row.model) });
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

  /** DELETE /chats/:id/messages?message_id=N — remove one message (regenerate). */
  @Delete('chats/:id/messages')
  async deleteMessage(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id') chatId: string,
    @Query('message_id') messageId: string,
  ) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const id = Number(messageId || 0);
    if (!id) throw new HttpException({ error: 'message_id is required' }, HttpStatus.BAD_REQUEST);
    const { rowCount } = await this.pool.query(
      `DELETE FROM chat_messages m
       USING chat_history c
       WHERE m.chat_id = c.id AND c.user_id = $1
         AND m.chat_id = $2 AND m.id = $3`,
      [user.id, Number(chatId), id],
    );
    if (!rowCount) throw new HttpException({ error: 'Message not found' }, HttpStatus.NOT_FOUND);
    await this.pool.query(
      `UPDATE chat_history SET updated_at = now() WHERE id = $1 AND user_id = $2`,
      [Number(chatId), user.id],
    );
    return res.json({ ok: true });
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

  // Simha Asset Library: new versioned catalog API. The legacy /library
  // endpoints remain unchanged for existing chat resources.
  @Get('library/catalog')
  async catalog(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const type = String(req.query.type || '').trim();
    const q = String(req.query.q || '').trim();
    const parsedLimit = Number(req.query.limit || 50);
    const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 50, 1), 100);
    const { rows } = await this.pool.query(
      `SELECT id, asset_type, name, slug, description, metadata_json, visibility,
              lifecycle, current_version, tags, usage_count, quality_score,
              elo_rating, created_at, updated_at
       FROM library_assets
       WHERE (owner_user_id = $1 OR visibility IN ('public','unlisted')
              OR EXISTS (SELECT 1 FROM library_asset_permissions p WHERE p.asset_id = library_assets.id AND p.user_id = $1))
         AND ($2 = '' OR asset_type = $2)
         AND ($3 = '' OR search_vector @@ plainto_tsquery('simple', $3)
              OR lower(name) LIKE '%' || lower($3) || '%')
       ORDER BY updated_at DESC LIMIT $4`,
      [user.id, type, q, limit],
    );
    return res.json({ assets: rows });
  }

  @Post('library/catalog')
  async createCatalogAsset(@Req() req: Request, @Res() res: Response, @Body() body: Record<string, unknown>) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const allowed = new Set(['prompt_kit','skill_module','agent_profile','mcp_connector','plugin_package','code_recipe','dataset','tool_definition','template','workflow','knowledge_hub']);
    const assetType = String(body.asset_type || '').trim();
    const name = String(body.name || '').trim();
    if (!allowed.has(assetType) || !name) {
      throw new HttpException({ error: 'asset_type and name are required' }, HttpStatus.BAD_REQUEST);
    }
    const slug = String(body.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 160);
    const description = String(body.description || '').slice(0, 4000);
    const content = body.content_json && typeof body.content_json === 'object' ? body.content_json : { content: String(body.content || '') };
    const metadata = body.metadata_json && typeof body.metadata_json === 'object' ? body.metadata_json : {};
    const tags = Array.isArray(body.tags) ? body.tags.map((x) => String(x).toLowerCase().trim()).filter(Boolean).slice(0, 50) : [];
    const visibility = ['private','team','unlisted','public'].includes(String(body.visibility)) ? String(body.visibility) : 'private';
    const { rows } = await this.pool.query(
      `INSERT INTO library_assets(owner_user_id, asset_type, name, slug, description, content_json, metadata_json, visibility, tags)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
       RETURNING id, asset_type, name, slug, description, metadata_json, visibility, lifecycle, current_version, tags, created_at, updated_at`,
      [user.id, assetType, name, slug, description, JSON.stringify(content), JSON.stringify(metadata), visibility, tags],
    );
    await this.pool.query(
      `INSERT INTO library_asset_versions(asset_id, version, content_json, metadata_json, changelog, created_by)
       VALUES ($1,'1.0.0',$2::jsonb,$3::jsonb,'Initial version',$4)`,
      [rows[0].id, JSON.stringify(content), JSON.stringify(metadata), user.id],
    );
    await this.pool.query(
      `INSERT INTO library_asset_audit(asset_id, actor_user_id, action, after_json) VALUES ($1,$2,'create',$3::jsonb)`,
      [rows[0].id, user.id, JSON.stringify({ asset_type: assetType, name, slug })],
    );
    return res.status(HttpStatus.CREATED).json({ asset: rows[0] });
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

  @Post('uploads')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }))
  async uploadFile(@Req() req: Request, @Res() res: Response, @UploadedFile() file?: Express.Multer.File) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const rateKey = `simha:upload-rate:${user.id}`;
    const count = Number(await this.redis.incr(rateKey));
    if (count === 1) await this.redis.expire(rateKey, 600);
    if (count > 20) throw new HttpException({ error: 'Upload rate limit reached. Try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
    if (!file) throw new HttpException({ error: 'file is required' }, HttpStatus.BAD_REQUEST);
    if (!INGESTION_MIME.has(file.mimetype) && !INGESTION_EXT.test(file.originalname)) {
      throw new HttpException({ error: `Unsupported file type: ${file.mimetype || 'unknown'}` }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    await this.pool.query(`INSERT INTO user_storage_quotas(user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [user.id]);
    const quota = await this.pool.query(
      `UPDATE user_storage_quotas SET used_bytes = used_bytes + $1, updated_at = now()
       WHERE user_id = $2 AND used_bytes + $1 <= quota_bytes
       RETURNING quota_bytes, used_bytes`,
      [file.size, user.id],
    );
    if (!quota.rowCount) throw new HttpException({ error: 'Your storage quota has been reached.' }, HttpStatus.PAYLOAD_TOO_LARGE);
    const id = crypto.randomUUID();
    const storageKey = `users/${user.id}/ingestion/${id}/${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    try {
      if (OBJECT_STORAGE_BACKEND === 's3') {
        await objectStorage.send(new PutObjectCommand({
        Bucket: OBJECT_STORAGE_BUCKET,
        Key: storageKey,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
        Metadata: { 'owner-user-id': String(user.id), 'ingestion-file-id': id },
        ServerSideEncryption: 'AES256',
        }));
      } else {
        const root = process.env.UPLOAD_DIR || '/app/uploads';
        await fs.mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
        await fs.writeFile(path.join(root, storageKey), file.buffer);
      }
    } catch (error) {
      await this.pool.query(`UPDATE user_storage_quotas SET used_bytes = GREATEST(0, used_bytes - $1), updated_at = now() WHERE user_id = $2`, [file.size, user.id]);
      throw error;
    }
    const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
    let options: Record<string, unknown> = { library_access: true, skill_triggers: true, plugin_tools: false, web_search: false };
    if (typeof req.body?.options === 'string') {
      try { const parsed = JSON.parse(req.body.options) as Record<string, unknown>; options = { ...options, ...Object.fromEntries(Object.entries(parsed).filter(([key, value]) => ['library_access', 'skill_triggers', 'plugin_tools', 'web_search'].includes(key) && typeof value === 'boolean')) }; } catch { /* use safe defaults */ }
    }
    const job = await this.pool.query(
      `INSERT INTO file_ingestion_jobs(owner_user_id, options_json) VALUES ($1,$2) RETURNING id,status,created_at`,
      [user.id, JSON.stringify(options)],
    );
    await this.pool.query(
      `INSERT INTO file_ingestion_files(job_id, owner_user_id, original_name, storage_key, mime_type, size_bytes, sha256, metadata_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [job.rows[0].id, user.id, file.originalname.slice(0, 255), storageKey, file.mimetype || 'application/octet-stream', file.size, digest, JSON.stringify({ extension: path.extname(file.originalname).toLowerCase(), storage_backend: OBJECT_STORAGE_BACKEND, storage_bucket: OBJECT_STORAGE_BUCKET })],
    );
    await this.pool.query(
      `UPDATE file_ingestion_files SET storage_backend=$1, storage_bucket=$2 WHERE storage_key=$3`,
      [OBJECT_STORAGE_BACKEND, OBJECT_STORAGE_BACKEND === 's3' ? OBJECT_STORAGE_BUCKET : null, storageKey],
    );
    await this.redis.publish('simha:ingestion', JSON.stringify({ job_id: job.rows[0].id }));
    return res.status(HttpStatus.ACCEPTED).json({ job: job.rows[0], file: { name: file.originalname, mime_type: file.mimetype, size_bytes: file.size, status: 'queued' } });
  }

  @Get('uploads')
  async uploads(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return unauthorized(res);
    const { rows } = await this.pool.query(
      `SELECT j.id, j.status, j.source, j.options_json, j.error_message, j.created_at, j.updated_at,
              COALESCE(json_agg(json_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'status',f.status,'parser',f.parser,'error_message',f.error_message) ORDER BY f.created_at) FILTER (WHERE f.id IS NOT NULL), '[]') AS files
       FROM file_ingestion_jobs j LEFT JOIN file_ingestion_files f ON f.job_id = j.id
       WHERE j.owner_user_id = $1 GROUP BY j.id ORDER BY j.created_at DESC LIMIT 50`,
      [user.id],
    );
    return res.json({ jobs: rows });
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
