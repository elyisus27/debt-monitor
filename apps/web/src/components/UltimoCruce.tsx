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
      <div className={styles.ultimoMetaCompacta}>
        <span className={styles.ultimoKicker}>Último cruce</span>
        <span className={`${styles.ultimoPlaca} ${sinLectura ? styles.alerta : ''}`}>
          {evento.placa ?? 'SIN LECTURA'}
        </span>
        <span className="tag tag-accent">Casa {evento.casa}</span>
        <span>{evento.sentido === 'entrada' ? 'Entrada' : 'Salida'}</span>
        <span>
          {hora} · {fecha}
        </span>
        {evento.tipo && <span>{evento.tipo}</span>}
        {evento.confianza !== null && <span>OCR {evento.confianza}%</span>}
        {evento.manual && <span className="tag tag-neutral">manual</span>}
        <span className={styles.ultimoDispositivo}>{evento.dispositivo}</span>
      </div>

      <div className={styles.ultimoFotos}>
        {evento.fotos.map((f, i) => (
          <div key={f.canal} className={styles.ultimoFoto} onClick={() => onAbrir(evento, i)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt={f.etiqueta} />
            <div className={styles.ultimoFotoEtiqueta}>
              Canal {f.canal} · {f.etiqueta}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
