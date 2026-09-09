import type { Evento, Resumen, Filtros, UsoPorCasa } from './types';

function filtrosAQuery(f: Filtros): string {
  const params = new URLSearchParams();
  if (f.desde) params.set('desde', f.desde);
  if (f.hasta) params.set('hasta', f.hasta);
  if (f.q) params.set('q', f.q);
  if (f.dispositivo && f.dispositivo !== 'Todos') params.set('dispositivo', f.dispositivo);
  if (f.sentido && f.sentido !== 'todos') params.set('sentido', f.sentido);
  if (f.lectura && f.lectura !== 'todas') params.set('lectura', f.lectura);
  return params.toString();
}

export async function obtenerCruces(
  f: Filtros,
  pagina = 1,
): Promise<{ eventos: Evento[]; total: number; pagina: number; totalPaginas: number }> {
  const params = filtrosAQuery(f);
  const res = await fetch(`/api/cruces?${params}&page=${pagina}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/cruces: HTTP ${res.status}`);
  return res.json();
}

export async function obtenerResumen(f: Filtros): Promise<Resumen> {
  const res = await fetch(`/api/cruces/resumen?${filtrosAQuery(f)}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/cruces/resumen: HTTP ${res.status}`);
  return res.json();
}

/** El evento más reciente SIN FILTRAR -- independiente de lo que el admin esté
 * viendo en el listado, para el panel "último cruce" y el punto "en vivo". */
export async function obtenerUltimoCruce(): Promise<Evento | null> {
  const res = await fetch('/api/cruces?limit=1', { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/cruces (último): HTTP ${res.status}`);
  const data: { eventos: Evento[] } = await res.json();
  return data.eventos[0] ?? null;
}

export async function obtenerPorCasa(desde: string, hasta: string): Promise<UsoPorCasa[]> {
  const params = new URLSearchParams({ desde, hasta });
  const res = await fetch(`/api/cruces/por-casa?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/cruces/por-casa: HTTP ${res.status}`);
  return res.json();
}

export async function obtenerDispositivos(): Promise<string[]> {
  const res = await fetch('/api/dispositivos', { cache: 'no-store' });
  if (!res.ok) throw new Error(`GET /api/dispositivos: HTTP ${res.status}`);
  return res.json();
}

export async function capturarPlacaManual(id: string, placa: string): Promise<Evento> {
  const res = await fetch(`/api/cruces/${id}/placa`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placa }),
  });
  if (!res.ok) throw new Error(`PATCH /api/cruces/${id}/placa: HTTP ${res.status}`);
  return res.json();
}
