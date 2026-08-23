'use client';

import styles from '../app/page.module.css';
import type { Evento } from '../lib/types';
import { formatFechaHora } from '../lib/dates';

interface Props {
  evento: Evento | null;
  onAbrir: (ev: Evento, fotoIndex: number) => void;
}

export function UltimoCruce({ evento, onAbrir }: Props) {
  if (!evento) {
    return (
      <div className={styles.ultimoCruce}>
        <span className={styles.ultimoVacio}>Sin cruces registrados todavía.</span>
      </div>
    );
  }

  const { hora, fecha } = formatFechaHora(evento.timestamp);
  const sinLectura = !evento.placa;

  return (
    <div className={styles.ultimoCruce}>
      <div>
        <div className={styles.ultimoKicker}>Último cruce registrado</div>
        <div className={`${styles.ultimoPlaca} ${sinLectura ? styles.alerta : ''}`}>
          {evento.placa ?? 'SIN LECTURA'}
        </div>
        <div className={styles.ultimoMetaFila}>
          <span className="tag tag-accent">Casa {evento.casa}</span>
          <span>{evento.sentido === 'entrada' ? 'Entrada' : 'Salida'}</span>
          <span>
            {hora} · {fecha}
          </span>
          {evento.tipo && <span>{evento.tipo}</span>}
        </div>
        <div className={styles.ultimoDispositivo}>
          {evento.dispositivo}
          {evento.confianza !== null && ` · OCR ${evento.confianza}%`}
          {evento.manual && ' · manual'}
        </div>
      </div>

      <div className={styles.ultimoFotos}>
        {evento.fotos.map((f, i) => (
          <div key={f.canal}>
            <div className={styles.ultimoFoto} onClick={() => onAbrir(evento, i)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.etiqueta} />
            </div>
            <div className={styles.ultimoFotoEtiqueta}>
              Canal {f.canal} · {f.etiqueta}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
