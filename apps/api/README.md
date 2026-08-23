# apps/api

Backend real del proyecto (NestJS + Prisma). Reemplaza el prototipo
`tools/httphosts-probe/ingest.js` (retirado 2026-08-23).

## Qué hace

- Recibe el `POST` del teclado (`httpHosts`, cualquier ruta/método —
  mismo criterio que `ingest.js`, ver `src/ingest/`).
- Filtra ruido, guarda el cruce real en SQLite vía Prisma (`src/events/`).
- Dispara snapshot del DVR (`src/dvr/`) y llamada al lector de placas
  (`src/plate/`, le pega a `tools/plate-reader`, puerto 9300 por
  default — ese servicio corre aparte, no lo levanta este proceso).
- Expone la API REST que usa `apps/web`: `GET /api/cruces`,
  `GET /api/cruces/resumen`, `GET /api/dispositivos`,
  `PATCH /api/cruces/:id/placa`, y sirve las fotos en
  `GET /media/event-photos/:file`.

## Correr

```powershell
pnpm install          # desde la raíz del monorepo
pnpm exec prisma generate
pnpm exec prisma db push   # solo si cambia prisma/schema.prisma

# dev (recarga automática):
pnpm exec nest start --watch

# producción:
pnpm exec nest build
node dist/main.js
```

`PORT` (default 9100 en `.env` — el mismo que ya tienen configurado los
teclados en el sitio), `ISAPI_HOST/USER/PASS` (DVR) y `PLATE_SERVICE_URL`
se configuran en `.env` (copiar de `.env.example`, nunca subir el real).

## Datos

`prisma/dev.db` (SQLite) y `data/event-photos/` — ambos gitignored, PII
real de residentes. `prisma/schema.prisma` documenta por qué **no** existe
un campo `color` de vehículo (no hay capacidad de detectarlo, no se
inventó el campo — ver el handoff de diseño "Monitor de Cruces" y el
análisis de gaps en `RESUMEN.md`/`fases.md`).
