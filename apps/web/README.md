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

## Desplegar un cambio de frontend (servicio `debt-web`)

En producción `apps/web` corre como servicio de Windows (`debt-web`, NSSM —
ver `developersDocs/docs/arquitectura.md`). `next start` lee `.next/` **al
arrancar** y sirve los assets estáticos (`/_next/static/*`) por ruta desde
esa carpeta. Por eso, cada vez que se toca el frontend son **dos pasos, en
este orden**:

```powershell
pnpm exec next build            # regenera .next/ con un BUILD_ID nuevo
nssm restart debt-web           # el servicio recoge el build nuevo
```

Reiniciar sin buildear no sirve. Y correr `next dev` o un `next build` a
medias en esta carpeta deja `.next/` en un estado que el servicio viejo ya
no puede servir: la página HTML responde 200 pero **todos los CSS/JS dan
HTTP 400**, y el sitio se ve sin estilos y sin interactividad (atascado en
"Cargando…") igual en PC que en celular. Recuperación:

```powershell
Remove-Item -Recurse -Force .next
pnpm exec next build
nssm restart debt-web
```

(Incidente real 2026-08-27: 4 días sirviendo un build roto antes de que se
notara — "el sitio no me responde ni en formato pc ni en formato celular".)
