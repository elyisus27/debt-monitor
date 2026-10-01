// Cliente de la bitácora de contingencia (apps/api /api/contingencia). La sesión
// (token firmado, ver ContingenciaAuthService) se guarda en localStorage para que un
// recargo de página no saque al guardia a media captura; dura un turno (12 h).

export const VISIT_TYPE_LABELS: Record<string, string> = {
  VISIT: 'Visita',
  PROVIDER: 'Proveedor',
  PACKAGE: 'Paquetería',
  MOVING: 'Mudanza',
  FOOD: 'Comida',
  BASIC_SERVICES: 'Servicios básicos',
  HOME_WORKER: 'Trabajador del hogar',
  REPAIR: 'Reparación',
  TRANSPORT: 'Transporte',
  RESIDENT: 'Residente',
  OTHER: 'Otro',
  EMERGENCY: 'Emergencia',
};
// Orden del selector (EMERGENCY no: solo la crea "Apertura emergencia").
export const VISIT_TYPES_FORM = [
  'VISIT', 'RESIDENT', 'PACKAGE', 'FOOD', 'PROVIDER', 'BASIC_SERVICES',
  'HOME_WORKER', 'REPAIR', 'TRANSPORT', 'MOVING', 'OTHER',
];
export const STOP_COUNT_TYPES = new Set(['PACKAGE', 'FOOD', 'TRANSPORT', 'BASIC_SERVICES', 'PROVIDER']);

export const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Propietario',
  OWNER_ADMIN: 'Propietario',
  TENANT: 'Inquilino',
  RESIDENT: 'Residente',
};

export interface Sesion {
  token: string;
  username: string;
  expiresAt: string;
}

export interface Residente {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  phoneHome: string | null;
  phoneSecondary: string | null;
}

export interface Domicilio {
  id: string;
  label: string;
  isDelinquent: boolean;
  residents: Residente[];
}

export interface Estado {
  serverTime: string;
  semana: string; // "2026-W40" -- semana ISO vigente según el reloj de la PC de caseta
  totemConfigured: boolean;
  directory: {
    units: number;
    syncedAt: string | null;
    generatedAt: string | null;
    lastAttemptAt: string | null;
    lastError: string | null;
  };
  pendientesDeSincronizar: number;
}

export interface VisitaContingencia {
  id: number;
  domicileCode: string;
  unitId: string | null;
  visitorName: string;
  visitType: string;
  accessType: 'VEHICLE' | 'PEDESTRIAN';
  plate: string | null;
  residentId: string | null;
  residentName: string | null;
  notes: string | null;
  stopCount: number | null;
  status: 'ACTIVE' | 'EXITED';
  enteredAt: string;
  exitedAt: string | null;
  durationMinutes: number | null;
  registeredBy: string;
  authorizationMethod: string;
  barrierTriggeredAt: string | null;
  vistaraStatus: string;
  _count?: { barrierOpens: number };
}

export interface NuevaVisita {
  unitId?: string;
  domicileCode?: string;
  visitorName: string;
  visitType: string;
  accessType: 'VEHICLE' | 'PEDESTRIAN';
  plate?: string;
  residentId?: string;
  notes?: string;
  stopCount?: string;
}

export interface ResultadoPluma {
  opened: boolean;
  error?: string;
}

const LLAVE_SESION = 'contingencia.sesion';

export function leerSesion(): Sesion | null {
  try {
    const raw = localStorage.getItem(LLAVE_SESION);
    if (!raw) return null;
    const s = JSON.parse(raw) as Sesion;
    return Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function guardarSesion(s: Sesion | null) {
  try {
    if (s) localStorage.setItem(LLAVE_SESION, JSON.stringify(s));
    else localStorage.removeItem(LLAVE_SESION);
  } catch {
    // sin almacenamiento: la sesión vive solo mientras la pestaña siga abierta
  }
}

export class ErrorApi extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function llamar<T>(token: string | null, ruta: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`/api/contingencia${ruta}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ErrorApi('No hay conexión con el servidor de caseta', 0);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
    const msg = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ErrorApi(msg ?? `HTTP ${res.status}`, res.status);
  }
  return res.json() as Promise<T>;
}

export function iniciarSesion(username: string, password: string) {
  return llamar<Sesion>(null, '/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export function obtenerEstado(token: string) {
  return llamar<Estado>(token, '/estado');
}

export function obtenerDirectorio(token: string) {
  return llamar<Domicilio[]>(token, '/directorio');
}

export function actualizarDirectorio(token: string) {
  return llamar<{ ok: boolean; units?: number; error?: string }>(token, '/directorio/actualizar', { method: 'POST' });
}

export function listarVisitas(token: string, params: { status?: string; q?: string; fecha?: string; page?: number }) {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.q) qs.set('q', params.q);
  if (params.fecha) qs.set('fecha', params.fecha);
  if (params.page) qs.set('page', String(params.page));
  return llamar<{ visitas: VisitaContingencia[]; total: number; page: number; totalPages: number }>(
    token,
    `/visitas?${qs}`,
  );
}

export function registrarVisita(token: string, v: NuevaVisita) {
  return llamar<VisitaContingencia>(token, '/visitas', { method: 'POST', body: JSON.stringify(v) });
}

export function registrarSalida(token: string, id: number) {
  return llamar<VisitaContingencia>(token, `/visitas/${id}/salida`, { method: 'POST' });
}

export function abrirPluma(token: string, id: number) {
  return llamar<ResultadoPluma>(token, `/visitas/${id}/pluma`, { method: 'POST' });
}

export function aperturaEmergencia(token: string, notes?: string) {
  return llamar<ResultadoPluma & { visit: VisitaContingencia | null }>(token, '/emergencia', {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}
