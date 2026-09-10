# `@debt-monitor/barrier-gateway`

**Worker de poll** que corre en la PC de caseta (LAN). Cada ~2 s le pregunta a la
Vistara API si hay una orden de "abrir la pluma" pendiente y, si la hay, dispara el
GPIO del **tótem CondoVive** localmente.

**No expone ningún puerto ni endpoint.** La LAN pregunta hacia afuera; la nube nunca
entra. Auth por device key (`X-Device-Key`), el mismo mecanismo que ya usa `lpr-caseta`
para mandar placas.

Vive en el monorepo de `debt-monitor` por comodidad de git/tooling, pero es su
**propio proceso** y su **propio servicio de Windows** — no comparte nada en runtime
con `apps/api`.

Registro de decisión completo (y por qué se descartó el túnel Cloudflare):
`vistara-docs/docs/apertura-pluma-remota.md` (repo hermano).

## Cómo funciona

```
Vistara Web / caseta
  │  POST /devices/:id/open-barrier        (encola una orden)
  ▼
Vistara API  → BarrierCommand PENDING (TTL 30s)
  ▲
  │  GET /visits/barrier-commands/poll     (este worker, cada POLL_SECONDS)
  │  ← [{ id, reason }]  y las marca DELIVERED
  │
  ├─ por cada orden: POST al GPIO del tótem  (192.168.196.1:3001)
  │                  con anti-rebote (BARRIER_MIN_INTERVAL_MS)
  └─ PATCH /visits/barrier-commands/:id/ack { opened }   (best-effort, para la web)
```

Ante error de red al pollear: backoff exponencial hasta 60 s, luego reintenta.

## Configuración — `.env`

Ver [`.env.example`](.env.example). Lo esencial:

| Variable | |
|---|---|
| `VISTARA_API_BASE` | `https://vistara-api.condominioreserva.com/api/v1` (sin barra final) |
| `VISTARA_TENANT_SLUG` | `la-reserva` |
| `VISTARA_DEVICE_KEY` | device key del dispositivo "Caseta - Barrera" provisionado en Vistara (`libs/prisma/scripts/create-device.ts`) |
| `POLL_SECONDS` | `2` |
| `TOTEM_GPIO_URL` | endpoint GPIO del tótem — el mismo que usa `lpr-caseta/src/totem_gpio.py` |
| `BARRIER_MIN_INTERVAL_MS` | anti-rebote, `4000` |

## Log

Una línea JSON por evento a stdout (`{ ts, outcome, ... }`):
`abierto` · `rechazado_rebote` · `totem_error` · `poll_error` · `ack_error`.
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

## Pendiente antes de producción

- [ ] Provisionar el dispositivo "Caseta - Barrera" en Vistara (`create-device.ts`,
      `hasBarrierControl = true`) y poner su key en `.env`.
- [ ] Confirmar que este host alcanza el GPIO del tótem
      (`curl -X POST http://192.168.196.1:3001/devices/gpio/<adb_device>`).
- [ ] `pnpm --filter @debt-monitor/barrier-gateway build` + `node dist/main.js`
      contra la API real; probar el botón desde Vistara Web.
- [ ] `nssm install barrier-gateway` (auto-start).
