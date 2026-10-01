import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CHECK_INTERVAL_MS = 60 * 60_000; // revisa cada hora si toca bajar
const RETRY_AFTER_ERROR_MS = 60 * 60_000; // tras un fallo, no reintentar antes de 1 h
const FIRST_CHECK_DELAY_MS = 10_000;
const HTTP_TIMEOUT_MS = 30_000;

interface DirectoryResponse {
  generatedAt: string;
  units: Array<{
    id: string;
    label: string;
    isDelinquent: boolean;
    residents: Array<{
      id: string;
      name: string;
      role: string;
      phone: string | null;
      phoneHome: string | null;
      phoneSecondary: string | null;
    }>;
  }>;
}

// Copia local del directorio de Vistara (domicilios + residentes con teléfono) para
// la bitácora de contingencia: cuando se cae el internet, el guardia elige el
// domicilio y ve a quién llamar sin depender de la nube. Se baja cada
// DIRECTORY_REFRESH_HOURS (24 por omisión) de GET /api/v1/caseta/directory, con la
// misma identidad de Device que usa SyncVistaraService. Cada descarga REEMPLAZA la
// copia completa; si falla, se conserva la última buena.
@Injectable()
export class DirectorySyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DirectorySyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private firstCheck: NodeJS.Timeout | null = null;
  private running = false;

  private readonly baseUrl = process.env.VISTARA_API_BASE_URL?.replace(/\/$/, '') ?? '';
  private readonly tenantSlug = process.env.VISTARA_TENANT_SLUG ?? '';
  private readonly deviceKey = process.env.VISTARA_DEVICE_KEY ?? '';
  private readonly refreshMs = (Number(process.env.DIRECTORY_REFRESH_HOURS) || 24) * 3600_000;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!this.baseUrl || !this.tenantSlug || !this.deviceKey) {
      this.logger.warn('Sin configuración de Vistara -- el directorio de contingencia no se descarga');
      return;
    }
    const check = () => this.refreshIfDue().catch((err) => this.logger.error(`refreshIfDue() falló: ${err.message}`));
    this.firstCheck = setTimeout(check, FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(check, CHECK_INTERVAL_MS);
    this.logger.log(`Iniciado -- directorio cada ${this.refreshMs / 3600_000} h`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.firstCheck) clearTimeout(this.firstCheck);
  }

  private async refreshIfDue() {
    const state = await this.prisma.directorySync.findUnique({ where: { id: 1 } });
    const now = Date.now();
    if (state?.syncedAt && now - Date.parse(state.syncedAt) < this.refreshMs) return;
    if (state?.lastError && state.lastAttemptAt && now - Date.parse(state.lastAttemptAt) < RETRY_AFTER_ERROR_MS) return;
    await this.refresh();
  }

  // También se llama a mano desde la pantalla ("Actualizar ahora").
  async refresh(): Promise<{ ok: boolean; units?: number; error?: string }> {
    if (!this.baseUrl || !this.tenantSlug || !this.deviceKey) {
      return { ok: false, error: 'Sin configuración de Vistara' };
    }
    if (this.running) return { ok: false, error: 'Ya hay una descarga en curso' };
    this.running = true;
    const attemptAt = new Date().toISOString();
    try {
      const res = await fetch(`${this.baseUrl}/api/v1/caseta/directory`, {
        headers: { 'X-Tenant-Slug': this.tenantSlug, 'X-Device-Key': this.deviceKey },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as DirectoryResponse;
      if (!Array.isArray(data?.units) || data.units.length === 0) {
        // Un directorio vacío casi seguro es un error del otro lado -- no borrar la copia buena.
        throw new Error('Vistara regresó un directorio vacío');
      }

      await this.prisma.$transaction([
        this.prisma.directoryResident.deleteMany(),
        this.prisma.directoryUnit.deleteMany(),
        this.prisma.directoryUnit.createMany({
          data: data.units.map((u) => ({ id: u.id, label: u.label, isDelinquent: !!u.isDelinquent })),
        }),
        this.prisma.directoryResident.createMany({
          data: data.units.flatMap((u) =>
            u.residents.map((r) => ({
              id: r.id,
              unitId: u.id,
              name: r.name,
              role: r.role,
              phone: r.phone,
              phoneHome: r.phoneHome,
              phoneSecondary: r.phoneSecondary,
            })),
          ),
        }),
        this.prisma.directorySync.upsert({
          where: { id: 1 },
          create: { id: 1, generatedAt: data.generatedAt, syncedAt: attemptAt, lastAttemptAt: attemptAt, lastError: null },
          update: { generatedAt: data.generatedAt, syncedAt: attemptAt, lastAttemptAt: attemptAt, lastError: null },
        }),
      ]);
      this.logger.log(`directorio actualizado: ${data.units.length} domicilios`);
      return { ok: true, units: data.units.length };
    } catch (err) {
      // fetch() de Node solo dice "fetch failed" cuando no hay red / DNS / conexión.
      const raw = err instanceof Error ? err.message : String(err);
      const error = raw === 'fetch failed' ? 'sin conexión con Vistara' : raw;
      this.logger.warn(`no se pudo bajar el directorio (se conserva la copia anterior): ${error}`);
      await this.prisma.directorySync.upsert({
        where: { id: 1 },
        create: { id: 1, lastAttemptAt: attemptAt, lastError: error },
        update: { lastAttemptAt: attemptAt, lastError: error },
      });
      return { ok: false, error };
    } finally {
      this.running = false;
    }
  }
}
