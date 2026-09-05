import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ChatController],
})
export class ChatModule {}