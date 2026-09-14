# `@debt-monitor/barrier-gateway`

Worker que corre en la PC de caseta (LAN). Recibe la orden de "abrir la pluma" por
**push directo** de la Vistara API (vía un túnel Cloudflare que corre aparte en esta
misma PC) y dispara el GPIO del **tótem CondoVive** localmente. Si el push no llega
(túnel caído), un **poll de respaldo** cada ~20 s recoge la orden igual.

**El proceso en sí no expone ningún puerto a la LAN ni a internet.** El servidor de
push escucha solo en `127.0.0.1` — es `cloudflared` (proceso aparte, con Cloudflare
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
Vistara API → BarrierCommand PENDING (TTL 30s)
  │
  │  push síncrono, ~4 intentos ~1s aparte (BARRIER_PUSH_URL)
  ▼
Cloudflare Tunnel (cloudflared, en esta PC) ──► este worker, POST /push (127.0.0.1)
  │                                              │
  │  { opened: true/false }                      ├─ anti-rebote (BARRIER_MIN_INTERVAL_MS)
  ◄──────────────────────────────────────────────┤
                                                  └─ POST al GPIO del tótem (192.168.196.1:3001)

Si el push falla las 4 veces (túnel caído): el comando queda PENDING y lo recoge
el poll de respaldo de este mismo worker:

  GET /barrier/poll   (cada POLL_SECONDS, ~20s -- casi nunca debería encontrar nada)
  ← { commands: [...] } y las marca DELIVERED
  → mismo pulso al tótem + PATCH /barrier/commands/:id/ack { opened }  (best-effort)
```

La cola es por tenant, no por device — un condominio, un carril de visitantes.
El ack por `PATCH` solo aplica al camino de poll; el push confirma en su propia
respuesta HTTP, sin necesidad de un ack aparte.

Ante error de red al pollear: backoff exponencial hasta 60 s, luego reintenta.

## Configuración — `.env`

Ver [`.env.example`](.env.example). Lo esencial:

| Variable | |
|---|---|
| `VISTARA_API_BASE` | `https://vistara-api.condominioreserva.com/api/v1` (sin barra final) |
| `VISTARA_TENANT_SLUG` | `la-reserva` |
| `VISTARA_DEVICE_KEY` | key de cualquier device activo del tenant (solo autentica el poll de respaldo; sin config especial) |
| `POLL_SECONDS` | `20` — poll de RESPALDO, solo entra si el push falla |
| `TOTEM_GPIO_URL` | endpoint GPIO del tótem — el mismo que usa `lpr-caseta/src/totem_gpio.py` |
| `BARRIER_MIN_INTERVAL_MS` | anti-rebote, `4000` |
| `PUSH_PORT` | puerto local (`127.0.0.1`) donde escucha el servidor de push, `8787` |
| `PUSH_TOKEN` | secreto compartido con `BARRIER_PUSH_TOKEN` del lado de Vistara. Vacío = push desactivado |

## Log

Una línea JSON por evento a stdout (`{ ts, outcome, ... }`):
`push_listening` · `push_abierto` · `push_rechazado_rebote` · `push_totem_error` ·
`push_error` · `push_desactivado` (push) — `abierto` · `rechazado_rebote` ·
`totem_error` · `poll_error` · `ack_error` (poll de respaldo).
La bitácora de "quién abrió y por qué" vive en Vistara (el `actorUserId` y el audit
log), no aquí — este worker solo dispara el pulso.

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

- [ ] Poner en `.env` la key de un device del tenant (la del OCR de `lpr-caseta`
      sirve, o crear una con `libs/prisma/scripts/create-device.ts`) — sigue haciendo
      falta para el poll de respaldo.
- [ ] Generar `PUSH_TOKEN` (cadena aleatoria larga) y ponerlo aquí Y en
      `BARRIER_PUSH_TOKEN` del lado de Vistara (Secret Manager de `vistara-api`).
- [ ] Instalar `cloudflared`, crear el túnel `barrier-push`, apuntar
      `barrier-push.condominioreserva.com` → `http://127.0.0.1:8787`, proteger con
      Cloudflare Access (ver arriba).
- [ ] Confirmar que este host alcanza el GPIO del tótem
      (`curl -X POST http://192.168.196.1:3001/devices/gpio/<adb_device>`).
- [ ] `pnpm --filter @debt-monitor/barrier-gateway build` + `node dist/main.js`
      contra la API real; probar el botón desde Vistara Web (módulo de visitas) y
      confirmar en el log `push_abierto` (no `rechazado_rebote`/poll de respaldo).
- [ ] `nssm install barrier-gateway` (auto-start) + `nssm install cloudflared`.
