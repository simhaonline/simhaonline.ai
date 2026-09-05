import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClientKeysController } from './client-keys.controller';

@Module({
  controllers: [AuthController, ClientKeysController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}