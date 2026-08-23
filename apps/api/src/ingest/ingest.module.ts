import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';
import { EventsModule } from '../events/events.module';
import { DvrService } from '../dvr/dvr.service';
import { PlateService } from '../plate/plate.service';

@Module({
  imports: [EventsModule],
  controllers: [IngestController],
  providers: [IngestService, DvrService, PlateService],
})
export class IngestModule {}
