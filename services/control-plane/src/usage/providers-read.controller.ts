// GET /api/v1/providers — provider accounts for the Control Center Models
// page (read-model over the accounts table; secrets never leave the vault —
// only ••••last4 is exposed).
import { Controller, Get, Res, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@Controller('api/v1/providers')
export class ProvidersReadController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async list(@Res() res: Response) {
    const { rows } = await this.pool.query(
      `SELECT a.name, a.provider,
              a.api_key IS NOT NULL AND a.api_key <> '' AS has_key,
              RIGHT(a.api_key, 4) AS key_last4,
              (a.limits_json->>'rpm')::int AS rpm,
              (a.limits_json->>'rpd')::int AS rpd,
              (a.limits_json->>'rpw')::int AS rpw,
              (SELECT COUNT(*)::bigint FROM discovered_models d WHERE d.account_name = a.name AND d.enabled) AS model_count,
              (SELECT COUNT(*)::bigint FROM request_history r
                 WHERE r.account_name = a.name AND r.requested_at > now() - interval '24 hours') AS requests_today
       FROM accounts a
       ORDER BY a.name`);
    return res.json({
      providers: rows.map((r: Record<string, unknown>) => ({
        name: r.name,
        provider: r.provider,
        alias: r.name,
        key_last4: r.has_key ? r.key_last4 : null,
        model_count: Number(r.model_count || 0),
        healthy: true,
        requests_today: Number(r.requests_today || 0),
        strikes: 0,
        enabled: true,
        rpm: r.rpm, rpd: r.rpd, rpw: r.rpw,
      })),
    });
  }
}