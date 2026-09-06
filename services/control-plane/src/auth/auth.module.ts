import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClientKeysController } from './client-keys.controller';
import { MfaService } from './mfa.service';

@Module({
  controllers: [AuthController, ClientKeysController],
  providers: [AuthService, MfaService],
  exports: [AuthService, MfaService],
})
export class AuthModule {}