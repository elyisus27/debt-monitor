import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { basename } from 'node:path';

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

// Apertura de la pluma del carril de morosos (cuando Vistara responde openBarrier).
// El castigo lo cuenta ESTE proceso con setTimeout (reloj monótono), nunca con una hora:
// un cambio de hora de la PC o de horario de verano no lo mueve. El pulso va directo al
// tótem por la LAN, sin pasar por Vistara ni por el túnel.
// Solo se abre si Vistara contesta dentro de FRESH_WINDOW_MS desde que se leyó la placa
// de ESTE cruce en ESTE proceso: un evento que sale de la cola de reintentos (Vistara o
// la red estuvieron caídos) ya no abre solo -- el vehículo pudo irse y abrir le regalaría
// la entrada al de atrás. Ese caso lo resuelve el guardia.
const FRESH_WINDOW_MS = 60_000;
const DEFAULT_OPEN_DELAY_SECONDS = 30;
const MAX_OPEN_DELAY_SECONDS = 120;
const TOTEM_TIMEOUT_MS = 5_000;

// vehicle_label del YOLO (clases COCO car/motorcycle/bus/truck) -> tipo de cajón de Vistara.
function toVehicleKind(label: string | null): 'CAR' | 'MOTORCYCLE' | null {
  if (!label) return null;
  if (label === 'motorcycle') return 'MOTORCYCLE';
  if (label === 'car' || label === 'truck' || label === 'bus') return 'CAR';
  return null;
}

function nextBackoffSeconds(attempts: number): number {
  return Math.min(INITIAL_BACKOFF_SECONDS * 2 ** attempts, MAX_BACKOFF_SECONDS);
}

@Injectable()
export class SyncVistaraService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncVistaraService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private warnedMissingConfig = false;
  private kickPending = false;
  // eventId -> performance.now() de cuando se terminó de leer su placa (ver kick()).
  private readonly freshAt = new Map<number, number>();
  private readonly scheduledOpens = new Set<number>();
  private warnedMissingTotem = false;

  private readonly totemUrl = process.env.TOTEM_GPIO_URL ?? '';
  private readonly totemToken = process.env.TOTEM_GPIO_TOKEN ?? '';

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

  // Sincroniza de inmediato (llamado al terminar de leer la placa de un cruce). Si ya
  // hay un tick corriendo, se repite en cuanto termine para no perder el evento nuevo.
  //
  // eventId (opcional): marca ese cruce como "recién leído" para que pueda abrir la
  // pluma si Vistara lo autoriza (ver FRESH_WINDOW_MS).
  kick(eventId?: number) {
    if (eventId != null) {
      this.freshAt.set(eventId, performance.now());
      // limpieza: nada en el mapa vive más que la ventana
      for (const [id, t] of this.freshAt) {
        if (performance.now() - t > FRESH_WINDOW_MS) this.freshAt.delete(id);
      }
    }
    if (this.running) {
      this.kickPending = true;
      return;
    }
    this.tick().catch((err) => this.logger.error(`kick() falló: ${err.message}`));
  }

  private async tick() {
    if (!this.configured() || this.running) return;
    this.running = true;
    this.kickPending = false;
    try {
      const nowIso = new Date().toISOString();
      const pending = await this.prisma.accessEvent.findMany({
        where: {
          // Entradas y salidas: las salidas liberan cajón en Vistara (Acceso a Morosos).
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
      if (this.kickPending) this.kick();
    }
  }

  // Vistara autorizó abrir tras el castigo. Espera con setTimeout y pulsa el tótem.
  private scheduleOpen(eventId: number, delaySeconds: number | undefined) {
    const readAt = this.freshAt.get(eventId);
    this.freshAt.delete(eventId);
    if (readAt == null || performance.now() - readAt > FRESH_WINDOW_MS) {
      this.logger.warn(`evento ${eventId}: autorizado pero llegó tarde, NO se abre la pluma (lo decide el guardia)`);
      return;
    }
    if (this.scheduledOpens.has(eventId)) return;
    if (!this.totemUrl) {
      if (!this.warnedMissingTotem) {
        this.warnedMissingTotem = true;
        this.logger.warn('TOTEM_GPIO_URL sin configurar -- no se puede abrir la pluma del carril de morosos');
      }
      return;
    }
    const delay =
      typeof delaySeconds === 'number' && delaySeconds >= 0
        ? Math.min(delaySeconds, MAX_OPEN_DELAY_SECONDS)
        : DEFAULT_OPEN_DELAY_SECONDS;
    this.scheduledOpens.add(eventId);
    this.logger.log(`evento ${eventId}: pluma programada en ${delay}s (castigo)`);
    setTimeout(() => {
      this.scheduledOpens.delete(eventId);
      this.pulseTotem(eventId).catch(() => undefined);
    }, delay * 1000);
  }

  private async pulseTotem(eventId: number) {
    const headers: Record<string, string> = {};
    if (this.totemToken) headers['X-Gpio-Token'] = this.totemToken;
    try {
      const r = await fetch(this.totemUrl, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(TOTEM_TIMEOUT_MS),
      });
      if (r.ok) this.logger.log(`evento ${eventId}: pluma abierta`);
      else this.logger.error(`evento ${eventId}: el tótem respondió HTTP ${r.status}`);
    } catch (err) {
      this.logger.error(`evento ${eventId}: no se pudo abrir la pluma: ${(err as Error).message}`);
    }
  }

  private async sendEvent(ev: {
    id: number;
    puerta: string;
    casaUnidad: string;
    timestamp: string;
    plateText: string | null;
    plateConfidence: number | null;
    vehicleLabel: string | null;
    photoPaths: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    // Fotos ya capturadas ANTES de este punto (photoPaths != null es justo la
    // condición que ya exige el WHERE de tick() para tomar el evento) -- van
    // síncronas en el mismo POST, sin round-trip aparte. "keypad/" es el mismo
    // prefijo que photo-serve.controller.ts usa para resolver la carpeta real.
    let photoRefs: string[] | undefined;
    try {
      const paths: string[] = ev.photoPaths ? JSON.parse(ev.photoPaths) : [];
      if (paths.length > 0) photoRefs = paths.map((p) => `keypad/${basename(p)}`);
    } catch {
      photoRefs = undefined;
    }

    const payload = {
      eventId: `moroso-${ev.id}`,
      detectedAt: ev.timestamp,
      plate: ev.plateText ?? '',
      confidence: ev.plateConfidence ?? undefined,
      direction: ev.puerta === 'entrada' ? ('IN' as const) : ('OUT' as const),
      domicileCode: ev.casaUnidad,
      // Tipo que detectó YOLO aunque no haya leído la placa: Vistara identifica por tipo
      // contra los vehículos del domicilio marcados "puede entrar sin lectura de placa".
      ...(toVehicleKind(ev.vehicleLabel) ? { vehicleKind: toVehicleKind(ev.vehicleLabel) } : {}),
      ...(photoRefs ? { photoRefs } : {}),
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
        const body = (await res.json().catch(() => null)) as
          | { openBarrier?: boolean; openDelaySeconds?: number }
          | null;
        if (ev.puerta === 'entrada' && body?.openBarrier) {
          this.scheduleOpen(ev.id, body.openDelaySeconds);
        }
        return { ok: true };
      }
      const body = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
