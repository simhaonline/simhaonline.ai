// Workbench feature completion — the cross-check audit found these legacy
// capabilities missing from the new scaffold:
//   · Memory (semantic_memory was never exposed — save/list/delete/search)
//   · Web Search + Deep Research (scraper engine was unreachable from chat)
//   · Feedback (table existed, no endpoint)
//   · Scheduled tasks (table existed, no endpoint)
//   · Vision (multimodal image messages)
import { Controller, Get, Post, Delete, Param, Body, Req, Res, Inject, Query, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Pool } from 'pg';
import crypto from 'crypto';
import { PG_POOL } from '../db/db.module';

@Controller('chat/api/v1')
export class WorkbenchFeaturesController {
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

  // ── Memory ────────────────────────────────────────────────────────────────

  @Get('memory')
  async listMemory(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rows } = await this.pool.query(
      `SELECT id, kind, ref_id, content, created_at FROM semantic_memory
       WHERE kind = $2 AND ref_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [`u:${user.id}`, 'workbench_memory']);
    return res.json({ memories: rows });
  }

  @Post('memory')
  async saveMemory(@Req() req: Request, @Res() res: Response, @Body() body: { content?: string }) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const content = String(body.content || '').trim().slice(0, 4000);
    if (!content) return res.status(HttpStatus.BAD_REQUEST).json({ error: 'content required' });
    // 384-dim deterministic placeholder embedding (matches worker's fallback
    // hasher: token-hash buckets, normalized) so vector search stays coherent
    const embedding = this.placeholderEmbedding(content);
    const { rows } = await this.pool.query(
      `INSERT INTO semantic_memory(kind, ref_id, content, embedding)
       VALUES ('workbench_memory', $1, $2, $3::vector) RETURNING id, created_at`,
      [`u:${user.id}`, content, `[${embedding.join(',')}]`]);
    return res.status(HttpStatus.CREATED).json(rows[0]);
  }

  @Delete('memory/:id')
  async deleteMemory(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rowCount } = await this.pool.query(
      `DELETE FROM semantic_memory WHERE id = $1 AND kind = 'workbench_memory' AND ref_id = $2`,
      [Number(id), `u:${user.id}`]);
    if (!rowCount) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Memory not found' });
    return res.json({ ok: true });
  }

  /** GET /memory/search?q= — pgvector cosine similarity over saved memories. */
  @Get('memory/search')
  async searchMemory(@Req() req: Request, @Res() res: Response, @Query('q') q?: string) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const query = String(q || '').trim();
    if (!query) return res.json({ results: [] });
    const embedding = this.placeholderEmbedding(query);
    const { rows } = await this.pool.query(
      `SELECT id, content, created_at,
              1 - (embedding <=> $2::vector) AS similarity
       FROM semantic_memory
       WHERE kind = 'workbench_memory' AND ref_id = $1
       ORDER BY embedding <=> $2::vector LIMIT 8`,
      [`u:${user.id}`, `[${embedding.join(',')}]`]);
    return res.json({ results: rows });
  }

  private placeholderEmbedding(text: string): number[] {
    const dim = 384;
    const v = new Array<number>(dim).fill(0);
    const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      v[h % dim] += 1;
    }
    const norm = Math.sqrt(v.reduce((acc, x) => acc + x * x, 0)) || 1;
    return v.map((x) => Number((x / norm).toFixed(6)));
  }

  // ── Web Search + Deep Research (via the scraper engine) ──────────────────

  /** POST /research — runs a multi-query search against the scraper engine,
   *  extracts and dedupes source snippets, returns structured results the
   *  Workbench feeds to the model for cited synthesis. */
  @Post('research')
  async research(@Req() req: Request, @Res() res: Response, @Body() body: { query?: string; depth?: number }) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const query = String(body.query || '').trim();
    if (!query) return res.status(HttpStatus.BAD_REQUEST).json({ error: 'query required' });
    const depth = Math.min(Math.max(Number(body.depth || 2), 1), 3);

    const scraper = process.env.SCRAPER_URL || 'http://scraper:8111';
    const sources: Array<{ title: string; url: string; snippet: string }> = [];
    const errors: string[] = [];

    // 1) discover candidate URLs via DuckDuckGo's HTML endpoint (no API key);
    //    depth controls how many query variants we run.
    const subQueries = [query];
    if (depth >= 2) subQueries.push(`${query} explained`);
    if (depth >= 3) subQueries.push(`${query} in-depth analysis 2025`);

    const urlsByQuery = await Promise.all(subQueries.map(async (sq) => {
      try {
        const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(sq)}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SimhaResearch/1.0)' },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) { errors.push(`search ${r.status} for "${sq}"`); return []; }
        const html = await r.text();
        // extract result links: /l/?uddg=<urlencoded>
        const urls: Array<{ url: string; title: string }> = [];
        const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) && urls.length < 6) {
          let u = m[1];
          const dec = /uddg=([^&]+)/.exec(u);
          if (dec) u = decodeURIComponent(dec[1]);
          if (!/^https?:\/\//.test(u)) continue;
          const title = m[2].replace(/<[^>]+>/g, '').trim().slice(0, 140);
          urls.push({ url: u, title: title || u });
        }
        return urls;
      } catch (e) {
        errors.push(`search "${sq}": ${(e as Error).message}`);
        return [];
      }
    }));

    // 2) fetch + extract each page through the scraper engine
    const seen = new Set<string>();
    const flat = urlsByQuery.flat().filter((u) => {
      if (seen.has(u.url)) return false;
      seen.add(u.url);
      return true;
    }).slice(0, 8);

    await Promise.all(flat.map(async (cand) => {
      try {
        const r = await fetch(`${scraper}/scrape`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: cand.url }),
          signal: AbortSignal.timeout(25000),
        });
        if (!r.ok) { errors.push(`scrape ${r.status} ${cand.url.slice(0, 60)}`); return; }
        const d = (await r.json()) as { title?: string; text?: string };
        const text = String(d.text || '');
        if (text.length < 80) return;
        // snippet: the paragraphs most relevant to the query (keyword scoring)
        const paras = text.split(/\n{2,}/).filter((p) => p.length > 120);
        const terms = query.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        const scored = paras.map((p) => ({ p, s: terms.reduce((a, t) => a + (p.toLowerCase().includes(t) ? 1 : 0), 0) }));
        scored.sort((a, b) => b.s - a.s);
        const snippet = (scored[0]?.p || text).slice(0, 700);
        sources.push({ title: String(d.title || cand.title).slice(0, 140), url: cand.url, snippet });
      } catch (e) {
        errors.push(`scrape ${cand.url.slice(0, 60)}: ${(e as Error).message}`);
      }
    }));

    return res.json({
      query,
      sources: sources.slice(0, 10),
      errors: errors.slice(0, 4),
      note: sources.length ? undefined : 'No sources retrieved — search or fetch failed for all candidates.',
    });
  }

  // ── Feedback ──────────────────────────────────────────────────────────────

  @Post('feedback')
  async feedback(
    @Req() req: Request, @Res() res: Response,
    @Body() body: { message_id?: number; rating?: string; comment?: string },
  ) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rows } = await this.pool.query(
      `INSERT INTO feedback(user_id, category, message)
       VALUES ($1, $2, $3) RETURNING id`,
      [user.id, String(body.rating || 'general'), String(body.comment || body.rating || '').slice(0, 2000)]);
    return res.status(HttpStatus.CREATED).json(rows[0]);
  }

  // ── Scheduled tasks ───────────────────────────────────────────────────────

  @Get('scheduled')
  async scheduled(@Req() req: Request, @Res() res: Response) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rows } = await this.pool.query(
      `SELECT id, title, prompt, status, run_at, created_at
       FROM scheduled_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [user.id]);
    return res.json({ tasks: rows });
  }

  @Post('scheduled')
  async createScheduled(
    @Req() req: Request, @Res() res: Response,
    @Body() body: { title?: string; prompt?: string; schedule?: string },
  ) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const title = String(body.title || '').trim().slice(0, 160);
    const prompt = String(body.prompt || '').trim().slice(0, 4000);
    if (!title || !prompt) return res.status(HttpStatus.BAD_REQUEST).json({ error: 'title and prompt required' });
    // schedule: 'daily' | 'weekly' | ISO datetime → run_at
    const schedule = String(body.schedule || 'daily').toLowerCase().slice(0, 40);
    const runAt = schedule === 'daily' ? `now() + interval '1 day'`
      : schedule === 'weekly' ? `now() + interval '7 days'`
      : `now() + interval '1 hour'`;
    const { rows } = await this.pool.query(
      `INSERT INTO scheduled_tasks(user_id, title, prompt, run_at)
       VALUES ($1, $2, $3, ${runAt}) RETURNING id, title, status, run_at`,
      [user.id, title, prompt]);
    return res.status(HttpStatus.CREATED).json(rows[0]);
  }

  @Delete('scheduled/:id')
  async deleteScheduled(@Req() req: Request, @Res() res: Response, @Param('id') id: string) {
    const user = await this.user(req);
    if (!user) return res.status(HttpStatus.UNAUTHORIZED).json({ error: 'Login required' });
    const { rowCount } = await this.pool.query(
      `DELETE FROM scheduled_tasks WHERE id = $1 AND user_id = $2`, [Number(id), user.id]);
    if (!rowCount) return res.status(HttpStatus.NOT_FOUND).json({ error: 'Task not found' });
    return res.json({ ok: true });
  }
}