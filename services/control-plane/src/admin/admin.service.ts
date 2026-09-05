// Admin service: gateway overview aggregation, accounts CRUD, user reports.
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../db/db.module';
import type Redis from 'ioredis';

interface AccountLimits {
  rpm?: number;
  rpd?: number;
  rpw?: number;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async overview() {
    const { rows: accountRows } = await this.pool.query(
      `SELECT name, base_url, api_key, provider, protocol, api_prefix, auth_mode, wildcard, limits_json
       FROM accounts ORDER BY name`,
    );
    const accounts: Array<Record<string, unknown>> = [];
    for (const a of accountRows) {
      const limits = (a.limits_json || {}) as AccountLimits;
      const counts = await this.windowCounts(a.name as string);
      const cooldownUntil = Number(
        (await this.redis.get(`gw:cooldown:${a.name}`)) || 0,
      );
      const ratios: Record<string, { used: number; limit: number | null; percent: number }> = {};
      const map: Array<[string, number | undefined]> = [
        ['minute', limits.rpm],
        ['day', limits.rpd],
        ['week', limits.rpw],
      ];
      for (const [period, limit] of map) {
        const used = counts[period] || 0;
        ratios[period] = {
          used,
          limit: limit ?? null,
          percent: limit && limit > 0 ? Math.round((used / limit) * 1000) / 10 : 0,
        };
      }
      accounts.push({
        name: a.name,
        base_url: a.base_url,
        provider: a.provider,
        protocol: a.protocol,
        api_prefix: a.api_prefix,
        auth_mode: a.auth_mode,
        api_key: a.api_key ? `${String(a.api_key).slice(0, 4)}...${String(a.api_key).slice(-4)}` : 'not configured',
        wildcard: a.wildcard,
        limits: ratios,
        cooldown_until: cooldownUntil,
        limit_window: 'rolling',
        tokens: await this.accountTokens(a.name as string),
      });
    }
    const { rows: modelRows } = await this.pool.query(
      `SELECT DISTINCT model FROM discovered_models ORDER BY model`,
    );
    const models = modelRows.map((r) => r.model as string);
    const { rows: policyRows } = await this.pool.query(
      `SELECT model, max_input_tokens, min_output_tokens, max_output_tokens, max_tool_result_chars, dedupe_system_messages
       FROM model_policies`,
    );
    const policies: Record<string, unknown> = {};
    for (const p of policyRows) policies[p.model] = p;
    const { rows: history } = await this.pool.query(
      `SELECT requested_at AS timestamp, account_name AS account, model, status,
              prompt_tokens, completion_tokens, total_tokens AS tokens
       FROM request_history ORDER BY requested_at DESC LIMIT 100`,
    );
    const modelTokens: Record<string, { prompt: number; completion: number; total: number }> = {};
    const { rows: mtRows } = await this.pool.query(
      `SELECT model,
              SUM(prompt_tokens)::bigint AS prompt,
              SUM(completion_tokens)::bigint AS completion,
              SUM(total_tokens)::bigint AS total
       FROM request_history
       WHERE requested_at > now() - interval '30 days'
       GROUP BY model`,
    );
    for (const r of mtRows) {
      modelTokens[r.model || 'unknown'] = {
        prompt: Number(r.prompt),
        completion: Number(r.completion),
        total: Number(r.total),
      };
    }
    const providerCatalog = require('../../config/provider_catalog.json');
    return {
      accounts,
      models,
      policies,
      model_tokens: modelTokens,
      provider_catalog: providerCatalog,
      storage: { backend: 'postgresql+timescaledb+pgvector', cache: 'valkey' },
      history,
    };
  }

  private async windowCounts(account: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [period, interval] of [
      ['minute', '1 minute'],
      ['day', '1 day'],
      ['week', '7 days'],
    ] as Array<[string, string]>) {
      const { rows } = await this.pool.query(
        `SELECT COUNT(*)::bigint AS n FROM request_history
         WHERE account_name = $1 AND requested_at > now() - ($2::interval)`,
        [account, interval],
      );
      out[period] = Number(rows[0].n);
    }
    return out;
  }

  private async accountTokens(account: string) {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(prompt_tokens),0)::bigint AS prompt,
              COALESCE(SUM(completion_tokens),0)::bigint AS completion,
              COALESCE(SUM(total_tokens),0)::bigint AS total
       FROM request_history WHERE account_name = $1`,
      [account],
    );
    return {
      prompt: Number(rows[0].prompt),
      completion: Number(rows[0].completion),
      total: Number(rows[0].total),
    };
  }

  async addAccount(body: Record<string, unknown>) {
    const name = String(body.name || '').trim();
    if (!name || name.length > 80) throw new Error('name is required (80 chars max)');
    const baseUrl = String(body.base_url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(baseUrl)) throw new Error('base_url must be an http(s) URL');
    const apiKey = body.api_key ? String(body.api_key) : null;
    const provider = String(body.provider || 'custom').toLowerCase();
    const protocol = String(body.protocol || 'openai').toLowerCase();
    const apiPrefix = String(body.api_prefix || '/v1') || '/v1';
    const wildcard = Boolean(body.wildcard);
    const limits = (body.limits || {}) as AccountLimits;
    const { rows } = await this.pool.query(
      `INSERT INTO accounts(name, base_url, api_key, provider, protocol, api_prefix, wildcard, limits_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (name) DO UPDATE SET
         base_url = EXCLUDED.base_url, api_key = COALESCE(EXCLUDED.api_key, accounts.api_key),
         provider = EXCLUDED.provider, protocol = EXCLUDED.protocol,
         api_prefix = EXCLUDED.api_prefix, wildcard = EXCLUDED.wildcard,
         limits_json = EXCLUDED.limits_json, updated_at = now()
       RETURNING name`,
      [name, baseUrl, apiKey, provider, protocol, apiPrefix, wildcard, JSON.stringify(limits)],
    );
    await this.pool.query(
      `INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`,
      ['admin', 'account.upsert', name],
    );
    return rows[0];
  }

  async modifyAccount(name: string, body: Record<string, unknown>) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (body.provider) push('provider', String(body.provider).toLowerCase());
    if (body.protocol) push('protocol', String(body.protocol).toLowerCase());
    if (body.api_key) push('api_key', String(body.api_key));
    if (body.api_prefix) push('api_prefix', String(body.api_prefix));
    if (body.wildcard !== undefined) push('wildcard', Boolean(body.wildcard));
    if (body.limits) push('limits_json', JSON.stringify(body.limits));
    if (body.base_url) push('base_url', String(body.base_url).replace(/\/+$/, ''));
    if (!sets.length) return;
    params.push(name);
    params.push(new Date());
    await this.pool.query(
      `UPDATE accounts SET ${sets.join(', ')}, updated_at = $${params.length} WHERE name = $${params.length - 1}`,
      params,
    );
    await this.pool.query(`INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`, [
      'admin',
      'account.update',
      name,
    ]);
  }

  async removeAccount(name: string) {
    await this.pool.query(`DELETE FROM accounts WHERE name = $1`, [name]);
    await this.pool.query(`INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`, [
      'admin',
      'account.delete',
      name,
    ]);
  }

  async userReports() {
    const { rows: users } = await this.pool.query(`
      SELECT u.id, u.email, u.role, u.active, u.created_at,
             COUNT(r.requested_at)::bigint AS requests,
             COALESCE(SUM(r.prompt_tokens),0)::bigint AS input_tokens,
             COALESCE(SUM(r.completion_tokens),0)::bigint AS output_tokens,
             COALESCE(SUM(r.total_tokens),0)::bigint AS total_tokens,
             MAX(r.requested_at) AS last_request_at
      FROM users u LEFT JOIN request_history r ON r.user_id = u.id
      GROUP BY u.id ORDER BY total_tokens DESC, u.created_at ASC`);
    const { rows: keys } = await this.pool.query(`
      SELECT k.id, k.name, k.key_prefix, k.active, k.created_at, k.last_used_at, k.request_count,
             k.owner_user_id, u.email AS owner_email
      FROM client_api_keys k LEFT JOIN users u ON u.id = k.owner_user_id
      ORDER BY k.created_at DESC`);
    const { rows: audit } = await this.pool.query(
      `SELECT id, created_at, actor, action, target, detail_json FROM audit_log ORDER BY id DESC LIMIT 200`,
    );
    return { users, client_keys: keys, audit_log: audit };
  }

  async listUsers() {
    const { rows } = await this.pool.query(
      `SELECT id, email, role, active, created_at FROM users ORDER BY created_at ASC`,
    );
    return rows;
  }

  async modifyUser(id: number, body: { active?: boolean; role?: string }) {
    if (body.active !== undefined) {
      await this.pool.query(`UPDATE users SET active = $1 WHERE id = $2`, [body.active, id]);
    }
    if (body.role) {
      await this.pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [body.role, id]);
    }
    await this.pool.query(`INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`, [
      'admin',
      'user.update',
      String(id),
    ]);
  }

  async removeUser(id: number) {
    await this.pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    await this.pool.query(`INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`, [
      'admin',
      'user.delete',
      String(id),
    ]);
  }
}