import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { basename } from 'node:path';

export interface EventoDto {
  id: string;
  timestamp: string;
  casa: string;
  sentido: 'entrada' | 'salida';
  placa: string | null;
  confianza: number | null; // 0-100
  manual: boolean;
  tipo: string | null;
  dispositivo: string | null;
  fotos: { canal: number; url: string; etiqueta: string }[];
}

export interface ListaFiltros {
  desde?: string;
  hasta?: string;
  q?: string;
  dispositivo?: string;
  sentido?: 'todos' | 'entrada' | 'salida';
  lectura?: 'todas' | 'sin' | 'baja';
  umbral?: number;
  cursor?: string;
  limit?: number;
}

// orden = posición de display (1=primero); NO tiene que coincidir con el
// orden en que DvrService las capturó -- se deriva del ID de canal real
// (_chNNN.jpg) leído del nombre de archivo, nunca de la posición en el
// array guardado (eso ya causó un bug real: etiquetas cruzadas cuando el
// orden de captura cambió pero esto todavía usaba índice de array).
const CANAL_INFO: Record<string, { orden: number; etiqueta: string }> = {
  '101': { orden: 1, etiqueta: 'Entrada general' },
  '1701': { orden: 2, etiqueta: 'Placas' },
  '301': { orden: 3, etiqueta: 'Plumas de ingreso' },
  '201': { orden: 1, etiqueta: 'Salida' },
};

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  private buildWhere(f: ListaFiltros): Prisma.AccessEventWhereInput {
    const where: Prisma.AccessEventWhereInput = {};
    const and: Prisma.AccessEventWhereInput[] = [];

    if (f.desde) and.push({ timestamp: { gte: `${f.desde}T00:00:00` } });
    if (f.hasta) and.push({ timestamp: { lte: `${f.hasta}T23:59:59` } });
    if (f.q) {
      const q = f.q.toUpperCase();
      and.push({
        OR: [
          { casaUnidad: { contains: q } },
          { plateText: { contains: q } },
        ],
      });
    }
    if (f.dispositivo && f.dispositivo !== 'Todos') and.push({ deviceName: f.dispositivo });
    if (f.sentido && f.sentido !== 'todos') and.push({ puerta: f.sentido });

    const umbral = f.umbral ?? 80;
    if (f.lectura === 'sin') and.push({ plateText: null });
    if (f.lectura === 'baja') {
      and.push({ plateText: { not: null } });
      and.push({ plateConfidence: { lt: umbral / 100 } });
    }

    if (and.length) where.AND = and;
    return where;
  }

  toEvento(ev: Prisma.AccessEventGetPayload<Record<string, never>>): EventoDto {
    let paths: string[] = [];
    try {
      paths = ev.photoPaths ? JSON.parse(ev.photoPaths) : [];
    } catch {
      paths = [];
    }
    const fotos = paths
      .map((p) => {
        const m = basename(p).match(/_ch(\d+)\./);
        const info = m ? CANAL_INFO[m[1]] : undefined;
        return {
          orden: info?.orden ?? 99,
          etiqueta: info?.etiqueta ?? 'Canal',
          url: `/media/event-photos/${basename(p)}`,
        };
      })
      .sort((a, b) => a.orden - b.orden)
      .map((f, i) => ({ canal: i + 1, url: f.url, etiqueta: f.etiqueta }));

    return {
      id: String(ev.id),
      timestamp: ev.timestamp,
      casa: ev.casaUnidad,
      sentido: ev.puerta as 'entrada' | 'salida',
      placa: ev.plateText,
      confianza: ev.plateConfidence !== null ? Math.round(ev.plateConfidence * 100) : null,
      manual: ev.plateManual,
      tipo: ev.vehicleLabel,
      dispositivo: ev.deviceName,
      fotos,
    };
  }

  async listar(f: ListaFiltros) {
    const where = this.buildWhere(f);
    const limit = Math.min(200, f.limit ?? 50);
    const cursorId = f.cursor ? Number(f.cursor) : undefined;

    const rows = await this.prisma.accessEvent.findMany({
      where: cursorId ? { ...where, AND: [...((where.AND as any[]) ?? []), { id: { lt: cursorId } }] } : where,
      orderBy: [{ id: 'desc' }],
      take: limit,
    });
    const total = await this.prisma.accessEvent.count({ where });

    return {
      eventos: rows.map((r) => this.toEvento(r)),
      total,
      siguienteCursor: rows.length === limit ? String(rows[rows.length - 1].id) : null,
    };
  }

  async resumen(f: ListaFiltros) {
    const where = this.buildWhere({ ...f, lectura: 'todas' });
    const umbral = f.umbral ?? 80;

    const [total, entradas, salidas, conPlaca, bajaConfianza] = await Promise.all([
      this.prisma.accessEvent.count({ where }),
      this.prisma.accessEvent.count({ where: { ...where, AND: [...((where.AND as any[]) ?? []), { puerta: 'entrada' }] } }),
      this.prisma.accessEvent.count({ where: { ...where, AND: [...((where.AND as any[]) ?? []), { puerta: 'salida' }] } }),
      this.prisma.accessEvent.count({ where: { ...where, AND: [...((where.AND as any[]) ?? []), { plateText: { not: null } }] } }),
      this.prisma.accessEvent.count({
        where: {
          ...where,
          AND: [...((where.AND as any[]) ?? []), { plateText: { not: null } }, { plateConfidence: { lt: umbral / 100 } }],
        },
      }),
    ]);

    return {
      eventosDelPeriodo: total,
      entradas,
      salidas,
      placasLeidas: conPlaca,
      porcentajeLectura: total > 0 ? Math.round((conPlaca / total) * 100) : 0,
      placasNoLeidas: total - conPlaca,
      bajaConfianza,
      umbral,
    };
  }

  /** Cuántas veces se usó el NIP de cada casa en el rango, y qué vehículos
   * (placas leídas) se vieron para cada una — para el módulo de Estadísticas
   * (Fase 5): sirve tal cual el análisis que antes se hacía a mano en Excel
   * exportando el log del teclado, ahora con el dato extra de qué auto entró. */
  async porCasa(desde?: string, hasta?: string) {
    const where: Prisma.AccessEventWhereInput = {};
    if (desde) where.timestamp = { ...(where.timestamp as object), gte: `${desde}T00:00:00` };
    if (hasta) where.timestamp = { ...(where.timestamp as object), lte: `${hasta}T23:59:59` };

    const totales = await this.prisma.accessEvent.groupBy({
      by: ['casaUnidad'],
      where,
      _count: { _all: true },
    });

    const vehiculos = await this.prisma.accessEvent.groupBy({
      by: ['casaUnidad', 'plateText'],
      where: { ...where, plateText: { not: null } },
      _count: { _all: true },
    });

    const vehiculosPorCasa = new Map<string, { placa: string; veces: number }[]>();
    for (const v of vehiculos) {
      const arr = vehiculosPorCasa.get(v.casaUnidad) ?? [];
      arr.push({ placa: v.plateText!, veces: v._count._all });
      vehiculosPorCasa.set(v.casaUnidad, arr);
    }

    return totales
      .map((t) => ({
        casa: t.casaUnidad,
        total: t._count._all,
        vehiculos: (vehiculosPorCasa.get(t.casaUnidad) ?? []).sort((a, b) => b.veces - a.veces),
      }))
      .sort((a, b) => b.total - a.total);
  }

  async capturarPlacaManual(id: number, placa: string) {
    const ev = await this.prisma.accessEvent.findUnique({ where: { id } });
    if (!ev) throw new NotFoundException(`Evento ${id} no existe`);

    const actualizado = await this.prisma.accessEvent.update({
      where: { id },
      data: { plateText: placa.toUpperCase(), plateManual: true, plateReason: null },
    });
    return this.toEvento(actualizado);
  }

  async guardarEventoNuevo(data: {
    ipAddress: string;
    serialNo: number | null;
    casaUnidad: string;
    employeeNo: string;
    timestamp: string;
    puerta: string;
    deviceName: string | null;
    verifyMode: string | null;
    subEventType: number | null;
    doorNo: number | null;
    cardReaderNo: number | null;
    rawPayload: string;
  }) {
    try {
      return await this.prisma.accessEvent.create({
        data: { ...data, receivedAt: new Date().toISOString() },
      });
    } catch (err) {
      // Violación de UNIQUE(ip_address, serial_no) -- evento duplicado, no es un error real.
      if ((err as { code?: string }).code === 'P2002') return null;
      throw err;
    }
  }

  async actualizarFotosYPlaca(
    id: number,
    photoPaths: string[],
    plate: { plate: string | null; confidence: number | null; reason: string | null; vehicleLabel: string | null } | null,
  ) {
    await this.prisma.accessEvent.update({
      where: { id },
      data: {
        photoPaths: JSON.stringify(photoPaths),
        ...(plate
          ? {
              plateText: plate.plate,
              plateConfidence: plate.confidence,
              plateReason: plate.reason,
              vehicleLabel: plate.vehicleLabel,
            }
          : {}),
      },
    });
  }
}
