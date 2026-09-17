import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DvrService } from '../dvr/dvr.service';

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
    const rutas = await this.dvr.capturarFotosGuardia(visitId);
    const capturedAt = new Date().toISOString();

    if (rutas.length === 0) {
      // ISAPI_HOST/USER/PASS sin configurar, o el DVR falló las 3 veces --
      // nada que mandarle a Vistara. 'skipped' para que el sync no lo
      // reintente a lo infinito por un capítulo que ya terminó (a diferencia
      // de 'error', que sí implica reintentar).
      await this.prisma.guardVisitPhoto.update({
        where: { visitId },
        data: { photoPaths: '[]', capturedAt, vistaraStatus: 'skipped' },
      });
      return;
    }

    await this.prisma.guardVisitPhoto.update({
      where: { visitId },
      data: { photoPaths: JSON.stringify(rutas), capturedAt },
    });
  }
}
