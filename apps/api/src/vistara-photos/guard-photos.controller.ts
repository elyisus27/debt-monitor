import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { GuardPhotosService } from './guard-photos.service';

// Solo alcanzable en LAN (127.0.0.1 desde apps/photos-gateway, o cualquiera en
// la LAN -- mismo nivel de confianza implícito que el resto de rutas de este
// puerto, ver IngestController). NUNCA se expone directo a internet: el único
// camino público es apps/photos-gateway, que valida el token compartido con
// Vistara antes de relayar aquí. Ver CLAUDE.md (vistara) § "Fotos de visitas".
@Controller('api/guard-photos')
export class GuardPhotosController {
  constructor(private readonly guardPhotos: GuardPhotosService) {}

  @Post('capture-request')
  @HttpCode(HttpStatus.ACCEPTED)
  async captureRequest(@Body() body: { visitId?: unknown; tenantId?: unknown; plate?: unknown }) {
    const visitId = typeof body.visitId === 'string' ? body.visitId.trim() : '';
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
    const plate = typeof body.plate === 'string' && body.plate.trim() ? body.plate.trim() : null;
    if (!visitId || !tenantId) {
      throw new BadRequestException('visitId y tenantId son requeridos');
    }
    return this.guardPhotos.requestCapture({ visitId, tenantId, plate });
  }
}
