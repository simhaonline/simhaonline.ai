// Workbench translator: file-text extraction proxy. The worker owns the
// parsers (pypdf/openpyxl/pptx/docx) and is loopback-only, so the CP forwards
// authenticated uploads to it and relays the extracted text.
import { Controller, Post, Req, Res, UseInterceptors, UploadedFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { PG_POOL } from '../db/db.module';

const WORKER_URL = process.env.WORKER_URL || 'http://worker:8001';

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

@Controller('chat/api/v1/translate')
export class TranslateController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Post('extract')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async extract(@Req() req: Request, @Res() res: Response, @UploadedFile() file?: Express.Multer.File) {
    // session auth — same sessions table + sha256 token-hash as AuthService
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/simha_session=([^;]+)/);
    if (!m) return res.status(401).json({ error: 'Login required' });
    const sess = await this.pool.query(
      `SELECT s.user_id FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
      [sha256Hex(m[1])],
    );
    if (!sess.rows.length) return res.status(401).json({ error: 'Login required' });

    if (!file) return res.status(400).json({ error: 'file required' });

    const upstream = await fetch(`${WORKER_URL}/extract`, {
      method: 'POST',
      body: toMultipart(file.buffer, file.originalname, file.mimetype),
    }).catch(() => null);
    if (!upstream || !upstream.ok) {
      const detail = upstream ? await upstream.json().catch(() => ({} as { detail?: string })) : {};
      const message = (detail as { detail?: string }).detail || 'Extraction failed';
      return res.status(upstream?.status || 502).json({ error: message });
    }
    const data = (await upstream.json()) as { text: string; parser: string; characters: number; name: string };
    // audit trail: who translated what (no content persisted)
    await this.pool.query(
      `INSERT INTO audit_log(actor, action, target, detail_json) VALUES ($1,'translate.extract',$2,$3)`,
      [String(sess.rows[0].user_id), data.name, JSON.stringify({ parser: data.parser, characters: data.characters })],
    );
    return res.status(200).json(data);
  }
}

function toMultipart(buffer: Buffer, filename: string, mime: string | undefined): FormData {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime || 'application/octet-stream' }), filename);
  return form;
}