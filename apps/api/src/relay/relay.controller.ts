import { Controller, ForbiddenException, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RelayService } from './relay.service';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

@Controller('api/relay')
export class RelayController {
  constructor(private readonly relay: RelayService) {}

  // SSE para la pantalla de caseta. CORS ya lo da app.enableCors({ origin: true }).
  @Get('events')
  events(@Res() res: Response) {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write(': conectado\n\n');
    this.relay.addClient(res);
  }

  // Solo desde esta misma PC (lpr-caseta corre aquí). Cualquier otra IP de la LAN
  // recibe 403: no hay token que filtrar ni nada que proteger más allá de eso.
  @Post('notify')
  @HttpCode(204)
  notify(@Req() req: Request) {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) {
      throw new ForbiddenException();
    }
    this.relay.notify();
  }
}
