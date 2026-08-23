'use client';

import styles from '../app/page.module.css';
import type { Evento } from '../lib/types';
import { formatFechaHora, tiempoRelativo } from '../lib/dates';

interface Props {
  eventos: Evento[];
  total: number;
  desde: string;
  hasta: string;
  umbral: number;
  cargando: boolean;
  selIndex?: number;
  onAbrirEvento?: (ev: Evento, canalIndex: number) => void;
  onCapturarSinLectura?: (ev: Evento) => void;
}

export function EventsTable({
  eventos,
  total,
  desde,
  hasta,
  umbral,
  cargando,
  selIndex,
  onAbrirEvento,
  onCapturarSinLectura,
}: Props) {
  return (
    <div className={styles.listado}>
      <div className={styles.listadoCabecera}>
        <h5>Listado de cruces</h5>
        <span className={styles.listadoSubtitulo}>
          {total} evento{total === 1 ? '' : 's'} · {desde} – {hasta}
        </span>
        <span className={styles.listadoPista}>↑↓ recorrer · Enter abrir</span>
      </div>

      <div className={styles.scrollTabla}>
        <table className={styles.tabla}>
          <thead>
            <tr>
              <th style={{ width: 120 }}>Fecha / hora</th>
              <th style={{ width: 96 }}>Casa</th>
              <th style={{ width: 92 }}>Sentido</th>
              <th style={{ width: 150 }}>Placa</th>
              <th style={{ width: 78 }}>OCR</th>
              <th style={{ width: 150 }}>Vehículo</th>
              <th style={{ width: 200 }}>Canales</th>
              <th>Dispositivo</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((ev, i) => {
              const { hora, fecha } = formatFechaHora(ev.timestamp);
              // "sin lectura" (rojo, botón de captura) solo aplica a entrada -- ahí sí
              // intentamos leer placa. Salida nunca tiene cámara de placas (ver
              // hallazgos-hikvision.md); marcarla en rojo implicaría una falla que
              // no existe, es simplemente "no aplica".
              const sinLectura = ev.sentido === 'entrada' && !ev.placa;
              const bajo = ev.confianza !== null && ev.confianza < umbral;

              return (
                <tr
                  key={ev.id}
                  className={`${styles.fila} ${sinLectura ? styles.filaSinLectura : ''} ${
                    i === selIndex ? styles.filaSeleccionada : ''
                  }`}
                  onClick={() => onAbrirEvento?.(ev, 0)}
                >
                  <td>
                    <div className={styles.colFecha}>{hora}</div>
                    <div className={styles.colFechaRel}>
                      {fecha} · {tiempoRelativo(ev.timestamp)}
                    </div>
                  </td>
                  <td className={styles.colCasa}>{ev.casa}</td>
                  <td className={ev.sentido === 'entrada' ? styles.colSentidoEntrada : styles.colSentidoSalida}>
                    {ev.sentido === 'entrada' ? '↓ entrada' : '↑ salida'}
                  </td>
                  <td>
                    {sinLectura ? (
                      <button
                        type="button"
                        className={styles.botonSinLectura}
                        onClick={(e) => {
                          e.stopPropagation();
                          onCapturarSinLectura?.(ev);
                        }}
                      >
                        SIN LECTURA
                      </button>
                    ) : !ev.placa ? (
                      <span className={styles.colVehiculo}>—</span>
                    ) : (
                      <span className={styles.colPlaca}>
                        {ev.placa}
                        {ev.manual && (
                          <span className="tag tag-neutral" style={{ marginLeft: 8 }}>
                            manual
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className={`${styles.colOcr} ${bajo ? styles.colOcrBaja : styles.colOcrOk}`}>
                    {ev.manual ? 'manual' : ev.confianza !== null ? `${ev.confianza}%` : '—'}
                  </td>
                  <td className={styles.colVehiculo}>{ev.tipo ?? '—'}</td>
                  <td>
                    <div className={styles.canales}>
                      {ev.fotos.map((f, i) => (
                        <div
                          key={f.canal}
                          className={styles.canalThumb}
                          onClick={(e) => {
                            e.stopPropagation();
                            onAbrirEvento?.(ev, i);
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={f.url} alt={f.etiqueta} loading="lazy" />
                          <span className={styles.canalEtiqueta}>CH{f.canal}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className={styles.colDispositivo}>{ev.dispositivo ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {cargando && <div className={styles.cargando}>Cargando…</div>}
        {!cargando && eventos.length === 0 && (
          <div className={styles.vacio}>Ningún cruce coincide con estos filtros.</div>
        )}
      </div>
    </div>
  );
}
