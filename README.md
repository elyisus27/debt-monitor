# debt-monitor

Auditoría de cruce de accesos de casas morosas contra Hikvision/CCTV. Este
README es solo el **cheatsheet operativo** ("¿cómo prendo esto?"). Para
arquitectura, hallazgos y roadmap real, ver
[`developersDocs/`](developersDocs/) (mkdocs) — ver sección de abajo para
correrlo.

## Entorno

**Node — vía nvm** (`.nvmrc` en la raíz pinnea `24.13.1`):

```powershell
nvm install 24.13.1
nvm use 24.13.1
node --version    # debe decir v24.13.1
```

> Nota: `nvm-windows` está instalado en esta máquina pero, al momento de
> escribir esto, no tenía ninguna versión gestionada por él — el `node`
> global venía de un instalador standalone en `Program Files`. Corriendo
> `nvm use 24.13.1` arriba, nvm toma el control de ese mismo path y ya
> queda gestionado. Si en el futuro `nvm current` no coincide con lo de
> `.nvmrc`, corre el bloque de arriba de nuevo.

**Python — usa el launcher `py`, no `python`** (en esta máquina `python`
a secas dispara el stub de Microsoft Store, no un Python real):

```powershell
py --version         # Python 3.14.x
py -m pip --version
```

**pnpm** — todavía no aplica, el monorepo (`apps/`, `pnpm-workspace.yaml`)
se scaffoldea al cerrar la Fase 1 (ver `developersDocs/docs/fases.md`).
Cuando exista, se instala con `corepack enable` (viene con Node 24) o
`npm install -g pnpm`.

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

## Probar la recepción de eventos del teclado (Fase 1, en LAN)

```powershell
cd tools\httphosts-probe
node listener.js 9099
```

Runbook completo (comandos `curl` de alta/test contra el teclado) en
[`tools/httphosts-probe/README.md`](tools/httphosts-probe/README.md).
Detalle narrativo + diagramas en
[`developersDocs/docs/fase1-recepcion-eventos.md`](developersDocs/docs/fase1-recepcion-eventos.md)
(o navegando ahí mismo desde el mkdocs corriendo).

## Estructura del repo

```
debt-monitor/
  developersDocs/          # mkdocs — arquitectura, hallazgos, fases
  docs/hikvision/           # manuales oficiales ISAPI + hccgw OpenAPI
  tools/httphosts-probe/    # herramienta de prueba de Fase 1
  apps/                      # (aún no existe) api (NestJS) + web (Next.js)
```

## Estado

Ver [`developersDocs/docs/fases.md`](developersDocs/docs/fases.md) —
resumen corto: Fase 0 (investigación), Fase 1 (recepción de eventos) y
Fase 2 (parseo + modelo de datos) cerradas — corridas y confirmadas contra
los 2 teclados reales del sitio (schema real en
[`hallazgos-hikvision.md`](developersDocs/docs/hallazgos-hikvision.md),
detalle del parser/modelo en
[`fase2-parseo-modelo-datos.md`](developersDocs/docs/fase2-parseo-modelo-datos.md)).
Sigue Fase 3 (disparo de capturas CCTV).
