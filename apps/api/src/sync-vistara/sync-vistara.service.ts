import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Conexión con Vistara -- manda cada cruce de ENTRADA por el teclado de morosos
// a POST /visits/plate-events (mismo endpoint del LPR de visitantes), autenticado
// como Device kind=DELINQUENT_KEYPAD (X-Tenant-Slug + X-Device-Key). Cola durable en
// el propio access_events: reintentos con backoff exponencial, mismo patrón que
// agents/plate-ocr/sender.py del otro repo (30s -> 60s -> 120s -> 240s -> 300s tope).
//
// Por qué esperar a photoPaths != null antes de mandar: Vistara deduplica por
// eventId (tenantId+eventId único) y NO acepta una segunda actualización del
// mismo evento -- si mandáramos el evento antes de que capturarFotosYPlaca()
// terminara de leer la placa, y luego quisiéramos "actualizarlo" con la placa ya
// leída, Vistara respondería 'duplicate' y la placa se perdería para siempre.
// photoPaths pasa de NULL a un valor (aunque sea '[]') exactamente cuando ese
// paso termina, corra o no la lectura de placa con éxito -- es la señal de
// "ya se puede mandar" sin inventar un timer.
//
// El domicilio manda: Vistara solo usa domicileCode para resolver la Unit (el
// NIP ya identificó la casa) -- la placa es dato supletorio. Ver
// VisitsService.handleMorosoKeypadEvent en el repo de Vistara.

const POLL_INTERVAL_MS = 20_000;
const BATCH_SIZE = 20;
const INITIAL_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 300;
const HTTP_TIMEOUT_MS = 8_000;

function nextBackoffSeconds(attempts: number): number {
  return Math.min(INITIAL_BACKOFF_SECONDS * 2 ** attempts, MAX_BACKOFF_SECONDS);
}

@Injectable()
export class SyncVistaraService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncVistaraService.name);
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
    this.logger.log(`Iniciado -- cada ${POLL_INTERVAL_MS / 1000}s revisa cruces de entrada sin sincronizar`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private configured(): boolean {
    const ok = !!(this.baseUrl && this.tenantSlug && this.deviceKey);
    if (!ok && !this.warnedMissingConfig) {
      this.warnedMissingConfig = true;
      this.logger.warn(
        'VISTARA_API_BASE_URL / VISTARA_TENANT_SLUG / VISTARA_DEVICE_KEY sin configurar -- sincronización con Vistara desactivada',
      );
    }
    return ok;
  }

  private async tick() {
    if (!this.configured() || this.running) return;
    this.running = true;
    try {
      const nowIso = new Date().toISOString();
      const pending = await this.prisma.accessEvent.findMany({
        where: {
          puerta: 'entrada',
          vistaraStatus: { in: ['pending', 'error'] },
          photoPaths: { not: null },
          OR: [{ vistaraNextTry: null }, { vistaraNextTry: { lte: nowIso } }],
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });

      for (const ev of pending) {
        const { ok, error } = await this.sendEvent(ev);
        if (ok) {
          await this.prisma.accessEvent.update({
            where: { id: ev.id },
            data: { vistaraStatus: 'sent', vistaraSentAt: new Date().toISOString(), vistaraError: null },
          });
        } else {
          const attempts = ev.vistaraAttempts + 1;
          const backoff = nextBackoffSeconds(attempts);
          await this.prisma.accessEvent.update({
            where: { id: ev.id },
            data: {
              vistaraStatus: 'error',
              vistaraAttempts: attempts,
              vistaraError: (error ?? '').slice(0, 500),
              vistaraNextTry: new Date(Date.now() + backoff * 1000).toISOString(),
            },
          });
          this.logger.warn(`evento ${ev.id}: ${error} -- reintentando en ${backoff}s`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async sendEvent(ev: {
    id: number;
    casaUnidad: string;
    timestamp: string;
    plateText: string | null;
    plateConfidence: number | null;
  }): Promise<{ ok: boolean; error?: string }> {
    const payload = {
      eventId: `moroso-${ev.id}`,
      detectedAt: ev.timestamp,
      plate: ev.plateText ?? '',
      confidence: ev.plateConfidence ?? undefined,
      direction: 'IN' as const,
      domicileCode: ev.casaUnidad,
    };

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/visits/plate-events`, {
        method: 'POST',
        headers: {
          'X-Tenant-Slug': this.tenantSlug,
          'X-Device-Key': this.deviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });

      if (res.ok) {
        // 'matched' | 'unmatched' | 'illegible' | 'duplicate' -- todas 2xx, todas
        // significan "Vistara ya lo tiene", 'duplicate' incluido (idempotencia).
        return { ok: true };
      }
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
