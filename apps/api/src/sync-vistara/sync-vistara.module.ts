import { Module } from '@nestjs/common';
import { SyncVistaraService } from './sync-vistara.service';
import { TotemModule } from '../totem/totem.module';

@Module({
  imports: [TotemModule],
  providers: [SyncVistaraService],
  exports: [SyncVistaraService],
})
export class SyncVistaraModule {}
