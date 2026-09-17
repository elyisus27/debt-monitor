# `@debt-monitor/photos-gateway`

Worker que corre en la PC de caseta (LAN). Es el **único** punto de entrada desde
internet para el tema de fotos de visitas: (1) recibir la orden de "toma las 3
fotos de esta visita" que manda Vistara tras un registro de guardia, y (2)
servir cada foto ya tomada (de teclado o de guardia) para que Vistara la
muestre en su web. Llega por un **túnel Cloudflare** que corre aparte en esta
misma PC (mismo mecanismo, mismo `cloudflared`, que `barrier-gateway` ya usa
para la pluma -- ver ese README para el diagrama del túnel).

**Este proceso nunca toca el DVR ni la base de datos.** Solo valida el token
compartido con Vistara y relaya la petición a `apps/api` en `127.0.0.1` --
igual que `barrier-gateway` nunca decide nada, solo dispara el GPIO del tótem,
la lógica real (captura de fotos, storage, cola de sync a Vistara) vive en
`apps/api/src/vistara-photos/`.

Vive en el monorepo de `debt-monitor` por comodidad de git/tooling, pero es su
**propio proceso** y su **propio servicio de Windows** -- no comparte runtime
con `apps/api` ni con `barrier-gateway`, solo les habla por HTTP en localhost.

Registro de decisión completo: CLAUDE.md (repo `vistara`) § "DECISIONES DE
DISEÑO — FOTOS DE VISITAS (debt-monitor)".

## Por qué un proceso aparte, y no una ruta más en `apps/api`

`apps/api` (puerto 9100) ya recibe tráfico de los teclados en la LAN, sin
ningún token -- ese es su nivel de confianza de siempre (LAN cerrada). Exponer
ese puerto completo a internet vía un hostname nuevo hubiera expuesto TODAS
sus rutas (ingesta de eventos, listado de cruces, etc.), no solo las de fotos.
`photos-gateway` es la misma solución que ya se usó para la pluma: un proceso
mínimo, sin DB, sin credenciales de DVR, que es lo único que internet puede
tocar -- y desde ahí, una llamada LAN-local (nunca expuesta) hacia `apps/api`.

## Cómo funciona

```
Vistara API (Cloud Run)
  │  POST https://photos-push.condominioreserva.com/capture   { visitId, tenantId, plate }
  │  X-Photo-Token: ...
  ▼
Cloudflare Tunnel (cloudflared, esta PC) ──► photos-gateway, POST /capture (127.0.0.1)
  │                                            │
  │                                            ├─ valida X-Photo-Token
  │                                            ▼
  │                                          apps/api, POST /api/guard-photos/capture-request (127.0.0.1:9100)
  │                                            │  responde 202 de inmediato, captura en 2do plano
  ◄────────────────────────────────────────────┘

...más tarde, sin relación de tiempo con lo de arriba...

apps/api (GuardPhotosSyncService, cola durable con reintentos)
  │  PATCH https://vistara-api.../visits/{visitId}/photos   { photoRefs: [...] }
  ▼
Vistara API -- ya no pasa por este worker, es apps/api hablando directo, igual
               que sync-vistara.service.ts para los cruces de teclado.

Vistara API (para mostrar una foto en la web, en cualquier momento después)
  │  GET https://photos-push.condominioreserva.com/photo/keypad/evento123_ch101.jpg
  │  X-Photo-Token: ...
  ▼
Cloudflare Tunnel ──► photos-gateway, GET /photo/:kind/:file (127.0.0.1)
  │                     │
  │                     ├─ valida X-Photo-Token
  │                     ▼
  │                   apps/api, GET /api/vistara-photos/:kind/:file (127.0.0.1:9100)
  │                     │  sirve el JPEG real desde data/event-photos/ o data/guard-photos/
  ◄─────────────────────┘
```

`:kind` es `keypad` (cruces de teclado, ya funcionando) o `guard` (registros de
guardia, este feature) -- selecciona la carpeta local del lado de `apps/api`,
Vistara nunca necesita saber cuál es cuál.

## Configuración -- `.env`

Ver [`.env.example`](.env.example). Lo esencial:

| Variable | |
|---|---|
| `API_BASE_URL` | `http://127.0.0.1:9100` -- `apps/api` en esta misma PC |
| `PUSH_PORT` | puerto local (`127.0.0.1`) donde escucha este proceso, `8788` (distinto del `8787` de `barrier-gateway`) |
| `PHOTOS_TOKEN` | secreto compartido con `PHOTO_TUNNEL_TOKEN` del lado de Vistara. Vacío = proceso completo desactivado |

El carril de visitantes usa las MISMAS cámaras que el carril de
teclados/residentes (confirmado con el usuario, 2026-09-17) -- `apps/api`
reusa `DvrService.canalesPara('entrada')` tal cual, sin ninguna config nueva
del lado del DVR. Solo el storage queda separado (`data/guard-photos/` en vez
de `data/event-photos/`), no la fuente de las fotos.

## Log

Una línea JSON por evento a stdout: `listening` · `capture_relayed` ·
`capture_rejected` · `capture_401` · `capture_api_error` · `photo_served` ·
`photo_not_found` · `photo_401` · `photo_api_error` · `desactivado`.

## Correr

```powershell
pnpm install
cp apps/photos-gateway/.env.example apps/photos-gateway/.env   # y rellenar
pnpm --filter @debt-monitor/photos-gateway build
node apps/photos-gateway/dist/main.js
```

### Servicio de Windows (NSSM) -- mismo patrón que `barrier-gateway`/`debt-api`

```powershell
nssm install photos-gateway "C:\Program Files\nodejs\node.exe" "C:\...\debt-monitor\apps\photos-gateway\dist\main.js"
nssm set photos-gateway AppDirectory "C:\...\debt-monitor\apps\photos-gateway"
nssm set photos-gateway AppStdout "C:\...\debt-monitor\logs\photos-gateway.log"
nssm set photos-gateway AppStderr "C:\...\debt-monitor\logs\photos-gateway.log"
nssm set photos-gateway AppRotateFiles 1
nssm set photos-gateway Start SERVICE_AUTO_START
nssm start photos-gateway
```

### Túnel Cloudflare -- reusa el MISMO túnel que `barrier-gateway` (`barrier-push`)

No hace falta crear un túnel nuevo -- solo agregar un hostname más al mismo
`config.yml` que ya corre en esta PC (ver `apps/barrier-gateway/README.md` para
cómo se creó el túnel original):

```powershell
cloudflared tunnel route dns barrier-push photos-push.condominioreserva.com
```

Agregar la nueva regla de `ingress` **ANTES** del catch-all final:

```yaml
tunnel: <TUNNEL_ID>
credentials-file: <ruta al .json que generó `tunnel create`>
ingress:
  - hostname: barrier-push.condominioreserva.com
    service: http://127.0.0.1:8787
  - hostname: photos-push.condominioreserva.com
    service: http://127.0.0.1:8788
  - service: http_status:404
```

Reiniciar el servicio `cloudflared` para que tome el `config.yml` nuevo.

Proteger `photos-push.condominioreserva.com` con **Cloudflare Access** (misma
política de Service Token que ya existe para `barrier-push` -- se le puede
agregar este hostname a la política existente, no hace falta una nueva) -- el
`X-Photo-Token` de este worker es la segunda capa, no la única.

## Pendiente antes de producción

- [ ] Generar `PHOTOS_TOKEN` (cadena aleatoria larga) y ponerlo aquí Y en
      `PHOTO_TUNNEL_TOKEN` del lado de Vistara (Secret Manager de `vistara-api`).
- [ ] Agregar el hostname `photos-push.condominioreserva.com` al túnel
      `barrier-push` ya existente (ver arriba) + extender la política de
      Cloudflare Access que ya protege `barrier-push`.
- [ ] `pnpm --filter @debt-monitor/photos-gateway build` + `node dist/main.js`
      contra `apps/api` real; probar un registro de guardia desde Vistara Web
      y confirmar en el log `capture_relayed` (no `capture_api_error`).
- [ ] `nssm install photos-gateway` (auto-start).
- [ ] `prisma db push` en `apps/api` para crear la tabla `guard_visit_photos`
      antes de reiniciar `debt-api`.
