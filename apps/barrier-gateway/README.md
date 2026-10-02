# `@debt-monitor/barrier-gateway`

Worker que corre en la PC de caseta (LAN). Es hoy el **único punto de entrada desde
internet** para varias cosas de este proyecto — no solo la pluma, ver "Fotos de
visitas" abajo — vía el mismo túnel Cloudflare y el mismo token compartido, a
propósito: crecer un solo gateway ya expuesto/ya auditado es más manejable que un
proceso+túnel+token nuevo por cada capacidad. El nombre quedó corto (nació siendo
solo la pluma) — pendiente re-evaluarlo cuando el alcance real se estabilice, no
antes (decisión del usuario, 2026-09-17).

Función original: recibe la orden de "abrir la pluma" por **push directo** de la
Vistara API y dispara el GPIO del **tótem CondoVive** localmente. Si el push no
llega (túnel caído), la pluma no abre y el guardia lo ve en la web. El poll de
respaldo (`GET /barrier/poll`) se eliminó el 2026-10-02: mantenía despiertos a
Neon y Cloud Run las 24 horas (ver `vistara/CLAUDE.md` § COSTOS).

**El proceso en sí no expone ningún puerto a la LAN ni a internet.** El servidor
escucha solo en `127.0.0.1` — es `cloudflared` (proceso aparte, con Cloudflare
Access de por medio) quien decide qué tráfico de internet llega ahí. Nunca se abre
ningún puerto en el router ni se reenvía nada.

Vive en el monorepo de `debt-monitor` por comodidad de git/tooling, pero es su
**propio proceso** y su **propio servicio de Windows** — no comparte nada en runtime
con `apps/api`.

Registro de decisión completo (contexto histórico, incluye la primera versión
solo-poll y por qué se reconsideró): `vistara-docs/docs/apertura-pluma-remota.md`
(repo hermano) y CLAUDE.md § DECISIONES DE DISEÑO — FASE 1AM, punto 6, en `vistara`.

## Cómo funciona

```
Vistara Web (visitas / morosos)
  │  POST /barrier/open
  ▼
Vistara API → BarrierCommand (bitácora: DONE si abrió, FAILED si no)
  │
  │  push síncrono, 3 intentos de 3s (BARRIER_PUSH_URL)
  ▼
Cloudflare Tunnel (cloudflared, en esta PC) ──► este worker, POST /push (127.0.0.1)
  │                                              │
  │  { opened: true/false }                      ├─ anti-rebote (BARRIER_MIN_INTERVAL_MS)
  ◄──────────────────────────────────────────────┤
                                                  └─ POST al GPIO del tótem (192.168.196.1:3001)
```

No hay cola ni ack: el push confirma en su propia respuesta HTTP.

## Fotos de visitas (2026-09-17)

Dos rutas más en el MISMO servidor de push (mismo puerto, mismo `PUSH_TOKEN`,
mismo hostname `barrier-push.condominioreserva.com` — sin tunel/token/hostname
nuevos). Ninguna toca el DVR ni la DB directamente, solo relayan en LAN hacia
`apps/api` (`API_BASE_URL`, ver `.env.example`):

```
Vistara API
  │  POST https://barrier-push.condominioreserva.com/capture-photos
  │  { visitId, tenantId, plate }, header X-Push-Token
  ▼
Cloudflare Tunnel ──► este worker, POST /capture-photos (127.0.0.1)
  │                     └─ valida X-Push-Token (mismo de siempre) → relay
  ▼
apps/api  POST /api/guard-photos/capture-request (127.0.0.1:9100)
            responde 202 de inmediato, captura en 2do plano

...más tarde, sin relación de tiempo, apps/api habla directo a Vistara
(GuardPhotosSyncService) -- eso NO pasa por este worker.

Vistara API (para mostrar una foto en su web, en cualquier momento)
  │  GET https://barrier-push.condominioreserva.com/photo/:kind/:file
  │  header X-Push-Token
  ▼
Cloudflare Tunnel ──► este worker, GET /photo/:kind/:file (127.0.0.1)
  │                     └─ valida X-Push-Token → relay
  ▼
apps/api  GET /api/vistara-photos/:kind/:file (127.0.0.1:9100)
            sirve el JPEG real (kind=keypad|guard)
```

Contrato completo del lado de Vistara: CLAUDE.md (repo `vistara`) §
"DECISIONES DE DISEÑO — FOTOS DE VISITAS (debt-monitor)".

## Configuración — `.env`

Ver [`.env.example`](.env.example). Lo esencial:

| Variable | |
|---|---|
| `TOTEM_GPIO_URL` | endpoint GPIO del tótem — el mismo que usa `lpr-caseta/src/totem_gpio.py` |
| `BARRIER_MIN_INTERVAL_MS` | anti-rebote, `4000` |
| `PUSH_PORT` | puerto local (`127.0.0.1`) donde escucha el servidor de push, `8787` |
| `PUSH_TOKEN` | secreto compartido con `BARRIER_PUSH_TOKEN` del lado de Vistara. Obligatorio: sin él el proceso no arranca |
| `API_BASE_URL` | `http://127.0.0.1:9100` — `apps/api` en esta misma PC, usado por las rutas de fotos |

## Log

Una línea JSON por evento a stdout (`{ ts, outcome, ... }`):
`push_listening` · `push_abierto` · `push_rechazado_rebote` · `push_totem_error` ·
`push_error` (pluma) — `capture_relayed` ·
`capture_rejected` · `capture_401` · `capture_api_error` (captura de fotos) ·
`photo_served` · `photo_not_found` · `photo_401` · `photo_api_error` (servir foto).
La bitácora de "quién abrió y por qué" vive en Vistara (el `actorUserId` y el audit
log), no aquí — este worker solo dispara el pulso / relaya.

## Correr

```powershell
pnpm install
cp apps/barrier-gateway/.env.example apps/barrier-gateway/.env   # y rellenar
pnpm --filter @debt-monitor/barrier-gateway build
node apps/barrier-gateway/dist/main.js
```

### Servicio de Windows (NSSM) — mismo patrón que `debt-api` / `debt-web` / `debt-plate-reader`

```powershell
nssm install barrier-gateway "C:\Program Files\nodejs\node.exe" "C:\...\debt-monitor\apps\barrier-gateway\dist\main.js"
nssm set barrier-gateway AppDirectory "C:\...\debt-monitor\apps\barrier-gateway"
nssm set barrier-gateway AppStdout "C:\...\debt-monitor\logs\barrier-gateway.log"
nssm set barrier-gateway AppStderr "C:\...\debt-monitor\logs\barrier-gateway.log"
nssm set barrier-gateway AppRotateFiles 1
nssm set barrier-gateway Start SERVICE_AUTO_START
nssm start barrier-gateway
```

### Túnel Cloudflare (`cloudflared`) — camino de push

Corre como proceso/servicio APARTE en esta misma PC (no lo levanta este worker).

```powershell
# En la PC de producción, por SSH:
cloudflared tunnel login
cloudflared tunnel create barrier-push
cloudflared tunnel route dns barrier-push barrier-push.condominioreserva.com
```

Config del túnel (`config.yml`, junto al de `cloudflared`) — apunta al puerto local
del push server:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: <ruta al .json que generó `tunnel create`>
ingress:
  - hostname: barrier-push.condominioreserva.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

Proteger el hostname con **Cloudflare Access** (política de service token, no login
humano) para que solo Vistara pueda llegar ahí — el `X-Push-Token` de este worker es
la segunda capa, no la única.

`nssm install cloudflared "C:\...\cloudflared.exe" "tunnel run barrier-push"` — mismo
patrón NSSM que el resto de servicios de esta PC.

## Pendiente antes de producción

- [ ] Generar `PUSH_TOKEN` (cadena aleatoria larga) y ponerlo aquí Y en
      `BARRIER_PUSH_TOKEN` del lado de Vistara (Secret Manager de `vistara-api`).
- [ ] Instalar `cloudflared`, crear el túnel `barrier-push`, apuntar
      `barrier-push.condominioreserva.com` → `http://127.0.0.1:8787`, proteger con
      Cloudflare Access (ver arriba).
- [ ] Confirmar que este host alcanza el GPIO del tótem
      (`curl -X POST http://192.168.196.1:3001/devices/gpio/<adb_device>`).
- [ ] `pnpm --filter @debt-monitor/barrier-gateway build` + `node dist/main.js`
      contra la API real; probar el botón desde Vistara Web (módulo de visitas) y
      confirmar en el log `push_abierto` (no `push_rechazado_rebote`).
- [ ] `nssm install barrier-gateway` (auto-start) + `nssm install cloudflared`.

## Pendiente para fotos de visitas (aparte de lo de arriba)

Nada de túnel/Access/token nuevo -- reusa todo lo ya listado arriba. Solo:

- [ ] `prisma db push` en `apps/api` (tabla `guard_visit_photos` nueva).
- [ ] Rebuild + restart de ESTE servicio (`barrier-gateway`), no uno nuevo:
      `pnpm --filter @debt-monitor/barrier-gateway build` + `nssm restart barrier-gateway`.
- [ ] Probar un registro de guardia desde Vistara Web y confirmar en el log
      `capture_relayed` (no `capture_api_error`).
