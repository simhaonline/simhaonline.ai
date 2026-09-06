// POST /chat/api/v1/chat/completions — Workbench streaming endpoint.
// Relays the gateway's OpenAI-compatible SSE stream to the browser while
// persisting user + assistant messages. Auth: workbench session cookie.
// Gateway auth: an internal bootstrap key minted (once) from the admin's
// first client key is stored in app_settings['workbench_gateway_key'].
import { Controller, Post, Req, Res, Body, Inject, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL } from '../db/db.module';
import { pickModelForMode, MODES, type WorkbenchMode } from './workbench-modes';

@Controller('chat/api/v1/chat')
export class WorkbenchStreamController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Internal gateway credential: an actual client API key (raw value),
   *  stored encrypted-at-rest by DB policy; minted once if absent. */
  private async gatewayKey(): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT value FROM app_settings WHERE key = 'workbench_gateway_key'`);
    if (rows.length && rows[0].value) return rows[0].value as string;
    // mint a new key with the same shape as the keys controller
    const raw = `sek_wb_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(raw).digest('hex');
    const prefix = raw.slice(0, 12);
    const admin = await this.pool.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
    await this.pool.query(
      `INSERT INTO client_api_keys(name, key_hash, key_prefix, active, owner_user_id)
       VALUES ('workbench-internal', $1, $2, TRUE, $3)`,
      [keyHash, prefix, admin.rows[0]?.id ?? null]);
    await this.pool.query(
      `INSERT INTO app_settings(key, value) VALUES ('workbench_gateway_key', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`, [raw]);
    return raw;
  }

  @Post('completions')
  async completions(
    @Req() req: Request, @Res() res: Response,
    @Body() body: {
   conversation_id?: number;
   model?: string;
   messages?: Array<{ role: string; content: string }>;
   stream?: boolean;
   output_modality?: string;
   mode?: string;
   aspect_ratio?: string;
   duration_seconds?: number;
 },
  ) {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)simha_session=([^;]*)/);
    if (!m) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const hash = crypto.createHash('sha256').update(decodeURIComponent(m[1])).digest('hex');
    const { rows: sess } = await this.pool.query(
      `SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [hash]);
    if (!sess.length) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const userId = sess[0].user_id as number;

    // standalone translator (DeepL-style pane) runs without a conversation —
    // no persistence, just a pure translation round-trip.
    const conversationId = Number(body.conversation_id || 0);
    if (conversationId) {
      const own = await this.pool.query(
        `SELECT id FROM chat_history WHERE id = $1 AND user_id = $2`, [conversationId, userId]);
      if (!own.rows.length) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Conversation not found' });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((x) => x.role === 'user');
    if (lastUser && conversationId) {
      await this.pool.query(
        `INSERT INTO chat_messages(chat_id, role, content, model) VALUES ($1, 'user', $2, $3)`,
        [conversationId, lastUser.content, body.model || 'auto']);
    }

    const gatewayKey = await this.gatewayKey();
    if (!gatewayKey) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: 'No gateway key available' });
    }

    const gateway = `${process.env.GATEWAY_URL || 'http://gateway:8080'}/v1/chat/completions`;
    const started = Date.now();
    let content = '';
    let completionTokens = 0;

    // mode router: media modes pick a capability model; task modes (translate/
    // code/vision) set the gateway task header so routing respects capability.
    const mode = (String(body.mode || '').toLowerCase() || 'chat') as WorkbenchMode;
    const spec = MODES[mode] || MODES.chat;
    const mediaMode = String(body.output_modality || '').toLowerCase();
    const effectiveMode = (['image', 'video', 'audio'].includes(mediaMode)
      ? mediaMode : mode) as WorkbenchMode;
    const isMedia = ['image', 'video', 'audio'].includes(effectiveMode);

    let model = String(body.model || 'auto');
    // media modes: pin a capability model (fal flux/veo, openai image/sora).
    // task modes: leave 'auto' — the gateway's SelectModel respects the task
    // header (X-Simha-Task) and picks the best ELO-scored capable model.
    if (model === 'auto' && isMedia) {
      const picked = await pickModelForMode(this.pool, effectiveMode);
      if (picked) model = picked.model;
    }
    if (model === 'auto') model = '';

    const upstream = await fetch(gateway, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${gatewayKey}`,
        'X-Simha-Task': spec.taskSlug,
        ...(spec.outputModality ? { 'X-Simha-Output-Modality': spec.outputModality } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        stream: !isMedia,
        ...(isMedia ? { output_modality: effectiveMode } : {}),
        ...(body.aspect_ratio ? { aspect_ratio: body.aspect_ratio } : {}),
        ...(body.duration_seconds ? { duration_seconds: body.duration_seconds } : {}),
      }),
    });
    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.json().catch(() => ({}));
      return res.status(upstream.status || 502).json(detail);
    }

    const finalize = async () => {
      if (!content.trim() || !conversationId) return;
      const { rows } = await this.pool.query(
        `INSERT INTO chat_messages(chat_id, role, content, model, tokens)
         VALUES ($1, 'assistant', $2, $3, $4) RETURNING id`,
        [conversationId, content, body.model || 'auto', completionTokens]);
      await this.pool.query(
        `INSERT INTO audit_log(actor, action, target, detail_json)
         VALUES ($1, 'chat.assistant_message', $2, $3)`,
        ['workbench', String(rows[0].id), JSON.stringify({ latency_ms: Date.now() - started, tokens: completionTokens })]);
      await this.pool.query(
        `UPDATE chat_history SET updated_at = now() WHERE id = $1`, [conversationId]);
    };

    // media path: the gateway's fal adapter returns a plain chat completion
    // (no SSE). Extract the markdown-wrapped media URL, persist it, and
    // hand the browser a one-shot SSE payload so the client code is uniform.
    if (isMedia) {
      const done = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { completion_tokens?: number };
      };
      content = done.choices?.[0]?.message?.content || '';
      completionTokens = done.usage?.completion_tokens || 0;
      await finalize();
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const payload = t.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: { completion_tokens?: number };
            };
            if (j.usage?.completion_tokens) completionTokens = j.usage.completion_tokens;
            const delta = j.choices?.[0]?.delta?.content;
            if (delta) content += delta;
          } catch { /* partial json */ }
        }
        res.write(chunk);
      }
      await finalize();
      res.write('data: [DONE]\n\n');
      res.end();
    } catch {
      await finalize();
      res.end();
    }
  }
}