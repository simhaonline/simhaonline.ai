import { Module } from '@nestjs/common';
import { BffInternalController } from './bff-internal.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [BffInternalController],
})
export class BffModule {}