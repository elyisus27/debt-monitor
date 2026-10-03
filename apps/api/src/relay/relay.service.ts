import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';

// Relay local de avisos para la bandeja de caseta de Vistara (pestaña "Placas no
// reconocidas"). La pantalla de la PC de caseta se suscribe por SSE a
// http://localhost:9100/api/relay/events y, solo cuando llega un aviso, le pide los
// datos a Vistara. Sin carros no hay peticiones a la nube y Neon/Cloud Run pueden
// dormirse (ver vistara/CLAUDE.md § COSTOS punto 2).
//
// Los avisos NO llevan datos (ni placas ni residentes): solo "hay algo nuevo". Por
// eso el stream no necesita autenticación.

const HEARTBEAT_MS = 25_000;
// Varios avisos seguidos (p. ej. el teclado y el LPR viendo el mismo carro) se
// juntan en uno solo: la pantalla igual va a pedir todo lo nuevo de una vez.
const COALESCE_MS = 1_000;

@Injectable()
export class RelayService implements OnModuleDestroy {
  private readonly logger = new Logger(RelayService.name);
  private readonly clients = new Set<Response>();
  private pending: NodeJS.Timeout | null = null;
  private readonly heartbeat = setInterval(() => this.write(': ping\n\n'), HEARTBEAT_MS);

  addClient(res: Response) {
    this.clients.add(res);
    this.logger.log(`pantalla conectada (${this.clients.size} abiertas)`);
    res.on('close', () => {
      this.clients.delete(res);
      this.logger.log(`pantalla desconectada (${this.clients.size} abiertas)`);
    });
  }

  // Lo llaman sync-vistara (teclado de morosos) y lpr-caseta (vía POST /notify)
  // DESPUÉS de que Vistara ya aceptó el evento, para que el fetch de la pantalla
  // lo encuentre.
  notify() {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.write('data: {"kind":"gate"}\n\n');
    }, COALESCE_MS);
  }

  private write(chunk: string) {
    for (const res of this.clients) {
      try {
        res.write(chunk);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  onModuleDestroy() {
    clearInterval(this.heartbeat);
    if (this.pending) clearTimeout(this.pending);
    for (const res of this.clients) res.end();
    this.clients.clear();
  }
}
