import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { EventsModule } from '../events/events.module';
import { DvrModule } from '../dvr/dvr.module';
import { PlateService } from '../plate/plate.service';
import { SyncVistaraModule } from '../sync-vistara/sync-vistara.module';

@Module({
  imports: [EventsModule, DvrModule, SyncVistaraModule],
  controllers: [IngestController],
  providers: [IngestService, PlateService],
})
export class IngestModule {}
