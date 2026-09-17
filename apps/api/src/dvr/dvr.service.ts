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
  private readonly guardPhotosDir: string;
  private readonly habilitado: boolean;

  constructor(private readonly config: ConfigService) {
    this.photosDir = join(process.cwd(), 'data', 'event-photos');
    if (!existsSync(this.photosDir)) mkdirSync(this.photosDir, { recursive: true });
    // Carpeta APARTE de event-photos a propósito -- fotos de registros de
    // guardia (Vistara), nunca mezcladas con cruces de teclado. Ver
    // GuardPhotosService / CLAUDE.md § "Fotos de registros de guardia".
    this.guardPhotosDir = join(process.cwd(), 'data', 'guard-photos');
    if (!existsSync(this.guardPhotosDir)) mkdirSync(this.guardPhotosDir, { recursive: true });
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

  /** Un snapshot crudo de un canal, o null si falla -- sin tocar disco. */
  private async snapshotCanal(canal: string, logCtx: string): Promise<Buffer | null> {
    const host = this.config.get<string>('ISAPI_HOST');
    const port = this.config.get<string>('ISAPI_PORT') ?? '80';
    const user = this.config.get<string>('ISAPI_USER')!;
    const pass = this.config.get<string>('ISAPI_PASS')!;
    const baseUrl = `http://${host}:${port}`;
    try {
      // videoResolutionWidth/Height explícitos: sin ellos el equipo regresa
      // 704x480 (substream) aunque el canal soporte 1080p (confirmado 2026-08-22).
      const res = await digestFetch(
        baseUrl,
        `/ISAPI/Streaming/channels/${canal}/picture?videoResolutionWidth=1920&videoResolutionHeight=1080`,
        { method: 'GET', username: user, password: pass },
      );
      if (res.status !== 200) {
        this.logger.error(`foto canal ${canal} (${logCtx}): HTTP ${res.status}`);
        return null;
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      this.logger.error(`foto canal ${canal} (${logCtx}): ${(err as Error).message}`);
      return null;
    }
  }

  /** Devuelve las rutas relativas (bajo data/event-photos/) de las fotos capturadas. */
  async capturarFotos(eventId: number, puerta: string): Promise<string[]> {
    if (!this.habilitado) return [];
    const canales = this.canalesPara(puerta);
    if (canales.length === 0) return [];

    const rutas: string[] = [];
    for (const canal of canales) {
      const buffer = await this.snapshotCanal(canal, `evento ${eventId}`);
      if (!buffer) continue;
      const rutaRelativa = `event${eventId}_ch${canal}.jpg`;
      writeFileSync(join(this.photosDir, rutaRelativa), buffer);
      rutas.push(rutaRelativa);
    }
    return rutas;
  }

  /**
   * Registro de guardia en Vistara (carril de visitantes) -- APARTADO SEPARADO
   * de capturarFotos()/data/event-photos, a propósito (ver comentario del
   * constructor). `canales` viene de GUARD_PHOTO_CHANNELS (config del operador,
   * no del mapeo fijo de arriba -- ese es para el carril de teclados/residentes,
   * una cámara/DVR físicamente distinta). Vacío = deshabilitado, sin error.
   * Devuelve las rutas relativas bajo data/guard-photos/.
   */
  async capturarFotosGuardia(visitId: string, canales: string[]): Promise<string[]> {
    if (!this.habilitado || canales.length === 0) return [];

    const rutas: string[] = [];
    for (const canal of canales) {
      const buffer = await this.snapshotCanal(canal, `visita ${visitId}`);
      if (!buffer) continue;
      const rutaRelativa = `guard_${visitId}_ch${canal}.jpg`;
      writeFileSync(join(this.guardPhotosDir, rutaRelativa), buffer);
      rutas.push(rutaRelativa);
    }
    return rutas;
  }
}
