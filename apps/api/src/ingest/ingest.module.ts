import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { EventsModule } from '../events/events.module';
import { DvrModule } from '../dvr/dvr.module';
import { PlateService } from '../plate/plate.service';

@Module({
  imports: [EventsModule, DvrModule],
  controllers: [IngestController],
  providers: [IngestService, PlateService],
})
export class IngestModule {}
