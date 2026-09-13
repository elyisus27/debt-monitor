import { Module } from '@nestjs/common';
import { SyncVistaraService } from './sync-vistara.service';

@Module({
  providers: [SyncVistaraService],
})
export class SyncVistaraModule {}
