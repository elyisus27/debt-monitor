'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import styles from './page.module.css';
import { DonutChart } from '../../components/DonutChart';
import { obtenerPorCasa } from '../../lib/api';
import { rangoMesActual } from '../../lib/dates';
import type { UsoPorCasa } from '../../lib/types';

export default function Estadisticas() {
  const [rango, setRango] = useState(rangoMesActual);
  const [datos, setDatos] = useState<UsoPorCasa[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    obtenerPorCasa(rango.desde, rango.hasta)
      .then(setDatos)
      .catch((err) => console.error('Error cargando estadísticas:', err))
      .finally(() => setCargando(false));
  }, [rango]);

  return (
    <main className={styles.pagina}>
      <header className={styles.encabezado}>
        <div className={styles.brand}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9184d9" strokeWidth="1.8">
            <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
          </svg>
          debt-monitor
        </div>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navLink}>
            Cruces
          </Link>
          <Link href="/estadisticas" className={`${styles.navLink} ${styles.navLinkActivo}`}>
            Estadísticas
          </Link>
        </nav>
      </header>

      <div className={styles.titulo}>Uso de NIP por casa</div>

      <div className={styles.filtros}>
        <div className="field">
          <label>Desde</label>
          <input
            type="date"
            className="input"
            style={{ width: 150 }}
            value={rango.desde}
            onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input
            type="date"
            className="input"
            style={{ width: 150 }}
            value={rango.hasta}
            onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))}
          />
        </div>
      </div>

      <div className={styles.tarjetaChart}>
        <h5>Cruces por casa {cargando && '· cargando…'}</h5>
        <DonutChart datos={datos} />
      </div>

      <div className={styles.tarjetaChart}>
        <h5>Detalle completo ({datos.length} casas)</h5>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th>Casa</th>
              <th>Cruces</th>
              <th>Vehículos vistos</th>
            </tr>
          </thead>
          <tbody>
            {datos.map((d) => (
              <tr key={d.casa}>
                <td className={styles.casa}>{d.casa}</td>
                <td>{d.total}</td>
                <td className={styles.vehiculos}>
                  {d.vehiculos.length > 0
                    ? d.vehiculos.map((v) => `${v.placa} (${v.veces}×)`).join('  ·  ')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
