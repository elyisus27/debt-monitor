import { Injectable, Logger } from '@nestjs/common';

const TOTEM_TIMEOUT_MS = 5_000;

// Pulso de la pluma directo al GPIO del tótem por la LAN (TOTEM_GPIO_URL), sin pasar
// por Vistara ni por el túnel. Lo comparten el carril de morosos (SyncVistaraService,
// tras el castigo) y la bitácora de contingencia (ContingenciaService).
@Injectable()
export class TotemService {
  private readonly logger = new Logger(TotemService.name);
  private readonly url = process.env.TOTEM_GPIO_URL ?? '';
  private readonly token = process.env.TOTEM_GPIO_TOKEN ?? '';

  configured(): boolean {
    return !!this.url;
  }

  // Nunca lanza: regresa si el tótem confirmó el pulso y, si no, por qué.
  async pulse(context: string): Promise<{ opened: boolean; error?: string }> {
    if (!this.url) return { opened: false, error: 'TOTEM_GPIO_URL sin configurar' };
    const headers: Record<string, string> = {};
    if (this.token) headers['X-Gpio-Token'] = this.token;
    try {
      const r = await fetch(this.url, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(TOTEM_TIMEOUT_MS),
      });
      if (r.ok) {
        this.logger.log(`${context}: pluma abierta`);
        return { opened: true };
      }
      this.logger.error(`${context}: el tótem respondió HTTP ${r.status}`);
      return { opened: false, error: `el tótem respondió HTTP ${r.status}` };
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`${context}: no se pudo abrir la pluma: ${message}`);
      return { opened: false, error: message };
    }
  }
}
