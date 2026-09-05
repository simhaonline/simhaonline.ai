import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';

export const PG_POOL = 'PG_POOL';
export const REDIS = 'REDIS';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 20,
          idleTimeoutMillis: 30000,
        }),
    },
    {
      provide: REDIS,
      useFactory: () => {
        const url = process.env.VALKEY_URL || 'redis://valkey:6379/1';
        return new Redis(url, { maxRetriesPerRequest: 3 });
      },
    },
  ],
  exports: [PG_POOL, REDIS],
})
export class DbModule {}