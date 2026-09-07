// Public Arena battle API (rate-limited) — powers the blind A/B Leaderboard
// battles page. Completions run through the gateway with an internal client
// key (same bootstrap as the workbench stream); votes are recorded in the
// rank engine (Elo). Battle identity is idempotent via a signed battle_id.
import { Controller, Get, Post, Req, Res, Body, Inject, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import type Redis from 'ioredis';
import crypto from 'crypto';
import { PG_POOL, REDIS } from '../db/db.module';

const RANK_BASE = process.env.RANK_URL || 'http://rank:8114';
const GATEWAY = process.env.GATEWAY_URL || 'http://gateway:8080';
// Blind battle prompt budget + answer cap (keeps battles fast + cheap).
const ARENA_MAX_PROMPT_CHARS = 2000;
const ARENA_MAX_TOKENS = 500;
const ARENA_TIMEOUT_MS = 45_000;

@Controller('arena/api')
export class ArenaController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Internal gateway credential — minted once, shared with the workbench. */
  private async gatewayKey(): Promise<string | null> {
    const { rows } = await this.pool.query(
      `SELECT value FROM app_settings WHERE key = 'workbench_gateway_key'`);
    if (rows.length && rows[0].value) return rows[0].value as string;
    return null; // arena activates after the workbench has bootstrapped a key
  }

  /** IP throttle: 10 battles/hour + 30 votes/hour per IP. */
  private async throttle(req: Request, bucket: string, max: number) {
    const ip = (req.headers['x-forwarded-for'] as string || req.socket.remoteAddress || 'unknown')
      .split(',')[0].trim();
    const key = `arena:rl:${bucket}:${ip}`;
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.expire(key, 3600);
    if (n > max) throw new HttpException(
      { error: 'Too many requests — try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
  }

  private eligible(rows: { model: string }[]): string[] {
    return rows.map((r) => r.model).filter((m) => m && m !== '*');
  }

  // POST /arena/api/battle — run the SAME prompt through two blind models.
  @Post('battle')
  async battle(@Req() req: Request, @Res() res: Response,
      @Body() body: { prompt?: string }) {
    await this.throttle(req, 'battle', 10);
    const prompt = String(body.prompt || '').trim();
    if (prompt.length < 5) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Prompt required (min 5 chars).' });
    }
    if (prompt.length > ARENA_MAX_PROMPT_CHARS) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: `Prompt too long (max ${ARENA_MAX_PROMPT_CHARS} chars).` });
    }
    const key = await this.gatewayKey();
    if (!key) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: 'Arena warming up — no gateway key yet.' });
    }
    // candidate pool: models with recent live traffic first (proven routable),
    // falling back to any enabled discovered model. Rank models are
    // auto-registered (idempotent) so votes can never 404.
    const { rows: hot } = await this.pool.query(
      `SELECT DISTINCT model FROM request_history
       WHERE requested_at > now() - interval '24 hours' AND status < 400
         AND model IS NOT NULL AND model <> ''
       ORDER BY model`);
    let pool = this.eligible(hot);
    if (pool.length < 2) {
      const { rows } = await this.pool.query(
        `SELECT DISTINCT model FROM discovered_models WHERE enabled AND model <> '*' ORDER BY model`);
      pool = this.eligible(rows);
    }
    if (pool.length < 2) {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ error: 'Not enough models available for a battle yet.' });
    }
    const pick = (exclude?: string) => {
      const cand = pool.filter((m) => m !== exclude);
      return cand[Math.floor(Math.random() * cand.length)];
    };
    const modelA = pick();
    const modelB = pick(modelA);
    // ensure both sides exist in the rank engine (POST /models is idempotent)
    await Promise.all([modelA, modelB].map((m) =>
      fetch(`${RANK_BASE}/models`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => null)));

    const ask = async (model: string): Promise<{ ok: boolean; text: string; latency: number }> => {
      const t0 = Date.now();
      try {
        const r = await fetch(`${GATEWAY}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: ARENA_MAX_TOKENS }),
          signal: AbortSignal.timeout(ARENA_TIMEOUT_MS),
        });
        if (!r.ok) return { ok: false, text: '', latency: Date.now() - t0 };
        const data: unknown = await r.json();
        const content = (data as { choices?: Array<{ message?: { content?: string } }> })
          ?.choices?.[0]?.message?.content;
        const text = String(content || '');
        return { ok: text.trim().length > 0, text, latency: Date.now() - t0 };
      } catch { return { ok: false, text: '', latency: Date.now() - t0 }; }
    };

    const [a, b] = await Promise.all([ask(modelA), ask(modelB)]);
    // Both sides must answer or the battle is void (no Elo noise).
    if (!a.ok || !b.ok) {
      return res.status(HttpStatus.BAD_GATEWAY).json({
        error: 'One of the models failed to answer — try again.',
      });
    }
    const battleId = crypto.randomBytes(12).toString('hex');
    // Store the mapping server-side: the client only learns who was who after voting.
    await this.redis.set(`arena:battle:${battleId}`,
      JSON.stringify({ a: modelA, b: modelB, prompt }), 'EX', 3600);
    return res.json({
      battle_id: battleId,
      response_a: { text: a.text, latency_ms: a.latency },
      response_b: { text: b.text, latency_ms: b.latency },
    });
  }

  // POST /arena/api/vote — reveal identities, record the vote in the rank engine.
  @Post('vote')
  async vote(@Req() req: Request, @Res() res: Response,
      @Body() body: { battle_id?: string; winner?: string }) {
    await this.throttle(req, 'vote', 30);
    const battleId = String(body.battle_id || '');
    const winner = String(body.winner || '');
    if (!/^[a-f0-9]{24}$/.test(battleId) || !['a', 'b', 'tie'].includes(winner)) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Invalid battle_id or winner.' });
    }
    const raw = await this.redis.get(`arena:battle:${battleId}`);
    if (!raw) {
      return res.status(HttpStatus.NOT_FOUND).json({ error: 'Battle expired — start a new one.' });
    }
    if (await this.redis.get(`arena:voted:${battleId}`)) {
      return res.status(HttpStatus.CONFLICT).json({ error: 'This battle was already voted.' });
    }
    const parsed = JSON.parse(raw) as { a: string; b: string };
    await this.redis.set(`arena:voted:${battleId}`, '1', 'EX', 3600);

    const r = await fetch(`${RANK_BASE}/battle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_a: parsed.a, model_b: parsed.b, winner, battle_id: battleId }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!r || !r.ok) {
      return res.status(HttpStatus.BAD_GATEWAY).json({ error: 'Could not record the vote.' });
    }
    const elo: unknown = await r.json().catch(() => ({}));
    return res.json({
      ok: true,
      models: { a: parsed.a, b: parsed.b },
      winner,
      leaderboard: (elo as { leaderboard?: unknown }).leaderboard || null,
    });
  }

  // GET /arena/api/leaderboard — public read-only Elo table.
  @Get('leaderboard')
  async leaderboard(@Res() res: Response) {
    const data: unknown = await fetch(`${RANK_BASE}/leaderboard?limit=50`, {
      signal: AbortSignal.timeout(8000),
    }).then((x) => x.json()).catch(() => null);
    if (!data) {
      return res.status(HttpStatus.BAD_GATEWAY).json({ error: 'Leaderboard unavailable.' });
    }
    return res.json(data);
  }
}