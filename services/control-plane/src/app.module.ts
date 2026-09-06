import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { ChatModule } from './chat/chat.module';
import { BffModule } from './bff/bff.module';
import { BillingModule } from './billing/billing.module';
import { UsageModule } from './usage/usage.module';
import { HealthController } from './health.controller';
import { InternalOauthController } from './oauth/internal-oauth.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [() => process.env] }),
    DbModule,
    AuthModule,
    AdminModule,
    ChatModule,
    BffModule,
    BillingModule,
    UsageModule,
  ],
  controllers: [HealthController, InternalOauthController],
})
export class AppModule {}