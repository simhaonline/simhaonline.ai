// Workbench voices: premade + user-cloned TTS voices.
// Cloning = ElevenLabs Instant Voice Clone via fal (fal-ai/elevenlabs/ivc /
// multilingual). Consent is mandatory: the client must send
// consentConfirmed=true plus the consent text shown to the user; both are
// persisted. Cloned voices are per-user and never shared.
import { Controller, Get, Post, Delete, Param, Body, Req, Res, UseInterceptors, UploadedFile, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

const WORKER_URL = process.env.WORKER_URL || 'http://worker:8001';
const CONSENT_TEXT =
  'I confirm I own this voice or have explicit written permission from its owner to create an AI replica, and I will not use it to impersonate or deceive.';
const FAL_IVC_MODEL = 'fal-ai/elevenlabs/ivc'; // instant voice clone

@Controller('chat/api/v1/voices')
export class VoicesController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private async userId(req: Request): Promise<number | null> {
    const m = (req.headers.cookie || '').match(/simha_session=([^;]+)/);
    if (!m) return null;
    const { createHash } = await import('crypto');
    const tokenHash = createHash('sha256').update(m[1]).digest('hex');
    const { rows } = await this.pool.query(
      `SELECT s.user_id FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`, [tokenHash]);
    return rows.length ? rows[0].user_id as number : null;
  }

  @Get()
  async list(@Req() req: Request, @Res() res: Response) {
    const uid = await this.userId(req);
    if (!uid) return res.status(401).json({ error: 'Login required' });
    const { rows } = await this.pool.query(
      `SELECT id, name, kind, voice_id, provider, created_at FROM user_voices
       WHERE user_id = $1 ORDER BY kind, name`, [uid]);
    return res.status(200).json({
      voices: rows,
      premade: PREMADE_VOICES,
      consent_text: CONSENT_TEXT,
    });
  }

  @Post('clone')
  @UseInterceptors(FileInterceptor('sample', { limits: { fileSize: 20 * 1024 * 1024 } }))
  async clone(
    @Req() req: Request, @Res() res: Response,
    @UploadedFile() sampleFile?: Express.Multer.File,
    @Body() body?: { name?: string; consent_confirmed?: string },
  ) {
    const uid = await this.userId(req);
    if (!uid) return res.status(401).json({ error: 'Login required' });
    const file = sampleFile;
    if (!file || !file.buffer?.length) return res.status(400).json({ error: 'Voice sample file required (wav/mp3/m4a, 10s–120s)' });
    const name = (body?.name || '').trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Voice name required' });
    if (body?.consent_confirmed !== 'true') {
      return res.status(403).json({ error: 'Voice cloning requires the consent confirmation.', consent_text: CONSENT_TEXT });
    }
    const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || ['.wav'])[0].toLowerCase();
    if (!['.wav', '.mp3', '.m4a', '.ogg', '.webm'].includes(ext)) {
      return res.status(415).json({ error: `Unsupported sample format ${ext} — use wav/mp3/m4a/ogg/webm` });
    }

    // forward to fal IVC with the account's fal key (gateway-adjacent call:
    // the worker can't sign fal requests, so CP does this fetch directly
    // using the key held in the accounts table — never exposed to clients)
    const keyRow = await this.pool.query(
      `SELECT api_key FROM accounts WHERE provider = 'fal' LIMIT 1`);
    if (!keyRow.rows.length) return res.status(503).json({ error: 'fal.ai account not configured' });

    const form = new FormData();
    form.append('audio_url', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype || 'audio/wav' }), `sample${ext}`);
    form.append('voice_name', `simha_${uid}_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`);
    const upstream = await fetch(`https://fal.run/${FAL_IVC_MODEL}`, {
      method: 'POST',
      headers: { Authorization: `Key ${keyRow.rows[0].api_key}` },
      body: form,
    }).catch(() => null);
    if (!upstream || !upstream.ok) {
      const detail = upstream ? await upstream.json().catch(() => ({} as { detail?: unknown })) : {};
      const message = typeof (detail as { detail?: unknown }).detail === 'string'
        ? (detail as { detail: string }).detail
        : 'Voice cloning upstream failed — check the fal.ai account status.';
      return res.status(upstream?.status || 502).json({ error: message });
    }
    const data = (await upstream.json()) as { voice_id?: string; custom_voice_id?: string };
    const voiceId = data.voice_id || data.custom_voice_id;
    if (!voiceId) return res.status(502).json({ error: 'Cloning succeeded but no voice id returned' });

    const { rows } = await this.pool.query(
      `INSERT INTO user_voices(user_id, name, provider, voice_id, kind, consent_text, sample_meta)
       VALUES ($1,$2,'elevenlabs',$3,'cloned',$4,$5)
       ON CONFLICT (user_id, name) DO UPDATE SET voice_id = EXCLUDED.voice_id, consented_at = now()
       RETURNING id, name, kind, voice_id, created_at`,
      [uid, name, voiceId, CONSENT_TEXT, JSON.stringify({ bytes: file.size, mime: file.mimetype, model: FAL_IVC_MODEL })],
    );
    await this.pool.query(
      `INSERT INTO audit_log(actor, action, target, detail_json) VALUES ($1,'voice.clone',$2,$3)`,
      [String(uid), name, JSON.stringify({ provider: 'elevenlabs', model: FAL_IVC_MODEL, bytes: file.size })]);
    return res.status(201).json({ voice: rows[0] });
  }

  @Delete(':id')
  async remove(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const uid = await this.userId(req);
    if (!uid) return res.status(401).json({ error: 'Login required' });
    const numeric = Number(id);
    if (!Number.isFinite(numeric)) return res.status(400).json({ error: 'Invalid voice id' });
    const { rowCount } = await this.pool.query(
      `DELETE FROM user_voices WHERE id = $1 AND user_id = $2`, [numeric, uid]);
    if (!rowCount) return res.status(404).json({ error: 'Voice not found' });
    return res.status(200).json({ ok: true });
  }
}

// Curated premade voices (ElevenLabs public voice ids)
const PREMADE = [
  { name: 'Rachel (calm narrative)', voice_id: '21m00Tcm4TlvDq8ikWAM' },
  { name: 'Drew (warm conversational)', voice_id: '29vD33N1CtxCmqQRPOHJ' },
  { name: 'Clyde (gritty narrator)', voice_id: '2EiwWnXFnvU5JabP6886' },
  { name: 'Paul (authoritative)', voice_id: '5Q0t7uMcjvnagumLfvZi' },
  { name: 'Aria (expressive)', voice_id: '9BWtsMINqrJLrRacOk9x' },
  { name: 'Roger (confident)', voice_id: 'CwhRBWXzGAHq8TQ4Fs17' },
  { name: 'Sarah (soft news)', voice_id: 'EXAVITQu4vr4xnSDxMaL' },
  { name: 'Laura ( upbeat social)', voice_id: 'FGY2WhTYpPnrIDTdsKH5' },
  { name: 'Charlie (hypnotic)', voice_id: 'IKne3meq5aSn9XLyUdCD' },
  { name: 'George (stately)', voice_id: 'JBFqnCBsd6RMkjVDRZzb' },
  { name: 'Emily (calm)', voice_id: 'LcfcDJNUP1GQjkzn1xUU' },
  { name: 'Callum (intense)', voice_id: 'N2lVS1w4EtoT3dr4eOWO' },
  { name: 'Patrick (gravitas)', voice_id: 'ODq5zmih8GrVes37Dizd' },
  { name: 'Harry (assertive)', voice_id: 'SAz9YHcvj6GT2YYXdXww' },
  { name: 'Liam (articulate)', voice_id: 'TX3LPaxmHKxFdv7VOQHJ' },
  { name: 'Domi (strong)', voice_id: 'AZnzlk1XvdvUeBnXmlld' },
  { name: 'Elli (emotional)', voice_id: 'MF3mGyEYCl7XYWbV9V6O' },
  { name: 'Josh (deep)', voice_id: 'TxGEqnHWrfWFTfGW9XjX' },
  { name: 'Arnold (crisp)', voice_id: 'VR6AewLTigWG4xSOukaG' },
  { name: 'Adam (deep narration)', voice_id: 'pNInz6obpgDQGcFmaJgB' },
  { name: 'Sam (rasp)', voice_id: 'yoZ06aMxZJJ28mfd3POQ' },
  { name: 'Glinda (warm)', voice_id: 'wViXBPUzp2ZZixB1xQuM' },
  { name: 'Giovanni (deep foreign)', voice_id: 'zcAOhNBS3c14rBihAFp1' },
  { name: 'Mimi (emotional East-Asian)', voice_id: 'zrHiDhphv9ZnVXBqCLjz' },
] as const;
type PremadeVoice = (typeof PREMADE)[number];
const PREMADE_VOICES: PremadeVoice[] = [...PREMADE];