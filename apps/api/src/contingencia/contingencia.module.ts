import { Module } from '@nestjs/common';
import { TotemModule } from '../totem/totem.module';
import { ContingenciaController } from './contingencia.controller';
import { ContingenciaService } from './contingencia.service';
import { ContingenciaAuthService } from './contingencia-auth.service';
import { ContingenciaAuthGuard } from './contingencia-auth.guard';
import { DirectorySyncService } from './directory-sync.service';

@Module({
  imports: [TotemModule],
  controllers: [ContingenciaController],
  providers: [ContingenciaService, ContingenciaAuthService, ContingenciaAuthGuard, DirectorySyncService],
})
export class ContingenciaModule {}
