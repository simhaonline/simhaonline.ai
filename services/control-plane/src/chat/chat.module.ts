import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { WorkbenchV1Controller } from './workbench-v1.controller';
import { WorkbenchStreamController } from './workbench-stream.controller';
import { WorkbenchCatalogController } from './workbench-catalog.controller';
import { WorkbenchFeaturesController } from './workbench-features.controller';
import { TranslateController } from './translate-extract.controller';
import { VoicesController } from './voices.controller';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule],
  controllers: [ChatController, WorkbenchV1Controller, WorkbenchStreamController, WorkbenchCatalogController, WorkbenchFeaturesController, TranslateController, VoicesController],
  providers: [RealtimeGateway],
})
export class ChatModule {}