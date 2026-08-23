import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { digestFetch } from './digest.util';

// Mapeo confirmado 2026-08-22 (ver developersDocs/docs/hallazgos-hikvision.md) --
// IDs de streaming (canal*100+1). Entrada trae 3 vistas (general, plumas,
// placas); salida solo 1 (no hay cámara de placas dedicada para ese sentido).
// Orden de CAPTURA aquí, sin relación con el orden de DISPLAY -- ese lo decide
// EventsService.toEvento() por ID de canal, no por posición (ver ahí el porqué:
// un reorden aquí alguna vez desalineó las etiquetas contra datos ya guardados).
const CANALES_POR_PUERTA: Record<string, string[]> = {
  entrada: ['101', '301', '1701'],
  salida: ['201'],
};

export const CANAL_PLACAS = '1701';

@Injectable()
export class DvrService {
  private readonly logger = new Logger(DvrService.name);
  private readonly photosDir: string;
  private readonly habilitado: boolean;

  constructor(private readonly config: ConfigService) {
    this.photosDir = join(process.cwd(), 'data', 'event-photos');
    if (!existsSync(this.photosDir)) mkdirSync(this.photosDir, { recursive: true });
    this.habilitado = Boolean(
      this.config.get('ISAPI_HOST') && this.config.get('ISAPI_USER') && this.config.get('ISAPI_PASS'),
    );
    if (!this.habilitado) {
      this.logger.warn('Captura de fotos deshabilitada: falta ISAPI_HOST/ISAPI_USER/ISAPI_PASS');
    }
  }

  canalesPara(puerta: string): string[] {
    return CANALES_POR_PUERTA[puerta] ?? [];
  }

  /** Devuelve las rutas relativas (bajo data/event-photos/) de las fotos capturadas. */
  async capturarFotos(eventId: number, puerta: string): Promise<string[]> {
    if (!this.habilitado) return [];
    const canales = this.canalesPara(puerta);
    if (canales.length === 0) return [];

    const host = this.config.get<string>('ISAPI_HOST');
    const port = this.config.get<string>('ISAPI_PORT') ?? '80';
    const user = this.config.get<string>('ISAPI_USER')!;
    const pass = this.config.get<string>('ISAPI_PASS')!;
    const baseUrl = `http://${host}:${port}`;

    const rutas: string[] = [];
    for (const canal of canales) {
      const rutaRelativa = `event${eventId}_ch${canal}.jpg`;
      try {
        // videoResolutionWidth/Height explícitos: sin ellos el equipo regresa
        // 704x480 (substream) aunque el canal soporte 1080p (confirmado 2026-08-22).
        const res = await digestFetch(
          baseUrl,
          `/ISAPI/Streaming/channels/${canal}/picture?videoResolutionWidth=1920&videoResolutionHeight=1080`,
          { method: 'GET', username: user, password: pass },
        );
        if (res.status !== 200) {
          this.logger.error(`foto canal ${canal} (evento ${eventId}): HTTP ${res.status}`);
          continue;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        writeFileSync(join(this.photosDir, rutaRelativa), buffer);
        rutas.push(rutaRelativa);
      } catch (err) {
        this.logger.error(`foto canal ${canal} (evento ${eventId}): ${(err as Error).message}`);
      }
    }
    return rutas;
  }
}
