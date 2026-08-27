import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { normalizarPlaca } from './normalizar-placa';

export interface PlateResult {
  plate: string | null;
  confidence?: number | null;
  vehicleLabel?: string | null;
  vehicleConf?: number | null;
  reason?: string | null;
}

@Injectable()
export class PlateService {
  private readonly logger = new Logger(PlateService.name);
  private readonly serviceUrl: string;
  private readonly photosDir: string;

  constructor(private readonly config: ConfigService) {
    this.serviceUrl = this.config.get<string>('PLATE_SERVICE_URL') ?? 'http://127.0.0.1:9300/read-plate';
    this.photosDir = join(process.cwd(), 'data', 'event-photos');
  }

  /** Llama a tools/plate-reader (servicio Python aparte) sobre una foto ya guardada. */
  async leerPlaca(rutaRelativaFoto: string): Promise<PlateResult | null> {
    const imagePath = join(this.photosDir, rutaRelativaFoto);
    try {
      const res = await fetch(this.serviceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_path: imagePath }),
      });
      if (!res.ok) {
        this.logger.error(`servicio de placas respondió HTTP ${res.status}`);
        return null;
      }
      const data = await res.json();
      return {
        // defensa aparte del propio normalizado de plate_ocr.py -- ver
        // normalizarPlaca()
        plate: data.plate ? normalizarPlaca(data.plate) : null,
        confidence: data.confidence ?? null,
        vehicleLabel: data.vehicle_label ?? null,
        vehicleConf: data.vehicle_conf ?? null,
        reason: data.reason ?? null,
      };
    } catch (err) {
      // El servicio de placas puede estar caído -- nunca debe tumbar el ingest.
      this.logger.error(`error llamando al servicio de placas: ${(err as Error).message}`);
      return null;
    }
  }
}
