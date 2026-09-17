import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { basename } from 'node:path';

// Cola durable de entrega hacia Vistara para las fotos de registros de guardia
// -- MISMO patrón que sync-vistara/sync-vistara.service.ts (esa manda cruces de
// teclado a POST /visits/plate-events; esta manda fotos ya capturadas a
// PATCH /visits/:id/photos), pero deliberadamente un servicio APARTE: son dos
// conceptos distintos (crear un cruce vs. adjuntar fotos a uno que el guardia
// ya creó), aunque compartan las mismas 3 variables de credencial (cualquier
// Device activo del tenant sirve para las dos cosas, ver .env.example).
const POLL_INTERVAL_MS = 20_000;
const BATCH_SIZE = 20;
const INITIAL_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 300;
const HTTP_TIMEOUT_MS = 8_000;

function nextBackoffSeconds(attempts: number): number {
  return Math.min(INITIAL_BACKOFF_SECONDS * 2 ** attempts, MAX_BACKOFF_SECONDS);
}

@Injectable()
export class GuardPhotosSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuardPhotosSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private warnedMissingConfig = false;

  private readonly baseUrl = process.env.VISTARA_API_BASE_URL?.replace(/\/$/, '') ?? '';
  private readonly tenantSlug = process.env.VISTARA_TENANT_SLUG ?? '';
  private readonly deviceKey = process.env.VISTARA_DEVICE_KEY ?? '';

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logger.error(`tick() falló: ${err.message}`));
    }, POLL_INTERVAL_MS);
    this.logger.log(`Iniciado -- cada ${POLL_INTERVAL_MS / 1000}s revisa fotos de guardia sin sincronizar`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private configured(): boolean {
    const ok = !!(this.baseUrl && this.tenantSlug && this.deviceKey);
    if (!ok && !this.warnedMissingConfig) {
      this.warnedMissingConfig = true;
      this.logger.warn(
        'VISTARA_API_BASE_URL / VISTARA_TENANT_SLUG / VISTARA_DEVICE_KEY sin configurar -- sync de fotos de guardia desactivado',
      );
    }
    return ok;
  }

  private async tick() {
    if (!this.configured() || this.running) return;
    this.running = true;
    try {
      const nowIso = new Date().toISOString();
      const pending = await this.prisma.guardVisitPhoto.findMany({
        where: {
          vistaraStatus: { in: ['pending', 'error'] },
          photoPaths: { not: null },
          OR: [{ vistaraNextTry: null }, { vistaraNextTry: { lte: nowIso } }],
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });

      for (const row of pending) {
        let paths: string[] = [];
        try {
          paths = row.photoPaths ? JSON.parse(row.photoPaths) : [];
        } catch {
          paths = [];
        }

        if (paths.length === 0) {
          // Capturado sin ninguna foto (DVR falló, o el operador no configuró
          // GUARD_PHOTO_CHANNELS todavía) -- nada que adjuntar, Vistara además
          // rechazaría un array vacío. No es un error de red, no se reintenta.
          await this.prisma.guardVisitPhoto.update({
            where: { id: row.id },
            data: { vistaraStatus: 'skipped' },
          });
          continue;
        }

        const photoRefs = paths.map((p) => `guard/${basename(p)}`);
        const { ok, error } = await this.sendPhotos(row.visitId, photoRefs);
        if (ok) {
          await this.prisma.guardVisitPhoto.update({
            where: { id: row.id },
            data: { vistaraStatus: 'sent', vistaraSentAt: new Date().toISOString(), vistaraError: null },
          });
        } else {
          const attempts = row.vistaraAttempts + 1;
          const backoff = nextBackoffSeconds(attempts);
          await this.prisma.guardVisitPhoto.update({
            where: { id: row.id },
            data: {
              vistaraStatus: 'error',
              vistaraAttempts: attempts,
              vistaraError: (error ?? '').slice(0, 500),
              vistaraNextTry: new Date(Date.now() + backoff * 1000).toISOString(),
            },
          });
          this.logger.warn(`foto de guardia (visita ${row.visitId}): ${error} -- reintentando en ${backoff}s`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async sendPhotos(visitId: string, photoRefs: string[]): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/visits/${visitId}/photos`, {
        method: 'PATCH',
        headers: {
          'X-Tenant-Slug': this.tenantSlug,
          'X-Device-Key': this.deviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ photoRefs }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
