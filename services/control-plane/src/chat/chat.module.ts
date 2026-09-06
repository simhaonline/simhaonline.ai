import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule],
  controllers: [ChatController],
  providers: [RealtimeGateway],
})
export class ChatModule {}
