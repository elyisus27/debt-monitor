import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './events/events.module';
import { DevicesModule } from './devices/devices.module';
import { MediaModule } from './media/media.module';
import { IngestModule } from './ingest/ingest.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    // Orden importa: todo lo demás va ANTES de IngestModule -- IngestModule
    // trae un catch-all (@All('*')) que debe ser el último recurso, nunca
    // ganarle a nuestras propias rutas /api/* o /media/*. (ServeStaticModule
    // se probó primero para /media/ pero su middleware no ganaba de forma
    // confiable al router de Nest -- un controller normal sí es determinista.)
    EventsModule,
    DevicesModule,
    MediaModule,
    IngestModule,
  ],
})
export class AppModule {}
