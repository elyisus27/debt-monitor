'use client';

import styles from '../app/page.module.css';
import type { Evento } from '../lib/types';
import { formatFechaHora, tiempoRelativo } from '../lib/dates';

interface Props {
  eventos: Evento[];
  total: number;
  pagina: number;
  totalPaginas: number;
  onCambiarPagina: (pagina: number) => void;
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
  pagina,
  totalPaginas,
  onCambiarPagina,
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
              <th className={styles.thFechaHora}>Fecha / hora</th>
              <th className={styles.thCasa}>Casa</th>
              <th className={`${styles.thSentido} ${styles.ocultarEnMovil}`}>Sentido</th>
              <th className={styles.thPlaca}>Placa</th>
              <th className={`${styles.thOcr} ${styles.ocultarEnMovil}`}>OCR</th>
              <th className={`${styles.thVehiculo} ${styles.ocultarEnMovil}`}>Vehículo</th>
              <th className={styles.thCanales}>Canales</th>
              <th className={styles.ocultarEnMovil}>Dispositivo</th>
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
              // Fila 0 = el cruce más reciente -- ya no hay panel aparte para eso
              // (era redundante con esta misma fila), así que esta fila se
              // distingue con texto más marcado y la leyenda del canal debajo de
              // la foto en vez de encimada.
              const esUltimo = i === 0;

              return (
                <tr
                  key={ev.id}
                  className={`${styles.fila} ${sinLectura ? styles.filaSinLectura : ''} ${
                    i === selIndex ? styles.filaSeleccionada : ''
                  } ${esUltimo ? styles.filaUltima : ''}`}
                  onClick={() => onAbrirEvento?.(ev, 0)}
                >
                  <td>
                    <div className={styles.colFecha}>{hora}</div>
                    <div className={styles.colFechaRel}>
                      {fecha} · {tiempoRelativo(ev.timestamp)}
                    </div>
                  </td>
                  <td className={styles.colCasa}>{ev.casa}</td>
                  <td
                    className={`${styles.ocultarEnMovil} ${
                      ev.sentido === 'entrada' ? styles.colSentidoEntrada : styles.colSentidoSalida
                    }`}
                  >
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
                          <span className={`tag tag-neutral ${styles.etiquetaManual}`}>manual</span>
                        )}
                      </span>
                    )}
                  </td>
                  <td
                    className={`${styles.ocultarEnMovil} ${styles.colOcr} ${
                      bajo ? styles.colOcrBaja : styles.colOcrOk
                    }`}
                  >
                    {ev.manual ? 'manual' : ev.confianza !== null ? `${ev.confianza}%` : '—'}
                  </td>
                  <td className={`${styles.ocultarEnMovil} ${styles.colVehiculo}`}>{ev.tipo ?? '—'}</td>
                  <td>
                    <div className={styles.canales}>
                      {ev.fotos.map((f, i) =>
                        esUltimo ? (
                          <div
                            key={f.canal}
                            className={`${styles.canalThumbConLeyenda} ${
                              f.etiqueta === 'Placas' ? styles.canalPlaca : ''
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAbrirEvento?.(ev, i);
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={f.url} alt={f.etiqueta} loading="lazy" />
                            <span className={styles.canalLeyendaAbajo}>{f.etiqueta}</span>
                          </div>
                        ) : (
                          <div
                            key={f.canal}
                            className={`${styles.canalThumb} ${f.etiqueta === 'Placas' ? styles.canalPlaca : ''}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAbrirEvento?.(ev, i);
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={f.url} alt={f.etiqueta} loading="lazy" />
                            <span className={styles.canalEtiqueta}>CH{f.canal}</span>
                          </div>
                        ),
                      )}
                    </div>
                  </td>
                  <td className={`${styles.ocultarEnMovil} ${styles.colDispositivo}`}>{ev.dispositivo ?? '—'}</td>
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

      {totalPaginas > 1 && (
        <div className={styles.paginacion}>
          <button
            type="button"
            className={styles.paginacionBoton}
            disabled={pagina <= 1}
            onClick={() => onCambiarPagina(1)}
          >
            « Primera
          </button>
          <button
            type="button"
            className={styles.paginacionBoton}
            disabled={pagina <= 1}
            onClick={() => onCambiarPagina(pagina - 1)}
          >
            ‹ Anterior
          </button>
          <span className={styles.paginacionTexto}>
            Página {pagina} de {totalPaginas}
          </span>
          <button
            type="button"
            className={styles.paginacionBoton}
            disabled={pagina >= totalPaginas}
            onClick={() => onCambiarPagina(pagina + 1)}
          >
            Siguiente ›
          </button>
          <button
            type="button"
            className={styles.paginacionBoton}
            disabled={pagina >= totalPaginas}
            onClick={() => onCambiarPagina(totalPaginas)}
          >
            Última »
          </button>
        </div>
      )}
    </div>
  );
}
