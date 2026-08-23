// Geometría del donut -- sin librería de gráficas, es solo trigonometría.
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function donutSlicePath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  // Círculo completo (un solo segmento): dos medios-arcos, si no el path degenera.
  if (endAngle - startAngle >= 359.99) {
    const mid = startAngle + 180;
    return [
      donutSlicePath(cx, cy, rOuter, rInner, startAngle, mid),
      donutSlicePath(cx, cy, rOuter, rInner, mid, endAngle),
    ].join(' ');
  }
  const startOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const endOuter = polarToCartesian(cx, cy, rOuter, startAngle);
  const startInner = polarToCartesian(cx, cy, rInner, endAngle);
  const endInner = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${endInner.x} ${endInner.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 1 ${startInner.x} ${startInner.y}`,
    'Z',
  ].join(' ');
}

export interface SegmentoDonut<T> {
  data: T;
  startAngle: number;
  endAngle: number;
}

/** Convierte una lista de {valor} en ángulos acumulados, dejando un hueco de
 * GAP_DEG entre segmentos (el "surface gap" de 2px entre fills que pide la
 * skill de dataviz, en grados en vez de px ya que es un arco). */
export function calcularSegmentos<T extends { valor: number }>(items: T[], gapDeg = 1.5): SegmentoDonut<T>[] {
  const total = items.reduce((s, it) => s + it.valor, 0);
  if (total === 0) return [];
  let angle = 0;
  return items.map((it) => {
    const span = (it.valor / total) * 360;
    const seg = { data: it, startAngle: angle + gapDeg / 2, endAngle: angle + span - gapDeg / 2 };
    angle += span;
    return seg;
  });
}
