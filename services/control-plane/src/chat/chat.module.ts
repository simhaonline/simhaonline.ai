import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { WorkbenchV1Controller } from './workbench-v1.controller';
import { WorkbenchStreamController } from './workbench-stream.controller';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule],
  controllers: [ChatController, WorkbenchV1Controller, WorkbenchStreamController],
  providers: [RealtimeGateway],
})
export class ChatModule {}