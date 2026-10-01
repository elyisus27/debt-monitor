import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { claveSemanal, semanaDe } from './weekly-code';

const SESSION_HOURS = 12; // un turno
const MAX_FALLOS = 5; // intentos fallidos seguidos por IP...
const BLOQUEO_MS = 10 * 60_000; // ...antes de bloquear el login 10 min (6 dígitos se adivinan sin esto)

// Login de la bitácora de contingencia. Dos tipos de usuario, sin roles:
//
// - Guardias: un solo usuario (CONTINGENCIA_WEEKLY_USER, "caseta" por omisión) cuya
//   clave cambia sola cada semana (weekly-code.ts, derivada de CONTINGENCIA_MASTER_KEY).
//   Sin internet, el dueño le dicta por teléfono la clave de la semana desde su lista
//   (pnpm claves); a lo mucho sirve una semana. Al cambiar de semana la sesión se cae
//   y hay que pedir la nueva.
// - Dueño/administrador: CONTINGENCIA_USERS (usuario:clave separados por coma), clave
//   fija que no vence.
//
// El token es usuario + vencimiento (+ semana, para el de guardias) firmados con HMAC
// (CONTINGENCIA_SECRET). Sin secreto configurado se genera uno al arrancar: reiniciar
// el servicio cierra todas las sesiones.
@Injectable()
export class ContingenciaAuthService {
  private readonly logger = new Logger(ContingenciaAuthService.name);
  private readonly users = new Map<string, string>();
  private readonly weeklyUser = (process.env.CONTINGENCIA_WEEKLY_USER || 'caseta').trim().toLowerCase();
  private readonly masterKey = process.env.CONTINGENCIA_MASTER_KEY ?? '';
  private readonly secret: string;
  private readonly fallos = new Map<string, { count: number; hasta: number }>();

  constructor() {
    for (const entry of (process.env.CONTINGENCIA_USERS ?? '').split(',')) {
      const sep = entry.indexOf(':');
      if (sep <= 0) continue;
      const user = entry.slice(0, sep).trim().toLowerCase();
      const pass = entry.slice(sep + 1).trim();
      if (user && pass && user !== this.weeklyUser) this.users.set(user, pass);
    }
    this.secret = process.env.CONTINGENCIA_SECRET || randomBytes(32).toString('hex');
    if (!this.masterKey) {
      this.logger.warn('CONTINGENCIA_MASTER_KEY sin configurar -- el usuario de guardias (clave semanal) está desactivado');
    }
    if (this.users.size === 0 && !this.masterKey) {
      this.logger.warn('Sin usuarios -- bitácora de contingencia desactivada');
    }
  }

  login(username: string, password: string, ip: string): { token: string; username: string; expiresAt: string } {
    if (this.users.size === 0 && !this.masterKey) {
      throw new ServiceUnavailableException('La bitácora de contingencia no está configurada');
    }
    const ahora = Date.now();
    const f = this.fallos.get(ip);
    if (f && f.hasta > ahora) {
      const min = Math.ceil((f.hasta - ahora) / 60_000);
      throw new HttpException(`Demasiados intentos. Espera ${min} min.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = (username ?? '').trim().toLowerCase();
    const semana = semanaDe(new Date());
    let ok = false;
    let week: string | undefined;
    if (user === this.weeklyUser) {
      // Sin espacios: la lista la muestra como "482 915" para dictarla mejor.
      ok = !!this.masterKey && safeEqual((password ?? '').replace(/\s/g, ''), claveSemanal(this.masterKey, semana.key));
      week = semana.key;
    } else {
      const expected = this.users.get(user);
      ok = !!expected && safeEqual(password ?? '', expected);
    }

    if (!ok) {
      const count = (f && f.hasta <= ahora && f.count >= MAX_FALLOS ? 0 : (f?.count ?? 0)) + 1;
      this.fallos.set(ip, { count, hasta: count >= MAX_FALLOS ? ahora + BLOQUEO_MS : 0 });
      this.logger.warn(`login fallido: "${user}" desde ${ip} (${count}/${MAX_FALLOS})`);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    this.fallos.delete(ip);

    const expiresAt = new Date(ahora + SESSION_HOURS * 3600_000).toISOString();
    const payload = Buffer.from(JSON.stringify({ u: user, e: expiresAt, w: week })).toString('base64url');
    this.logger.log(`login: "${user}" desde ${ip}${week ? ` (semana ${week})` : ''}`);
    return { token: `${payload}.${this.sign(payload)}`, username: user, expiresAt };
  }

  // Regresa el usuario del token, o lanza 401. Un usuario fijo quitado de
  // CONTINGENCIA_USERS (y reinicio) pierde sus sesiones; el de guardias, al cambiar
  // de semana.
  verify(token: string | undefined): string {
    const [payload, sig] = (token ?? '').split('.');
    if (!payload || !sig || !safeEqual(sig, this.sign(payload))) {
      throw new UnauthorizedException('Sesión inválida');
    }
    let data: { u?: string; e?: string; w?: string };
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    } catch {
      throw new UnauthorizedException('Sesión inválida');
    }
    if (!data.u || !data.e || Date.parse(data.e) < Date.now()) {
      throw new UnauthorizedException('Sesión vencida');
    }
    if (data.u === this.weeklyUser) {
      if (!this.masterKey || data.w !== semanaDe(new Date()).key) {
        throw new UnauthorizedException('Cambió la semana: pide la contraseña nueva');
      }
    } else if (!this.users.has(data.u)) {
      throw new UnauthorizedException('Sesión vencida');
    }
    return data.u;
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
