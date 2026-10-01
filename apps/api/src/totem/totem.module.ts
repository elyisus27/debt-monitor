import { Module } from '@nestjs/common';
import { TotemService } from './totem.service';

@Module({
  providers: [TotemService],
  exports: [TotemService],
})
export class TotemModule {}
