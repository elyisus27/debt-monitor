'use client';

import styles from '../app/page.module.css';
import type { Filtros } from '../lib/types';
import { rangoMesActual } from '../lib/dates';

interface Props {
  filtros: Filtros;
  onChange: (f: Filtros) => void;
}

export function FilterBar({ filtros, onChange }: Props) {
  const set = <K extends keyof Filtros>(k: K, v: Filtros[K]) => onChange({ ...filtros, [k]: v });

  const limpiar = () => {
    onChange({ ...rangoMesActual(), q: '', dispositivo: 'Todos', sentido: 'todos', lectura: 'todas' });
  };

  return (
    <div className={styles.filtros}>
      <div className={`${styles.field} field ${styles.campoFecha}`}>
        <label>Desde</label>
        <input
          type="date"
          className="input"
          value={filtros.desde}
          onChange={(e) => set('desde', e.target.value)}
        />
      </div>
      <div className={`${styles.field} field ${styles.campoFecha}`}>
        <label>Hasta</label>
        <input
          type="date"
          className="input"
          value={filtros.hasta}
          onChange={(e) => set('hasta', e.target.value)}
        />
      </div>
      <div className={`${styles.field} field ${styles.campoBusqueda}`}>
        <label>Placa o casa</label>
        <input
          type="search"
          className="input"
          placeholder="JHT-40 · 1012-03"
          value={filtros.q}
          onChange={(e) => set('q', e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label>Sentido</label>
        <div className="seg">
          {(['todos', 'entrada', 'salida'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="seg-opt"
              aria-pressed={filtros.sentido === s}
              onClick={() => set('sentido', s)}
            >
              {s === 'todos' ? 'Todos' : s === 'entrada' ? 'Entradas' : 'Salidas'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.field}>
        <label>Lectura</label>
        <div className="seg">
          {(
            [
              ['todas', 'Todas'],
              ['sin', 'Sin lectura'],
              ['baja', 'Baja confianza'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              className="seg-opt"
              aria-pressed={filtros.lectura === v}
              onClick={() => set('lectura', v)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className={`btn btn-ghost ${styles.limpiar}`} onClick={limpiar}>
        Limpiar filtros
      </button>
    </div>
  );
}
