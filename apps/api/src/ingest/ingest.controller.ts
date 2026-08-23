import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IngestService } from './ingest.service';

/**
 * Acepta CUALQUIER ruta/método en POST -- igual que tools/httphosts-probe/ingest.js
 * (nunca revisaba req.url). Así no depende de saber exactamente qué "url" tiene
 * configurado cada teclado en su httpHosts (evitamos consultarlo para no arriesgar
 * el candado de login del panel -- ver hallazgos-hikvision.md).
 */
@Controller()
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @All('*')
  async recibir(@Req() req: Request, @Res() res: Response) {
    // Guarda defensiva: nuestras propias rutas (api/, media/) nunca deben caer
    // aquí -- si esto se dispara, algo en el orden de registro de módulos está
    // mal, mejor un 404 explícito que "tragarse" una llamada real de la API.
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) {
      res.status(404).json({ error: 'not found (ruta reservada, no es un evento de teclado)' });
      return;
    }
    if (req.method !== 'POST') {
      res.status(404).json({ error: 'not found' });
      return;
    }
    // Responder rápido siempre -- el equipo espera un ack pronto, el
    // procesamiento no debe bloquearlo (mismo criterio que ingest.js).
    res.status(200).send('OK');

    const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    await this.ingest.procesar(body);
  }
}
