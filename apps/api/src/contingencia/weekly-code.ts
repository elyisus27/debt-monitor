import { createHmac } from 'node:crypto';

// Clave semanal del usuario de guardias de la bitácora de contingencia. Se deriva de
// CONTINGENCIA_MASTER_KEY + la semana ISO (lunes 00:00 a domingo 23:59, hora LOCAL de
// la PC de caseta), así que no hay lista que mantener en caseta: el dueño genera la
// lista de varios años con el mismo cálculo (claves-cli.ts) y la guarda en su Drive.
// Este archivo lo comparten el servidor y el CLI -- cambiar el cálculo invalida
// todas las listas ya repartidas.

export interface Semana {
  year: number; // año ISO (puede diferir del calendario en los últimos/primeros días)
  week: number;
  key: string; // "2026-W40"
  monday: Date; // 00:00 local
}

const DIA_MS = 24 * 3600_000;

function lunesLocal(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

export function semanaDe(d: Date): Semana {
  const monday = lunesLocal(d);
  const jueves = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
  const year = jueves.getFullYear();
  // La semana 1 es la que contiene el 4 de enero.
  const lunes1 = lunesLocal(new Date(year, 0, 4));
  const week = 1 + Math.round((monday.getTime() - lunes1.getTime()) / (7 * DIA_MS));
  return { year, week, key: `${year}-W${String(week).padStart(2, '0')}`, monday };
}

// Todas las semanas ISO de un año.
export function semanasDelAnio(year: number): Semana[] {
  const out: Semana[] = [];
  let d = lunesLocal(new Date(year, 0, 4));
  for (;;) {
    const s = semanaDe(d);
    if (s.year !== year) break;
    out.push(s);
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7);
  }
  return out;
}

// 6 dígitos: fácil de dictar por teléfono.
export function claveSemanal(masterKey: string, semanaKey: string): string {
  const h = createHmac('sha256', masterKey).update(`contingencia:${semanaKey}`).digest();
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
