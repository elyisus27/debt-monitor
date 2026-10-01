import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TotemService } from '../totem/totem.service';
import { semanaDe } from './weekly-code';

// Mismos valores que el enum VisitType de Vistara (sin EMERGENCY: esa solo la crea
// la apertura de emergencia).
export const VISIT_TYPES = [
  'VISIT', 'PROVIDER', 'PACKAGE', 'MOVING', 'FOOD', 'BASIC_SERVICES',
  'HOME_WORKER', 'REPAIR', 'TRANSPORT', 'RESIDENT', 'OTHER',
] as const;
// Tipos donde Vistara pide "paradas" (STOP_COUNT_TYPES en su pantalla de visitas).
const STOP_COUNT_TYPES = new Set(['PACKAGE', 'FOOD', 'TRANSPORT', 'BASIC_SERVICES', 'PROVIDER']);
const ACCESS_TYPES = ['VEHICLE', 'PEDESTRIAN'] as const;
const PAGE_SIZE = 50;

// Domicilio de las aperturas de emergencia -- mismo criterio que Vistara
// (resolveAdministracionUnit): el sincronizador lo resuelve allá a la unidad
// "Administracion" del condominio.
const EMERGENCY_DOMICILE = 'ADMINISTRACION';

export interface NuevaVisita {
  unitId?: string;
  domicileCode?: string;
  visitorName?: string;
  visitType?: string;
  accessType?: string;
  plate?: string;
  residentId?: string;
  notes?: string;
  stopCount?: number | string;
}

export interface FiltrosVisitas {
  status?: string;
  q?: string;
  fecha?: string; // YYYY-MM-DD, día local
  page?: number;
}

// Misma normalización que Vistara (VisitsService.normalizeDomicileCode).
function normalizeDomicileCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((seg) => (/^\d+$/.test(seg) ? String(parseInt(seg, 10)) : seg))
    .join('-');
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, max) : null;
}

// Bitácora de contingencia: registro local de visitas cuando Vistara no está
// disponible, con apertura de pluma por la LAN. Igual que en Vistara, la pluma solo
// se abre DESPUÉS de registrar (o con la apertura de emergencia, que deja su propio
// registro), y cada intento queda en contingency_barrier_opens.
@Injectable()
export class ContingenciaService {
  private readonly logger = new Logger(ContingenciaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly totem: TotemService,
  ) {}

  async estado() {
    const [sync, units, pendientes] = await Promise.all([
      this.prisma.directorySync.findUnique({ where: { id: 1 } }),
      this.prisma.directoryUnit.count(),
      this.prisma.contingencyVisit.count({ where: { vistaraStatus: 'pending' } }),
    ]);
    // Hora del equipo y semana vigente: si el reloj de la PC se desajusta, la clave
    // semanal deja de coincidir con la lista -- así se nota en pantalla.
    return {
      serverTime: new Date().toISOString(),
      semana: semanaDe(new Date()).key,
      totemConfigured: this.totem.configured(),
      directory: {
        units,
        syncedAt: sync?.syncedAt ?? null,
        generatedAt: sync?.generatedAt ?? null,
        lastAttemptAt: sync?.lastAttemptAt ?? null,
        lastError: sync?.lastError ?? null,
      },
      pendientesDeSincronizar: pendientes,
    };
  }

  directorio() {
    return this.prisma.directoryUnit.findMany({
      orderBy: { label: 'asc' },
      include: { residents: { orderBy: { name: 'asc' } } },
    });
  }

  async registrar(input: NuevaVisita, usuario: string) {
    const visitorName = cleanText(input.visitorName, 120);
    if (!visitorName) throw new BadRequestException('Falta el nombre del visitante');
    const visitType = input.visitType ?? '';
    if (!(VISIT_TYPES as readonly string[]).includes(visitType)) {
      throw new BadRequestException('Tipo de visita inválido');
    }
    const accessType = input.accessType ?? '';
    if (!(ACCESS_TYPES as readonly string[]).includes(accessType)) {
      throw new BadRequestException('Tipo de acceso inválido');
    }

    // Domicilio: si hay directorio local, se elige de ahí (evita domicilios
    // inventados). Solo si nunca se ha bajado el directorio se acepta texto libre.
    let domicileCode: string;
    let unitId: string | null = null;
    let residentId: string | null = null;
    let residentName: string | null = null;
    if (input.unitId) {
      const unit = await this.prisma.directoryUnit.findUnique({
        where: { id: input.unitId },
        include: { residents: true },
      });
      if (!unit) throw new BadRequestException('El domicilio no está en el directorio');
      domicileCode = unit.label;
      unitId = unit.id;
      if (input.residentId) {
        const resident = unit.residents.find((r) => r.id === input.residentId);
        if (!resident) throw new BadRequestException('El residente no pertenece a ese domicilio');
        residentId = resident.id;
        residentName = resident.name;
      }
    } else {
      if ((await this.prisma.directoryUnit.count()) > 0) {
        throw new BadRequestException('Elige el domicilio de la lista');
      }
      const code = normalizeDomicileCode(input.domicileCode ?? '');
      if (!code) throw new BadRequestException('Falta el domicilio');
      domicileCode = code;
    }

    let plate: string | null = null;
    if (accessType === 'VEHICLE') {
      plate = cleanText(input.plate, 20)?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
    }

    let stopCount: number | null = null;
    if (STOP_COUNT_TYPES.has(visitType) && input.stopCount !== undefined && input.stopCount !== '') {
      const n = Number(input.stopCount);
      if (!Number.isInteger(n) || n < 1 || n > 99) throw new BadRequestException('Paradas: de 1 a 99');
      stopCount = n;
    }

    const now = new Date().toISOString();
    const visit = await this.prisma.contingencyVisit.create({
      data: {
        domicileCode,
        unitId,
        visitorName,
        visitType,
        accessType,
        plate,
        residentId,
        residentName,
        notes: cleanText(input.notes, 500),
        stopCount,
        enteredAt: now,
        registeredBy: usuario,
        createdAt: now,
      },
    });
    this.logger.log(`visita ${visit.id} registrada por "${usuario}" -> ${domicileCode}`);
    return visit;
  }

  async listar(f: FiltrosVisitas) {
    const where: Prisma.ContingencyVisitWhereInput = {};
    if (f.status === 'ACTIVE' || f.status === 'EXITED') where.status = f.status;
    if (f.fecha && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha)) {
      // Día LOCAL de la PC de caseta -> rango en ISO UTC (así se guardan).
      const desde = new Date(`${f.fecha}T00:00:00`);
      const hasta = new Date(desde.getTime() + 24 * 3600_000);
      where.enteredAt = { gte: desde.toISOString(), lt: hasta.toISOString() };
    }
    const q = cleanText(f.q, 60);
    if (q) {
      where.OR = [
        { visitorName: { contains: q } },
        { plate: { contains: q.toUpperCase() } },
        { domicileCode: { contains: q.toUpperCase() } },
      ];
    }
    const page = Math.max(1, Math.floor(f.page ?? 1));
    const [visitas, total] = await Promise.all([
      this.prisma.contingencyVisit.findMany({
        where,
        orderBy: { enteredAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: { _count: { select: { barrierOpens: true } } },
      }),
      this.prisma.contingencyVisit.count({ where }),
    ]);
    return { visitas, total, page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
  }

  async registrarSalida(id: number, usuario: string) {
    const visit = await this.prisma.contingencyVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('Visita no encontrada');
    if (visit.status !== 'ACTIVE') throw new ConflictException('La visita ya tiene salida registrada');
    const exitedAt = new Date();
    const durationMinutes = Math.max(0, Math.round((exitedAt.getTime() - Date.parse(visit.enteredAt)) / 60_000));
    this.logger.log(`visita ${id}: salida registrada por "${usuario}"`);
    return this.prisma.contingencyVisit.update({
      where: { id },
      data: { status: 'EXITED', exitedAt: exitedAt.toISOString(), durationMinutes },
    });
  }

  // Botón "Abrir barrera" del panel de visita registrada. Solo exige que la visita
  // exista y siga activa -- se puede insistir cuantas veces haga falta (igual que en
  // Vistara); cada intento queda auditado.
  async abrirPluma(id: number, usuario: string) {
    const visit = await this.prisma.contingencyVisit.findUnique({ where: { id } });
    if (!visit) throw new NotFoundException('Visita no encontrada');
    if (visit.status !== 'ACTIVE') throw new ConflictException('La visita ya tiene salida registrada');

    const result = await this.totem.pulse(`contingencia visita ${id} ("${usuario}")`);
    const requestedAt = new Date().toISOString();
    await this.prisma.contingencyBarrierOpen.create({
      data: { visitId: id, requestedBy: usuario, requestedAt, opened: result.opened, error: result.error ?? null },
    });
    if (result.opened && !visit.barrierTriggeredAt) {
      await this.prisma.contingencyVisit.update({ where: { id }, data: { barrierTriggeredAt: requestedAt } });
    }
    return result;
  }

  // "Apertura Emergencia (Ambulancia, Bomberos)": abre sin registro previo y deja
  // constancia post mortem con una visita EMERGENCY a Administración, ya cerrada --
  // mismo flujo que VisitsService.emergencyOpen de Vistara. Si la pluma no abre, no
  // se crea visita, pero el intento sí queda en la bitácora de aperturas.
  async emergencia(notes: string | undefined, usuario: string) {
    const result = await this.totem.pulse(`contingencia EMERGENCIA ("${usuario}")`);
    const now = new Date().toISOString();
    if (!result.opened) {
      await this.prisma.contingencyBarrierOpen.create({
        data: { requestedBy: usuario, requestedAt: now, emergency: true, opened: false, error: result.error ?? null },
      });
      return { opened: false, error: result.error, visit: null };
    }
    const visit = await this.prisma.contingencyVisit.create({
      data: {
        domicileCode: EMERGENCY_DOMICILE,
        visitorName: 'Emergencia (Ambulancia/Bomberos)',
        visitType: 'EMERGENCY',
        accessType: 'VEHICLE',
        notes: cleanText(notes, 500),
        status: 'EXITED',
        enteredAt: now,
        exitedAt: now,
        durationMinutes: 0,
        registeredBy: usuario,
        authorizationMethod: 'EMERGENCY_MANUAL_OPEN',
        barrierTriggeredAt: now,
        createdAt: now,
        barrierOpens: {
          create: { requestedBy: usuario, requestedAt: now, emergency: true, opened: true },
        },
      },
    });
    this.logger.log(`apertura de emergencia por "${usuario}" -> visita ${visit.id}`);
    return { opened: true, visit };
  }
}
