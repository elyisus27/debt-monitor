// Espejo de EventoDto / resumen en apps/api/src/events/events.service.ts.
// "color" no existe -- no se inventa el campo (ver handoff de diseño y el
// análisis de gaps antes de empezar esta fase).

export interface Foto {
  canal: number;
  url: string;
  etiqueta: string;
}

export interface Evento {
  id: string;
  timestamp: string;
  casa: string;
  sentido: 'entrada' | 'salida';
  placa: string | null;
  confianza: number | null; // 0-100
  manual: boolean;
  tipo: string | null;
  dispositivo: string | null;
  fotos: Foto[];
}

export interface Resumen {
  eventosDelPeriodo: number;
  entradas: number;
  salidas: number;
  placasLeidas: number;
  porcentajeLectura: number;
  placasNoLeidas: number;
  bajaConfianza: number;
  umbral: number;
}

export interface Filtros {
  desde: string;
  hasta: string;
  q: string;
  dispositivo: string;
  sentido: 'todos' | 'entrada' | 'salida';
  lectura: 'todas' | 'sin' | 'baja';
}
