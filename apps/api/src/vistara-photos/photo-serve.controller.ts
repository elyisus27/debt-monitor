import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Sirve fotos para el proxy de Vistara (PhotoCaptureService.fetchPhoto) -- el
// "kind" en la URL es literalmente el mismo que Vistara guarda como prefijo en
// Visit.photoRefs ("keypad/archivo.jpg" o "guard/archivo.jpg"), así que esta
// ruta acepta cualquiera de los dos sin que Vistara necesite saber en qué
// carpeta local vive cada uno. Alcanzable en LAN directo (mismo nivel de
// confianza que MediaController) o vía el túnel de apps/photos-gateway, que ya
// validó el token compartido con Vistara antes de relayar aquí -- esta ruta en
// sí NO vuelve a pedir token (127.0.0.1 y LAN son el límite de confianza real).
const DIR_BY_KIND: Record<string, string> = {
  keypad: join(process.cwd(), 'data', 'event-photos'),
  guard: join(process.cwd(), 'data', 'guard-photos'),
};

@Controller('api/vistara-photos')
export class PhotoServeController {
  @Get(':kind/:file')
  servir(@Param('kind') kind: string, @Param('file') file: string, @Res() res: Response) {
    const dir = DIR_BY_KIND[kind];
    if (!dir) throw new NotFoundException();
    if (!/^[a-zA-Z0-9_.-]+\.jpg$/.test(file)) throw new NotFoundException();
    const filePath = join(dir, file);
    if (!existsSync(filePath)) throw new NotFoundException();
    res.sendFile(filePath);
  }
}
