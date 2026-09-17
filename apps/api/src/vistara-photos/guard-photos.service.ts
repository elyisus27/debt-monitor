import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DvrService } from '../dvr/dvr.service';

// Canales del carril de VISITANTES (donde el guardia registra en Vistara) --
// físicamente distintos de CANALES_POR_PUERTA en dvr.service.ts, que es el
// carril de teclados/residentes. Config del operador, NO un mapeo fijo -- no
// hay forma de adivinar el número de canal correcto desde el código; vacío =
// feature deshabilitada (sin error), mismo criterio que ISAPI_HOST faltante.
// Ver apps/photos-gateway/README.md § "Pendiente antes de producción".
function canalesGuardia(): string[] {
  const raw = process.env.GUARD_PHOTO_CHANNELS ?? '';
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

export interface CaptureRequest {
  visitId: string;
  tenantId: string;
  plate: string | null;
}

@Injectable()
export class GuardPhotosService {
  private readonly logger = new Logger(GuardPhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dvr: DvrService,
  ) {}

  // Encola la fila y dispara la captura en segundo plano -- el caller (el
  // controller que atiende a photos-gateway) responde de inmediato, sin
  // esperar a que el DVR conteste. Idempotente por visitId: una segunda
  // solicitud para la misma visita no duplica fila ni vuelve a capturar si ya
  // hay una en curso o terminada.
  async requestCapture(req: CaptureRequest): Promise<{ accepted: boolean; reason?: string }> {
    const existing = await this.prisma.guardVisitPhoto.findUnique({ where: { visitId: req.visitId } });
    if (existing) {
      return { accepted: false, reason: 'ya existe una solicitud para esta visita' };
    }

    await this.prisma.guardVisitPhoto.create({
      data: {
        visitId: req.visitId,
        tenantId: req.tenantId,
        plate: req.plate,
        createdAt: new Date().toISOString(),
      },
    });

    this.capturar(req.visitId).catch((err) =>
      this.logger.error(`error capturando fotos de guardia (visita ${req.visitId}): ${err.message}`),
    );

    return { accepted: true };
  }

  private async capturar(visitId: string): Promise<void> {
    const canales = canalesGuardia();
    const rutas = await this.dvr.capturarFotosGuardia(visitId, canales);
    const capturedAt = new Date().toISOString();

    if (rutas.length === 0) {
      // Sin canales configurados, o el DVR falló las 3 veces -- nada que
      // mandarle a Vistara. 'skipped' para que el sync no lo reintente a lo
      // infinito por un capítulo que ya terminó (a diferencia de 'error', que
      // sí implica reintentar).
      await this.prisma.guardVisitPhoto.update({
        where: { visitId },
        data: { photoPaths: '[]', capturedAt, vistaraStatus: 'skipped' },
      });
      if (canales.length === 0) {
        this.logger.warn(`GUARD_PHOTO_CHANNELS vacío -- captura de fotos de guardia deshabilitada (visita ${visitId})`);
      }
      return;
    }

    await this.prisma.guardVisitPhoto.update({
      where: { visitId },
      data: { photoPaths: JSON.stringify(rutas), capturedAt },
    });
  }
}
