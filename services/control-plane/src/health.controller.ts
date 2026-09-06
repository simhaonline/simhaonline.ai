import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import type Redis from 'ioredis';
import { PG_POOL, REDIS } from './db/db.module';

@Controller()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool, @Inject(REDIS) private readonly redis: Redis) {}

  @Get('healthz')
  async healthz() {
    await this.pool.query('SELECT 1');
    await this.redis.ping();
    return { status: 'ok', service: 'simha-control-plane', dependencies: { postgres: 'ok', valkey: 'ok' } };
  }
}
