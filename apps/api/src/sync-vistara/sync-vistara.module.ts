import { Module } from '@nestjs/common';
import { SyncVistaraService } from './sync-vistara.service';
import { TotemModule } from '../totem/totem.module';
import { RelayModule } from '../relay/relay.module';

@Module({
  imports: [TotemModule, RelayModule],
  providers: [SyncVistaraService],
  exports: [SyncVistaraService],
})
export class SyncVistaraModule {}
