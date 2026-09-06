import { Module } from '@nestjs/common';
import { UsageController } from './usage.controller';
import { ProvidersReadController } from './providers-read.controller';
import { BenchmarksReadController } from './benchmarks-read.controller';
import { KeysReadController } from './keys-read.controller';
import { WorkspaceController } from './workspace.controller';

@Module({
  controllers: [UsageController, ProvidersReadController, BenchmarksReadController, KeysReadController, WorkspaceController],
})
export class UsageModule {}