import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { JudgeAdminController } from './judge-admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AdminController, JudgeAdminController],
  providers: [AdminService],
})
export class AdminModule {}