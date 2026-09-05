// Auth service: password verify (legacy pbkdf2$250k$sha256 format), sessions,
// signup with consent, bootstrap admin, SMTP queue.
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL, REDIS } from '../db/db.module';
import type Redis from 'ioredis';

export interface SessionUser {
  id: number;
  email: string;
  role: string;
}

// legacy-compatible pbkdf2: sha256, 250000 iterations, hex salt + hex hash
export function pbkdf2Hash(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 250000, 32, 'sha256').toString('hex');
}

export function verifyLegacyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const expected = pbkdf2Hash(password, parts[1]);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts[2], 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async verifyPassword(email: string, password: string): Promise<number | null> {
    const em = email.toLowerCase().trim();
    // 5 failed attempts → 15-minute lockout (legacy parity)
    const lockKey = `lockout:${em}`;
    const fails = parseInt((await this.redis.get(lockKey)) || '0', 10);
    if (fails >= 5) {
      const ttl = await this.redis.ttl(lockKey);
      throw Object.assign(new Error('locked'), { lockoutSeconds: Math.max(ttl, 1) });
    }
    const { rows } = await this.pool.query(
      `SELECT id, password_hash, active FROM users WHERE email = $1`,
      [em],
    );
    if (!rows.length || !rows[0].active) {
      await this.recordFail(lockKey);
      return null;
    }
    if (!verifyLegacyPassword(password, rows[0].password_hash)) {
      await this.recordFail(lockKey);
      return null;
    }
    await this.redis.del(lockKey);
    return rows[0].id as number;
  }

  private async recordFail(lockKey: string): Promise<void> {
    const n = await this.redis.incr(lockKey);
    if (n === 1) await this.redis.expire(lockKey, 900);
  }

  async createSession(userId: number): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    const ttlHours = parseInt(process.env.SESSION_TTL_HOURS || '24', 10);
    await this.pool.query(
      `INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' hours')::interval)`,
      [sha256Hex(token), userId, String(ttlHours)],
    );
    return token;
  }

  async sessionUser(token: string | undefined): Promise<SessionUser | null> {
    if (!token) return null;
    const { rows } = await this.pool.query(
      `SELECT u.id, u.email, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
      [sha256Hex(token)],
    );
    return rows.length ? (rows[0] as SessionUser) : null;
  }

  async destroySession(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [sha256Hex(token)]);
  }

  async createUser(
    email: string,
    password: string,
    role: string,
    consent?: Record<string, unknown>,
  ): Promise<number> {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = `pbkdf2$${salt}$${pbkdf2Hash(password, salt)}`;
    // consent is recorded in audit_log (no dedicated legacy table in PG schema;
    // app-level record keeps parity with the legacy consent capture)
    const { rows } = await this.pool.query(
      `INSERT INTO users(email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
      [email.toLowerCase().trim(), hash, role],
    );
    const userId = rows[0].id as number;
    if (consent) {
      await this.pool.query(
        `INSERT INTO audit_log(actor, action, target, detail_json) VALUES ($1, $2, $3, $4)`,
        [email, 'auth.signup', String(userId), JSON.stringify(consent)],
      );
    }
    return userId;
  }

  // bootstrap admin on first boot (legacy db_bootstrap_security)
  async bootstrapAdmin(): Promise<void> {
    const email = (process.env.ADMIN_EMAIL || 'admin@simhaonline.ai').toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';
    const { rows } = await this.pool.query(`SELECT COUNT(*)::int AS n FROM users`);
    if (rows[0].n > 0) return;
    if (!password) {
      console.warn('[auth] users table empty and ADMIN_PASSWORD not set — no admin created');
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = `pbkdf2$${salt}$${pbkdf2Hash(password, salt)}`;
    await this.pool.query(
      `INSERT INTO users(email, password_hash, role) VALUES ($1, $2, 'admin')`,
      [email, hash],
    );
    console.log(`[auth] bootstrap admin created: ${email}`);
  }

  // SMTP email (status subscriptions, signup notifications). Non-blocking.
  async sendEmail(subject: string, recipient: string, text: string): Promise<void> {
    const host = process.env.SMTP_HOST;
    if (!host) return; // SMTP not configured — skip silently like legacy
    // Net-based SMTP is handled by the Python worker queue table for
    // reliability; here we enqueue.
    await this.pool.query(
      `INSERT INTO audit_log(actor, action, target, detail_json) VALUES ($1, $2, $3, $4)`,
      ['system', 'email.queued', recipient, JSON.stringify({ subject, preview: text.slice(0, 120) })],
    );
    await this.redis.publish('simha:email', JSON.stringify({ subject, recipient, text })).catch(() => undefined);
  }
}