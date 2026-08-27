/**
 * Formato canónico de placa en todo el proyecto: mayúsculas, solo
 * letras y números (sin guiones ni espacios) -- mismo criterio que LPR
 * ya normalizaba. 2026-08-27: antes tools/plate-reader guardaba con
 * guiones tipo "ABC-123-D"; se quitó ahí (ver _normalize en plate_ocr.py)
 * y se aplica también aquí como defensa por si el resultado llega ya
 * formateado (servicio viejo sin reiniciar, dato legado) o viene de una
 * captura manual escrita a mano por un humano.
 */
export function normalizarPlaca(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}
