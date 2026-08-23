import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // bodyParser:false -- lo armamos a mano abajo. Nuestra propia API manda
  // JSON normal (Content-Type: application/json) -- eso lo toma express.json().
  // El teclado puede mandar multipart/form-data O multipart/mixed (ambos
  // documentados en isapi.txt) -- en vez de listar content-types a mano y
  // arriesgar dejar uno fuera (2026-08-23: multipart/mixed real cayó en ese
  // hueco, eventos reales se perdieron en silencio, sin error en el log),
  // el raw parser agarra TODO lo que no sea nuestro propio JSON -- mismo
  // comportamiento sin filtro que tenía ingest.js con el http.createServer
  // crudo, que nunca filtraba por content-type.
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  app.use(express.json());
  app.use(
    express.raw({
      type: (req) => !(req.headers['content-type'] || '').includes('application/json'),
      limit: '10mb',
    }),
  );

  app.enableCors({ origin: true }); // apps/web (Next.js) le pega desde otro puerto en dev

  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`apps/api escuchando en 0.0.0.0:${port}`);
}
bootstrap();
