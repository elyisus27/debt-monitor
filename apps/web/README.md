# apps/web

Frontend real del proyecto (Next.js + React). Reemplaza el prototipo
`tools/httphosts-probe/viewer.js` (retirado 2026-08-23).

## Qué hace

Pantalla "Monitor de Cruces" — diseño explorado con la skill `/design`
(3 direcciones mostradas al usuario, eligió la clara con tarjetas de
resumen), tokens Nocturne en `src/app/globals.css` /
`src/app/page.module.css`. Consume la API de `apps/api` vía los rewrites
de `next.config.ts` (`/api/*` y `/media/*` se reescriben al backend —
mismo origen para el navegador, sin CORS).

- Filtros (fechas — default mes actual calculado en cliente —, búsqueda,
  sentido, lectura) + KPIs calculados en el servidor.
- Panel "último cruce registrado" + ingesta en vivo por *polling* (cada
  4s, sin WebSocket/SSE — ver `src/app/page.tsx`).
- Visor flotante (`src/components/Viewer.tsx`): navegación por teclado
  con secuencia plana evento×foto (`src/lib/flatSequence.ts` — no asume 3
  fotos fijas, salida solo trae 1), captura manual de placa integrada.

## Correr

```powershell
pnpm install                # desde la raíz del monorepo

# dev (recarga automática):
pnpm exec next dev

# producción:
pnpm exec next build
pnpm exec next start
```

`NEXT_PUBLIC_API_URL` (`.env.local`, default `http://localhost:9100`) se
"hornea" en el build — si cambia el puerto/host del API, hay que correr
`next build` de nuevo, no basta con reiniciar `next start`.
