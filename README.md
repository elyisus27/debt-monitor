# debt-monitor

Auditoría de cruce de accesos de casas morosas contra Hikvision/CCTV. Este
README es solo el **cheatsheet operativo** ("¿cómo prendo esto?").

- **¿En qué vamos y qué se decidió, en español llano?** → [`RESUMEN.md`](RESUMEN.md)
- **Detalle técnico profundo** (endpoints, schemas, código) → [`developersDocs/`](developersDocs/) (mkdocs) — ver sección de abajo para correrlo.

## Entorno

**Node — vía nvm** (`.nvmrc` en la raíz pinnea `24.13.1`):

```powershell
nvm install 24.13.1
nvm use 24.13.1
node --version    # debe decir v24.13.1
```

**pnpm** (el monorepo, `apps/api` + `apps/web`, ya existe desde 2026-08-23):

```powershell
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
```

**Python — usa el launcher `py`, no `python`** (en esta máquina `python`
a secas dispara el stub de Microsoft Store, no un Python real):

```powershell
py --version         # Python 3.14.x
py -m pip --version
```

## Correr el sistema real (producción del sitio)

Tres piezas, cada una en su propia terminal:

```powershell
# 1. API (NestJS + Prisma) -- recibe eventos del teclado, captura fotos, guarda todo
cd apps\api
node dist\main.js          # PORT viene de apps/api/.env -- 9100 en el sitio real

# 2. Frontend (Next.js) -- la pantalla
cd apps\web
pnpm exec next start        # puerto 3000

# 3. Lector de placas (Python, servicio aparte -- apps/api le pega a este)
cd tools\plate-reader
C:\Users\lares\lpr-caseta\.venv\Scripts\python.exe service.py 9300
```

Para desarrollar con recarga automática: `pnpm exec nest start --watch`
(en `apps/api`) y `pnpm exec next dev` (en `apps/web`) en vez de los
comandos de arriba — pero antes de compilar para producción (`nest build`
+ `next build`), revisa `apps/api/.env` y `apps/web/.env.local`: el puerto
del API queda "horneado" en el build de `apps/web`, así que si cambia hay
que recompilar, no solo reiniciar.

`tools/httphosts-probe/ingest.js` y `viewer.js` (el prototipo original de
Fase 1-4) ya no existen — los reemplaza lo de arriba. `listener.js` sigue
ahí como herramienta de depuración de bajo nivel (dump crudo), ver
[`tools/httphosts-probe/README.md`](tools/httphosts-probe/README.md).

## Documentación técnica (mkdocs)

El `mkdocs.yml` vive dentro de `developersDocs/`, no en la raíz — por eso
el comando lleva `-f`:

```powershell
py -m mkdocs serve -f developersDocs/mkdocs.yml
```

Abre **http://127.0.0.1:8000**. `Ctrl+C` para detenerlo.

Si hace falta instalar el tema (primera vez en una máquina nueva):

```powershell
py -m pip install --user mkdocs-material
```

## Estructura del repo

```
debt-monitor/
  apps/
    api/                    # NestJS + Prisma -- ingesta de eventos, fotos DVR, API real
    web/                    # Next.js + React -- la pantalla (filtros, KPIs, visor, captura manual)
  developersDocs/           # mkdocs -- arquitectura, hallazgos, fases
  docs/hikvision/           # manuales oficiales ISAPI + hccgw OpenAPI
  tools/
    httphosts-probe/        # runbook de alta del teclado + listener.js de depuración
    dvr-video/               # recuperador de clips ISAPI (sin usar activamente, ver hallazgos)
    plate-reader/            # servicio Python de lectura de placa (usado por apps/api)
```

## Estado

Ver [`developersDocs/docs/fases.md`](developersDocs/docs/fases.md) — resumen
corto: Fases 0-4 cerradas (investigación, recepción de eventos, modelo de
datos, fotos CCTV, lectura de placa) — corridas y confirmadas contra el
sitio real, ya en producción sobre `apps/api`+`apps/web`. Sigue Fase 5
(padrón: qué auto(s) pertenecen a cada casa, detectar visitas coladas).
