import { Module } from '@nestjs/common';
import { GuardPhotosController } from './guard-photos.controller';
import { PhotoServeController } from './photo-serve.controller';
import { GuardPhotosService } from './guard-photos.service';
import { GuardPhotosSyncService } from './guard-photos-sync.service';
import { DvrModule } from '../dvr/dvr.module';

@Module({
  imports: [DvrModule],
  controllers: [GuardPhotosController, PhotoServeController],
  providers: [GuardPhotosService, GuardPhotosSyncService],
})
export class VistaraPhotosModule {}
