// Internal OAuth token broker: the Go gateway asks for a valid upstream
// access token; this controller reads the encrypted credential, refreshes via
// the provider token endpoint if needed, and returns the access token only to
// the internal gateway (never to browsers).
import { Controller, Post, Body, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL } from '../db/db.module';

interface EncryptedParts {
  enc: Buffer | null;
  nonce: Buffer | null;
  tag: Buffer | null;
}

function key(): Buffer | null {
  const hex = (process.env.OAUTH_ENCRYPTION_KEY || '').trim();
  if (!hex) return null;
  return Buffer.from(hex, 'hex');
}

// AES-256-GCM decrypt (legacy format: nonce || ciphertext, tag separate)
function decrypt(enc: Buffer | null, nonce: Buffer | null, tag: Buffer | null, k: Buffer): string | null {
  if (!enc || !nonce || !tag) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', k, nonce);
    decipher.setAuthTag(tag);
    const out = Buffer.concat([decipher.update(enc), decipher.final()]);
    return out.toString('utf8');
  } catch {
    return null;
  }
}

@Controller('internal/oauth')
export class InternalOauthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Post('token')
  async token(
    @Res() res: Response,
    @Body() body: { account?: string },
  ) {
    const account = String(body.account || '');
    if (!account) return res.status(HttpStatus.BAD_REQUEST).json({ error: 'account required' });
    const { rows } = await this.pool.query(
      `SELECT access_token_enc, access_token_nonce, access_token_tag,
              refresh_token_enc, refresh_token_nonce, refresh_token_tag,
              expires_at, provider_config_id, reauthentication_required
       FROM oauth_credentials WHERE account_name = $1`,
      [account],
    );
    if (!rows.length) return res.status(HttpStatus.NOT_FOUND).json({ error: 'no credential' });
    const cred = rows[0];
    const k = key();
    if (!k) return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: 'encryption key not configured' });

    const accessToken = decrypt(
      cred.access_token_enc, cred.access_token_nonce, cred.access_token_tag, k,
    );
    const refreshToken = decrypt(
      cred.refresh_token_enc, cred.refresh_token_nonce, cred.refresh_token_tag, k,
    );

    // valid cached token?
    if (accessToken && cred.expires_at && new Date(cred.expires_at).getTime() > Date.now() + 60000) {
      return res.json({ access_token: accessToken });
    }
    if (accessToken && !refreshToken) {
      return res.json({ access_token: accessToken });
    }
    if (!refreshToken) {
      return accessToken
        ? res.json({ access_token: accessToken })
        : res.status(HttpStatus.NOT_FOUND).json({ error: 'no refresh path' });
    }
    if (cred.reauthentication_required) {
      return res.status(HttpStatus.CONFLICT).json({ error: 'reauthentication required' });
    }

    // refresh via provider config
    const { rows: cfgRows } = await this.pool.query(
      `SELECT client_secret_enc, client_secret_nonce, client_secret_tag, client_id, token_url
       FROM oauth_provider_configs WHERE id = $1`,
      [cred.provider_config_id],
    );
    if (!cfgRows.length) return res.status(HttpStatus.NOT_FOUND).json({ error: 'no provider config' });
    const cfg = cfgRows[0];
    const clientSecret = decrypt(cfg.client_secret_enc, cfg.client_secret_nonce, cfg.client_secret_tag, k);

    const form = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: String(cfg.client_id),
    });
    if (clientSecret) form.set('client_secret', clientSecret);

    try {
      const r = await fetch(String(cfg.token_url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
      if (!r.ok) throw new Error(`token endpoint ${r.status}`);
      const doc = (await r.json()) as Record<string, unknown>;
      if (!doc.access_token) throw new Error('no access_token in response');
      const newRefresh = (doc.refresh_token as string) || refreshToken;
      const expiresIn = Number(doc.expires_in || 3600);
      await this.persist(account, String(cfg.token_url), cfg, doc.access_token as string, newRefresh, expiresIn, k);
      return res.json({ access_token: doc.access_token });
    } catch {
      await this.pool.query(
        `UPDATE oauth_credentials SET reauthentication_required = true, updated_at = now()
         WHERE account_name = $1`,
        [account],
      );
      return res.status(HttpStatus.CONFLICT).json({ error: 'refresh failed' });
    }
  }

  private async persist(
    account: string,
    _tokenUrl: string,
    cfg: Record<string, unknown>,
    access: string,
    refresh: string,
    expiresIn: number,
    k: Buffer,
  ) {
    const enc = (val: string): EncryptedParts => {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', k, nonce);
      const data = Buffer.concat([cipher.update(val, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      // legacy layout: ciphertext WITHOUT tag appended, tag stored separately
      return { enc: data, nonce, tag };
    };
    const a = enc(access);
    const r = enc(refresh);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    await this.pool.query(
      `UPDATE oauth_credentials
       SET access_token_enc = $1, access_token_nonce = $2, access_token_tag = $3,
           refresh_token_enc = $4, refresh_token_nonce = $5, refresh_token_tag = $6,
           expires_at = $7, reauthentication_required = false, updated_at = now()
       WHERE account_name = $8`,
      [a.enc, a.nonce, a.tag, r.enc, r.nonce, r.tag, expiresAt, account],
    );
    void cfg;
  }
}