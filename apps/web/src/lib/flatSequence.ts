import type { Evento } from './types';

export interface PosicionPlana {
  eventoId: string;
  fotoIndex: number;
}

/** Secuencia plana evento×foto, en el mismo orden que la lista (más reciente
 * primero). NO asume 3 fotos fijas por evento -- salida solo trae 1, por
 * ejemplo -- se arma de las fotos que cada evento realmente tiene. */
export function construirSecuenciaPlana(eventos: Evento[]): PosicionPlana[] {
  const flat: PosicionPlana[] = [];
  for (const ev of eventos) {
    ev.fotos.forEach((_, i) => flat.push({ eventoId: ev.id, fotoIndex: i }));
  }
  return flat;
}

function indiceDe(seq: PosicionPlana[], pos: PosicionPlana | null): number {
  if (!pos) return -1;
  return seq.findIndex((p) => p.eventoId === pos.eventoId && p.fotoIndex === pos.fotoIndex);
}

/** ← = hacia lo más reciente (índice-1) · → = hacia lo más antiguo (índice+1).
 * Sin ciclo: se detiene en los extremos (regresa la misma posición). */
export function moverEnSecuencia(seq: PosicionPlana[], actual: PosicionPlana, delta: -1 | 1): PosicionPlana {
  const i = indiceDe(seq, actual);
  if (i === -1) return actual;
  const siguiente = i + delta;
  if (siguiente < 0 || siguiente >= seq.length) return actual;
  return seq[siguiente];
}

export function posicionTexto(seq: PosicionPlana[], actual: PosicionPlana, totalEventos: number): string {
  const i = indiceDe(seq, actual);
  if (i === -1) return '';
  // "evento N de M" cuenta eventos únicos hasta este punto, no fotos.
  const eventosVistos = new Set(seq.slice(0, i + 1).map((p) => p.eventoId)).size;
  return `evento ${eventosVistos} de ${totalEventos} · foto ${actual.fotoIndex + 1}/${
    seq.filter((p) => p.eventoId === actual.eventoId).length
  }`;
}
