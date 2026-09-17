import { Module } from '@nestjs/common';
import { DvrService } from './dvr.service';

@Module({
  providers: [DvrService],
  exports: [DvrService],
})
export class DvrModule {}
