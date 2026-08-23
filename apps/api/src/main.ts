import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // bodyParser:false -- lo armamos a mano abajo. El teclado manda
  // multipart/form-data (necesitamos el Buffer crudo, como hacía ingest.js);
  // nuestra propia API manda JSON normal. Cada parser solo actúa sobre SU
  // content-type, así que no chocan entre sí.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(express.json());
  app.use(express.raw({ type: 'multipart/form-data', limit: '10mb' }));

  app.enableCors({ origin: true }); // apps/web (Next.js) le pega desde otro puerto en dev

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`apps/api escuchando en 0.0.0.0:${port}`);
}
bootstrap();
