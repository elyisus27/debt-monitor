'use client';

import styles from '../app/page.module.css';
import type { Resumen, Filtros } from '../lib/types';

interface Props {
  resumen: Resumen | null;
  onCapturarPendientes: (f: Partial<Filtros>) => void;
}

export function KpiGrid({ resumen, onCapturarPendientes }: Props) {
  if (!resumen) return null;

  return (
    <div className={styles.kpis}>
      <div className={styles.kpiCard}>
        <div className={styles.kpiKicker}>Eventos del periodo</div>
        <div className={styles.kpiCifra}>{resumen.eventosDelPeriodo}</div>
        <div className={styles.kpiPie}>
          {resumen.entradas} entradas · {resumen.salidas} salidas
        </div>
      </div>

      <div className={styles.kpiCard}>
        <div className={styles.kpiKicker}>Placas leídas</div>
        <div className={styles.kpiCifra}>{resumen.placasLeidas}</div>
        <div className={styles.kpiPie}>{resumen.porcentajeLectura}% de lectura efectiva</div>
      </div>

      <div className={`${styles.kpiCard} ${styles.alerta}`}>
        <div className={styles.kpiKicker}>Placas no leídas</div>
        <div className={styles.kpiCifra}>{resumen.placasNoLeidas}</div>
        <button
          type="button"
          className="btn btn-ghost-alert"
          style={{ fontSize: 11, padding: 0 }}
          onClick={() => onCapturarPendientes({ lectura: 'sin' })}
        >
          Capturar pendientes →
        </button>
      </div>

      <div className={styles.kpiCard}>
        <div className={styles.kpiKicker}>Baja confianza</div>
        <div className={styles.kpiCifra}>{resumen.bajaConfianza}</div>
        <div className={styles.kpiPie}>bajo {resumen.umbral}% de OCR</div>
      </div>
    </div>
  );
}
