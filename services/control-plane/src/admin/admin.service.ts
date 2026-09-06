// Admin service: gateway overview aggregation, accounts CRUD, user reports.
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL, REDIS } from '../db/db.module';
import type Redis from 'ioredis';
import crypto from 'crypto';
import { pbkdf2Hash } from '../auth/auth.service';

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

  private triggerModelRefresh() {
    const gateway = process.env.GATEWAY_URL || 'http://gateway:8080';
    void fetch(`${gateway}/internal/refresh-models`, { method: 'POST' }).catch(() => undefined);
  }

  async overview() {
    const { rows: accountRows } = await this.pool.query(
      `SELECT name, base_url, api_key, provider, protocol, api_prefix, auth_mode,
              oauth_token_file, oauth_token_url, oauth_client_id, oauth_client_secret,
              wildcard, limits_json
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
        oauth_token_file: Boolean(a.oauth_token_file),
        oauth_token_url: Boolean(a.oauth_token_url),
        oauth_client_id: Boolean(a.oauth_client_id),
        oauth_client_secret: Boolean(a.oauth_client_secret),
        api_key: a.api_key ? `${String(a.api_key).slice(0, 4)}...${String(a.api_key).slice(-4)}` : 'not configured',
        wildcard: a.wildcard,
        limits: ratios,
        cooldown_until: cooldownUntil,
        limit_window: 'rolling',
        tokens: await this.accountTokens(a.name as string),
      });
    }
    const { rows: modelRows } = await this.pool.query(
      `SELECT DISTINCT model FROM discovered_models WHERE enabled = true ORDER BY model`,
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
    // catalog ships with the gateway image via /config volume mount; read from
    // the mounted path (env-overridable) instead of a compiled-in require.
    let providerCatalog: unknown = {};
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      providerCatalog = require(process.env.PROVIDER_CATALOG_FILE || '/config/provider_catalog.json');
    } catch {
      providerCatalog = {};
    }
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
    const authMode = body.auth_mode === 'oauth2' ? 'oauth2' : 'api_key';
    const oauthTokenFile = body.oauth_token_file ? String(body.oauth_token_file).trim() : null;
    const oauthTokenUrl = body.oauth_token_url ? String(body.oauth_token_url).trim() : null;
    const oauthClientId = body.oauth_client_id ? String(body.oauth_client_id).trim() : null;
    const oauthClientSecret = body.oauth_client_secret ? String(body.oauth_client_secret) : null;
    const wildcard = Boolean(body.wildcard);
    const limits = (body.limits || {}) as AccountLimits;
    const { rows } = await this.pool.query(
      `INSERT INTO accounts(name, base_url, api_key, provider, protocol, api_prefix, auth_mode, oauth_token_file, oauth_token_url, oauth_client_id, oauth_client_secret, wildcard, limits_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (name) DO UPDATE SET
         base_url = EXCLUDED.base_url, api_key = COALESCE(EXCLUDED.api_key, accounts.api_key),
         provider = EXCLUDED.provider, protocol = EXCLUDED.protocol,
         api_prefix = EXCLUDED.api_prefix, auth_mode = EXCLUDED.auth_mode,
         oauth_token_file = COALESCE(EXCLUDED.oauth_token_file, accounts.oauth_token_file),
         oauth_token_url = COALESCE(EXCLUDED.oauth_token_url, accounts.oauth_token_url),
         oauth_client_id = COALESCE(EXCLUDED.oauth_client_id, accounts.oauth_client_id),
         oauth_client_secret = COALESCE(EXCLUDED.oauth_client_secret, accounts.oauth_client_secret),
         wildcard = EXCLUDED.wildcard, limits_json = EXCLUDED.limits_json, updated_at = now()
       RETURNING name`,
      [name, baseUrl, apiKey, provider, protocol, apiPrefix, authMode, oauthTokenFile, oauthTokenUrl, oauthClientId, oauthClientSecret, wildcard, JSON.stringify(limits)],
    );
    await this.pool.query(
      `INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`,
      ['admin', 'account.upsert', name],
    );
    this.triggerModelRefresh();
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
    if (body.auth_mode) push('auth_mode', body.auth_mode === 'oauth2' ? 'oauth2' : 'api_key');
    // Empty values from the masked edit form mean "keep the server value".
    if (body.oauth_token_file) push('oauth_token_file', String(body.oauth_token_file).trim());
    if (body.oauth_token_url) push('oauth_token_url', String(body.oauth_token_url).trim());
    if (body.oauth_client_id) push('oauth_client_id', String(body.oauth_client_id).trim());
    if (body.oauth_client_secret) push('oauth_client_secret', String(body.oauth_client_secret));
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
    this.triggerModelRefresh();
  }

  async removeAccount(name: string) {
    await this.pool.query(`DELETE FROM accounts WHERE name = $1`, [name]);
    // Remove the account's model ownership immediately; the next discovery
    // pass will rebuild the shared catalog from the remaining accounts.
    await this.pool.query(`DELETE FROM discovered_models WHERE account_name = $1`, [name]);
    await this.pool.query(`INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`, [
      'admin',
      'account.delete',
      name,
    ]);
    this.triggerModelRefresh();
  }

  async providerModels() {
    const { rows } = await this.pool.query(
      `SELECT d.account_name, a.provider, a.protocol, d.model, d.enabled, d.last_seen
       FROM discovered_models d JOIN accounts a ON a.name = d.account_name
       ORDER BY d.account_name, d.model`,
    );
    return rows;
  }

  async orchestrationCapabilities() {
    const { rows } = await this.pool.query(
      `SELECT slug, display_name, input_modalities, output_modalities,
              architecture_families, requirements_json, enabled, updated_at
       FROM task_capabilities WHERE enabled = true ORDER BY display_name`,
    );
    return rows;
  }

  async benchmarks(filters: { q?: string; open_weights?: boolean; organization?: string }) {
    await this.pool.query(`
      INSERT INTO benchmark_models(model)
      SELECT DISTINCT model FROM discovered_models WHERE model IS NOT NULL
      ON CONFLICT (model) DO NOTHING`);
    const q = String(filters.q || '').trim();
    const open = filters.open_weights === true;
    const org = String(filters.organization || '').trim();
    const { rows } = await this.pool.query(`
      SELECT bm.model, bm.organization, bm.open_weights, bm.context_window, bm.modalities,
             bm.specifications_json, bm.updated_at,
             MAX(bs.score) FILTER (WHERE bs.category = 'overall') AS overall_score,
             MAX(bs.score) FILTER (WHERE bs.category = 'reasoning') AS reasoning_score,
             MAX(bs.score) FILTER (WHERE bs.category = 'coding') AS coding_score,
             MAX(bs.score) FILTER (WHERE bs.category = 'agentic_coding') AS agentic_coding_score,
             MAX(bs.score) FILTER (WHERE bs.category = 'mathematics') AS mathematics_score,
             MAX(bs.score) FILTER (WHERE bs.category = 'data_analysis') AS data_analysis_score,
             MAX(bs.score) FILTER (WHERE bs.category = 'language') AS language_score,
             MAX(bs.score) FILTER (WHERE bs.category = 'instruction_following') AS instruction_following_score,
             COALESCE(t.llm_calls, 0)::bigint AS llm_calls,
             COALESCE(t.errored_traces, 0)::bigint AS errored_traces,
             t.p50_latency_ms,
             t.hallucination_rate,
             t.deployment_runs,
             t.average_feedback_score
      FROM benchmark_models bm
      LEFT JOIN benchmark_scores bs ON bs.model = bm.model
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::bigint AS llm_calls,
               COUNT(*) FILTER (WHERE status >= 400)::bigint AS errored_traces,
               NULL::numeric AS p50_latency_ms,
               NULL::numeric AS hallucination_rate,
               NULL::bigint AS deployment_runs,
               NULL::numeric AS average_feedback_score
        FROM request_history rh WHERE rh.model = bm.model
      ) t ON TRUE
      WHERE bm.enabled = TRUE
        AND ($1 = '' OR lower(bm.model) LIKE '%' || lower($1) || '%')
        AND ($2 = FALSE OR bm.open_weights = TRUE)
        AND ($3 = '' OR lower(bm.organization) = lower($3))
      GROUP BY bm.model, bm.organization, bm.open_weights, bm.context_window, bm.modalities, bm.specifications_json, bm.updated_at,
               t.llm_calls, t.errored_traces, t.p50_latency_ms, t.hallucination_rate, t.deployment_runs, t.average_feedback_score
      ORDER BY overall_score DESC NULLS LAST, bm.model`, [q, open, org]);
    return { categories: ['overall','reasoning','coding','agentic_coding','mathematics','data_analysis','language','instruction_following'], models: rows, data_quality: { unmeasured_scores_are_null: true, p50_latency_source: 'not_recorded_in_request_history', hallucination_source: 'not_recorded' } };
  }

  async setProviderModel(body: Record<string, unknown>) {
    const account = String(body.account_name || '').trim();
    const model = String(body.model || '').trim();
    if (!account || !model) throw new Error('account_name and model are required');
    const enabled = Boolean(body.enabled);
    const { rowCount } = await this.pool.query(
      `UPDATE discovered_models SET enabled = $1 WHERE account_name = $2 AND model = $3`,
      [enabled, account, model],
    );
    if (!rowCount) throw new Error('Provider model not found');
    await this.pool.query(`INSERT INTO audit_log(actor, action, target, detail_json) VALUES ($1,$2,$3,$4)`, [
      'admin', 'provider-model.toggle', `${account}:${model}`, JSON.stringify({ enabled }),
    ]);
    this.triggerModelRefresh();
    return { ok: true, account_name: account, model, enabled };
  }

  async testAccount(name: string) {
    const { rows } = await this.pool.query(
      `SELECT name, base_url, api_key, provider, protocol, api_prefix, auth_mode, limits_json
       FROM accounts WHERE name = $1`,
      [name],
    );
    const account = rows[0];
    if (!account) throw new Error('Provider account not found');
    const falAccount = String(account.provider).toLowerCase() === 'fal' || /(^|\.)api\.fal\.ai$/i.test(new URL(String(account.base_url)).hostname) || /(^|\.)fal\.run$/i.test(new URL(String(account.base_url)).hostname);
    const configuredLimits = (account.limits_json || {}) as { rpm?: number; rpd?: number; rpw?: number };
    const { rows: usageRows } = await this.pool.query(
      `SELECT COUNT(*) FILTER (WHERE requested_at > now() - interval '1 minute')::bigint AS minute,
              COUNT(*) FILTER (WHERE requested_at > now() - interval '1 day')::bigint AS day,
              COUNT(*) FILTER (WHERE requested_at > now() - interval '7 days')::bigint AS week
       FROM request_history WHERE account_name = $1`,
      [name],
    );
    const usage = usageRows[0] || {};
    const limits = {
      minute: { used: Number(usage.minute || 0), limit: Number(configuredLimits.rpm || 0) || null },
      day: { used: Number(usage.day || 0), limit: Number(configuredLimits.rpd || 0) || null },
      week: { used: Number(usage.week || 0), limit: Number(configuredLimits.rpw || 0) || null },
    } as Record<string, { used: number; limit: number | null }>;
    const limitState = Object.fromEntries(Object.entries(limits).map(([period, value]) => [period, {
      ...value,
      percent: value.limit ? Math.round((value.used / value.limit) * 1000) / 10 : 0,
      blocked: Boolean(value.limit && value.used >= value.limit * 0.9),
    }]));
    const exhausted = Object.entries(limitState).find(([, value]) => value.blocked);
    if (account.auth_mode === 'oauth2' && !account.api_key) {
      return {
        ok: false,
        connection_ok: false,
        limits_ok: !exhausted,
        account: name,
        status: 'oauth_pending',
        limits: limitState,
        message: 'OAuth account is saved. Configure a server token file before testing connectivity.',
      };
    }
    const prefix = String(account.api_prefix || '/v1').replace(/^\/+|\/+$/g, '');
    const path = account.protocol === 'ollama' || account.provider === 'ollama' ? 'api/tags' : `${prefix}/models`;
    let baseUrl = String(account.base_url).replace(/\/+$/, '');
    if (falAccount) {
      baseUrl = 'https://api.fal.ai';
    }
    // Hugging Face's legacy api-inference host does not expose the OpenAI
    // compatible model catalog. Preserve older saved accounts by checking the
    // current Inference Providers router instead.
    if (String(account.provider).toLowerCase() === 'huggingface' && baseUrl.toLowerCase().includes('api-inference.huggingface.co')) {
      baseUrl = 'https://router.huggingface.co';
    }
    const url = `${baseUrl}/${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (account.api_key) {
      if (falAccount) {
        headers.Authorization = `Key ${account.api_key}`;
      } else if (account.protocol === 'anthropic') {
        headers['x-api-key'] = account.api_key;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.Authorization = `Bearer ${account.api_key}`;
      }
    }
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
      const raw = await response.text();
      const remainingRaw = response.headers.get('x-ratelimit-remaining-requests') || response.headers.get('x-ratelimit-remaining') || response.headers.get('ratelimit-remaining');
      const remaining = remainingRaw === null ? null : Number.parseInt(remainingRaw, 10);
      const upstreamQuota = response.status === 429 || remaining === 0 ? 'exhausted' : remaining !== null && remaining > 0 ? 'available' : 'unknown';
      let modelCount = 0;
      try {
        const parsed = JSON.parse(raw) as { data?: unknown[]; models?: unknown[] };
        modelCount = Array.isArray(parsed.data) ? parsed.data.length : Array.isArray(parsed.models) ? parsed.models.length : 0;
      } catch {
        // The status still tells the operator whether the endpoint is reachable.
      }
      const connectionOk = response.ok;
      const limitsOk = !exhausted;
      const quotaOk = upstreamQuota !== 'exhausted';
      return {
        ok: connectionOk && limitsOk && quotaOk,
        connection_ok: connectionOk,
        limits_ok: limitsOk,
        upstream_quota: upstreamQuota,
        upstream_remaining: remaining,
        account: name,
        status: !connectionOk ? 'rejected' : !limitsOk ? 'local_limit_reached' : !quotaOk ? 'upstream_limit_reached' : 'verified',
        http_status: response.status,
        latency_ms: Date.now() - started,
        model_count: modelCount,
        limits: limitState,
        message: !connectionOk ? `Provider returned HTTP ${response.status}.` : !limitsOk ? `${exhausted[0]} Simha limit reached; routing will exclude this upstream.` : !quotaOk ? 'Provider reported no remaining quota; routing will exclude this upstream.' : upstreamQuota === 'unknown' ? 'Provider API responded, but its upstream quota is not reported by this endpoint.' : 'Provider API responded and reported remaining quota.',
      };
    } catch (err: unknown) {
      const message = (err as Error).name === 'AbortError' ? 'Provider test timed out after 10 seconds.' : 'Provider endpoint could not be reached.';
      return { ok: false, account: name, status: 'unreachable', latency_ms: Date.now() - started, message };
    } finally {
      clearTimeout(timeout);
    }
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

  async modifyUser(id: number, body: { active?: boolean; role?: string; password?: string }) {
    if (body.active !== undefined) {
      await this.pool.query(`UPDATE users SET active = $1 WHERE id = $2`, [body.active, id]);
    }
    if (body.role) {
      await this.pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [body.role, id]);
    }
    if (body.password) {
      if (body.password.length < 10) throw new Error('Password must contain at least 10 characters');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = `pbkdf2$${salt}$${pbkdf2Hash(body.password, salt)}`;
      await this.pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, id]);
    }
    await this.pool.query(`INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`, [
      'admin',
      'user.update',
      String(id),
    ]);
  }

  async removeUser(id: number) {
    // A deleted user's keys must not become unowned active credentials. The
    // FK intentionally uses SET NULL so history remains intact, so revoke
    // them explicitly before deleting the user.
    await this.pool.query(`UPDATE client_api_keys SET active = FALSE WHERE owner_user_id = $1`, [id]);
    await this.pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    await this.pool.query(`INSERT INTO audit_log(actor, action, target) VALUES ($1,$2,$3)`, [
      'admin',
      'user.delete',
      String(id),
    ]);
  }
}
