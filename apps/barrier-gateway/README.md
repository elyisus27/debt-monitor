# `@debt-monitor/barrier-gateway`

Servicio **aislado**, de **un solo endpoint**, que corre en la PC de caseta (LAN).
Recibe la orden "abrir la pluma" que Vistara (nube) manda a través del **túnel
Cloudflare** y la reenvía al GPIO del **tótem CondoVive**.

Vive en el monorepo de `debt-monitor` por comodidad de git/tooling, pero es su
**propio proceso** y su **propio servicio de Windows** — no comparte nada en
runtime con `apps/api`. Apuntar el túnel a `apps/api` expondría *todos* sus
endpoints (incluido el receptor de webhooks de los teclados); este servicio, no.

Registro de decisión completo:
`vistara-docs/docs/tunnel-cloudflare.md` (repo hermano).

## API

### `POST /abrir`

| | |
|---|---|
| Header obligatorio | `X-Barrier-Secret: <BARRIER_SHARED_SECRET>` |
| Body (opcional) | `{ "reason": "...", "actorUserId": "..." }` — solo para el log |
| `200` | `{ "opened": true }` |
| `401` | secreto ausente o incorrecto |
| `429` | otra apertura hace < `BARRIER_MIN_INTERVAL_MS` (anti-rebote) |
| `502` | el tótem no respondió OK |

### `GET /healthz`

`{ "ok": true, "service": "barrier-gateway" }` — sin secreto, sin efectos. Para
monitoreo local.

## Seguridad — en capas

1. **Cloudflare Access + service token** (borde) — solo la Vistara API tiene el
   `CF-Access-Client-Id` / `CF-Access-Client-Secret`.
2. **`X-Barrier-Secret`** (esta app) — aun dentro del túnel, sin el secreto no abre.
3. **Bind a `127.0.0.1`** — nada de la LAN alcanza el puerto, solo `cloudflared`
   que corre en la misma máquina.
4. **Anti-rebote** + log JSON de cada intento (`abierto` / `rechazado_secreto` /
   `rechazado_rebote` / `totem_error`) con `actorUserId` e IP.

El endpoint no toca base de datos: la bitácora de "quién abrió y por qué" vive en
Vistara, que es quien llama con el `actorUserId`.

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

- [ ] `cloudflared tunnel create barrera-caseta` + `config.yml` con `ingress`
      `barrera.condominioreserva.com → http://127.0.0.1:9400`.
- [ ] `cloudflared tunnel route dns barrera-caseta barrera.condominioreserva.com`.
- [ ] App de Access self-hosted sobre ese hostname + service token.
- [ ] En la Vistara API: llamar a `POST /abrir` con el token de Access + `X-Barrier-Secret`.
- [ ] Confirmar la `TOTEM_GPIO_URL` real contra `lpr-caseta/.env` del sitio.
- [ ] `cloudflared service install` + servicio NSSM `barrier-gateway`.
