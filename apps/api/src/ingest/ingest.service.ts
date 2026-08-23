import { Injectable, Logger } from '@nestjs/common';
import { EventsService } from '../events/events.service';
import { DvrService, CANAL_PLACAS } from '../dvr/dvr.service';
import { PlateService } from '../plate/plate.service';

interface AccessControllerEvent {
  deviceName?: string;
  majorEventType?: number;
  subEventType?: number;
  cardReaderNo?: number;
  doorNo?: number;
  name?: string;
  employeeNoString?: string;
  serialNo?: number;
  currentVerifyMode?: string;
}

interface EventPayload {
  ipAddress?: string;
  dateTime?: string;
  eventType?: string;
  AccessControllerEvent?: AccessControllerEvent;
}

function extractJsonPart(buf: Buffer): EventPayload | null {
  const text = buf.toString('utf8');
  const idx = text.indexOf('application/json');
  if (idx === -1) return null;
  const braceStart = text.indexOf('{', idx);
  if (braceStart === -1) return null;
  const boundaryIdx = text.indexOf('--MIME_boundary', braceStart);
  const braceEnd = boundaryIdx === -1 ? text.lastIndexOf('}') : text.lastIndexOf('}', boundaryIdx);
  if (braceEnd === -1) return null;
  try {
    return JSON.parse(text.slice(braceStart, braceEnd + 1));
  } catch {
    return null;
  }
}

function inferPuerta(deviceName: string | undefined, ip: string | undefined): string {
  const n = (deviceName || '').toLowerCase();
  if (n.includes('salida')) return 'salida';
  if (n.includes('entrada')) return 'entrada';
  if (ip === '192.168.100.103') return 'salida';
  if (ip === '192.168.100.104') return 'entrada';
  return 'desconocida';
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private recibidos = 0;
  private ruido = 0;
  private guardados = 0;

  constructor(
    private readonly events: EventsService,
    private readonly dvr: DvrService,
    private readonly plate: PlateService,
  ) {}

  async procesar(body: Buffer) {
    this.recibidos++;
    const json = extractJsonPart(body);
    if (!json || json.eventType !== 'AccessControllerEvent') {
      this.ruido++;
      return;
    }
    const ace = json.AccessControllerEvent ?? {};
    if (!ace.name || !ace.employeeNoString) {
      this.ruido++;
      return; // puerta abrió/cerró, diagnóstico, etc. -- se descarta
    }

    const puerta = inferPuerta(ace.deviceName, json.ipAddress);
    const nuevo = await this.events.guardarEventoNuevo({
      ipAddress: json.ipAddress ?? '',
      serialNo: ace.serialNo ?? null,
      casaUnidad: ace.name.trim(),
      employeeNo: ace.employeeNoString,
      timestamp: json.dateTime ?? '',
      puerta,
      deviceName: ace.deviceName ?? null,
      verifyMode: ace.currentVerifyMode ?? null,
      subEventType: ace.subEventType ?? null,
      doorNo: ace.doorNo ?? null,
      cardReaderNo: ace.cardReaderNo ?? null,
      rawPayload: JSON.stringify(json),
    });

    if (!nuevo) {
      this.logger.log(`DUPLICADO ignorado (ip=${json.ipAddress} serialNo=${ace.serialNo}, ya existía)`);
      return;
    }

    this.guardados++;
    this.logger.log(`CRUCE ${json.dateTime} casa=${ace.name.trim()} puerta=${puerta} modo=${ace.currentVerifyMode || '?'}`);

    // Fire-and-forget: no bloquea el ack al teclado ni el siguiente POST.
    this.capturarFotosYPlaca(nuevo.id, puerta).catch((err) =>
      this.logger.error(`error capturando fotos/placa (evento ${nuevo.id}): ${err.message}`),
    );
  }

  private async capturarFotosYPlaca(eventId: number, puerta: string) {
    const rutas = await this.dvr.capturarFotos(eventId, puerta);
    if (rutas.length === 0) return;

    // Por nombre de archivo (_ch1701.), no por posición -- el orden de captura
    // no está garantizado que coincida con el de display.
    const rutaPlaca = rutas.find((r) => r.includes(`_ch${CANAL_PLACAS}.`));
    const resultado = rutaPlaca ? await this.plate.leerPlaca(rutaPlaca) : null;

    await this.events.actualizarFotosYPlaca(
      eventId,
      rutas,
      resultado
        ? {
            plate: resultado.plate,
            confidence: resultado.confidence ?? null,
            reason: resultado.reason ?? null,
            vehicleLabel: resultado.vehicleLabel ?? null,
          }
        : null,
    );
    if (resultado?.plate) {
      this.logger.log(`PLACA (evento ${eventId}): ${resultado.plate} (conf=${resultado.confidence})`);
    }
  }

  stats() {
    return { recibidos: this.recibidos, ruido: this.ruido, guardados: this.guardados };
  }
}
