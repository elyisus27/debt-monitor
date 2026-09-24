import { Module } from '@nestjs/common';
import { SyncVistaraService } from './sync-vistara.service';

@Module({
  providers: [SyncVistaraService],
  exports: [SyncVistaraService],
})
export class SyncVistaraModule {}
