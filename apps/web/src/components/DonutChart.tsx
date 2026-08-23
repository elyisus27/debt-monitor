'use client';

import { useState } from 'react';
import styles from './DonutChart.module.css';
import { calcularSegmentos, donutSlicePath } from '../lib/donut';
import type { UsoPorCasa } from '../lib/types';

// Paleta categórica validada (dataviz skill, columna oscura) -- pasa lightness
// band, chroma floor, separación CVD y contraste contra superficie oscura.
// "Otras" usa un gris neutro (no una hoja categórica más) a propósito: es un
// cajón de sastre, no una categoría real -- se le quita presencia visual.
const COLORES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
const COLOR_OTRAS = '#75798c';
const MAX_SEGMENTOS = 6; // + "Otras" = 7, dentro del límite de la skill (≤6-7 legible)

interface Props {
  datos: UsoPorCasa[];
}

interface Slot {
  casa: string;
  valor: number;
  color: string;
  vehiculos: { placa: string; veces: number }[];
  // Para "Otras": desglose por casa en vez de por vehículo.
  casasPlegadas?: { casa: string; total: number }[];
}

export function DonutChart({ datos }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const ordenado = [...datos].sort((a, b) => b.total - a.total);
  const top = ordenado.slice(0, MAX_SEGMENTOS);
  const resto = ordenado.slice(MAX_SEGMENTOS);

  const slots: Slot[] = top.map((c, i) => ({
    casa: c.casa,
    valor: c.total,
    color: COLORES[i],
    vehiculos: c.vehiculos,
  }));
  if (resto.length > 0) {
    slots.push({
      casa: 'Otras',
      valor: resto.reduce((s, c) => s + c.total, 0),
      color: COLOR_OTRAS,
      vehiculos: [],
      casasPlegadas: resto.map((c) => ({ casa: c.casa, total: c.total })).sort((a, b) => b.total - a.total),
    });
  }

  const total = slots.reduce((s, x) => s + x.valor, 0);
  const segmentos = calcularSegmentos(slots.map((s) => ({ ...s, valor: s.valor })));

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 92;
  const rInner = 56;

  if (total === 0) {
    return <p className="text-muted">Sin cruces en este rango.</p>;
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.svgWrap} style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segmentos.map((seg) => (
            <path
              key={seg.data.casa}
              d={donutSlicePath(cx, cy, rOuter, rInner, seg.startAngle, seg.endAngle)}
              fill={seg.data.color}
              className={`${styles.slice} ${hover && hover !== seg.data.casa ? styles.atenuada : ''}`}
              onMouseEnter={() => setHover(seg.data.casa)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className={styles.centro}>
          <div className={styles.centroCifra}>{hover ? slots.find((s) => s.casa === hover)?.valor : total}</div>
          <div className={styles.centroPie}>{hover ? hover : 'cruces totales'}</div>
        </div>
      </div>

      <div className={styles.leyenda}>
        {slots.map((s) => (
          <div key={s.casa}>
            <div
              className={`${styles.filaLeyenda} ${hover === s.casa ? styles.activa : ''}`}
              onMouseEnter={() => setHover(s.casa)}
              onMouseLeave={() => setHover(null)}
            >
              <span className={styles.punto} style={{ background: s.color }} />
              <span className={styles.leyendaCasa}>{s.casa === 'Otras' ? 'Otras casas' : s.casa}</span>
              <span className={styles.leyendaTotal}>{s.valor}</span>
            </div>
            {hover === s.casa && (
              <div className={styles.detalle}>
                {s.casasPlegadas ? (
                  s.casasPlegadas.map((c) => (
                    <div key={c.casa} className={styles.detalleFila}>
                      <span>{c.casa}</span>
                      <span>{c.total}</span>
                    </div>
                  ))
                ) : s.vehiculos.length > 0 ? (
                  s.vehiculos.map((v) => (
                    <div key={v.placa} className={styles.detalleFila}>
                      <span>{v.placa}</span>
                      <span>{v.veces}×</span>
                    </div>
                  ))
                ) : (
                  <span className={styles.detalleVacio}>sin placas leídas en este rango</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
