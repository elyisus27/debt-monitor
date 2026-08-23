function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Primer y último día del mes actual, calculado en el cliente (no hardcodeado) --
 * pedido explícito del README del handoff. */
export function rangoMesActual(): { desde: string; hasta: string } {
  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
  return { desde: toYmd(primero), hasta: toYmd(ultimo) };
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Formatea el timestamp del sitio TAL CUAL viene (sin pasar por new Date(), que
 * lo reinterpretaría con la zona horaria del navegador) -- mismo criterio usado
 * en todo el proyecto para no arriesgar un desfase de horas. */
export function formatFechaHora(iso: string): { hora: string; fecha: string } {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return { hora: iso, fecha: '' };
  const [, , mo, d, h, mi, s] = m;
  return { hora: `${h}:${mi}:${s}`, fecha: `${d} ${MESES[Number(mo) - 1]}` };
}

/** Tiempo relativo tipo "hace 12 s" -- SÍ compara contra la hora actual real
 * (a diferencia del formateo de arriba, aquí es intencional: es una distancia
 * entre dos momentos, no una hora absoluta que mostrar tal cual). */
export function tiempoRelativo(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2})/);
  if (!m) return '';
  const [, y, mo, d, h, mi, s, offset] = m;
  const t = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`).getTime();
  const diffS = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffS < 60) return `hace ${diffS} s`;
  if (diffS < 3600) return `hace ${Math.floor(diffS / 60)} min`;
  if (diffS < 86400) return `hace ${Math.floor(diffS / 3600)} h`;
  return `hace ${Math.floor(diffS / 86400)} d`;
}
