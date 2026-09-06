import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { ProvidersReadController } from './providers-read.controller';
import { BenchmarksReadController } from './benchmarks-read.controller';
import { KeysReadController } from './keys-read.controller';

@Module({
  controllers: [UsageController, ProvidersReadController, BenchmarksReadController, KeysReadController],
})
export class UsageModule {}