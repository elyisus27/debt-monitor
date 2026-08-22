# Arquitectura general

## Panorama de componentes

```mermaid
flowchart LR
    subgraph LAN["LAN del fraccionamiento"]
        KP["Teclados Hikvision\n(persona + PIN)"]
        CCTV["CCTV\n(incl. cámara de placas)"]
        API["debt-monitor / apps/api\n(NestJS)\nlistener de eventos"]
        VIS["debt-monitor / vision\n(Python, fork de lpr-caseta)\ndetección + OCR de placa"]
        DB[("DB local\ndebt-monitor")]
        WEB["debt-monitor / apps/web\n(Next.js)\ndashboard admin"]
    end

    VISTARA["vistara (cloud)\nresidentes / unidades / cobranza\nhik-connect: alta y rotación de PIN"]
    HCCGW["HikCentral Connect\n(hccgw, cloud)"]

    KP -- "POST evento NIP\n(ISAPI httpHosts)" --> API
    API -- "dispara captura" --> CCTV
    CCTV -- "3 imágenes\n(incl. placa)" --> API
    API -- "frames" --> VIS
    VIS -- "placa / marca / modelo" --> API
    API --> DB
    WEB -- "consulta" --> API
    API -- "export / vaciar\npadrón de morosos" --> VISTARA
    VISTARA -- "alta persona + PIN" --> HCCGW
    HCCGW -- "config PIN" --> KP
```

Puntos clave de este diagrama:

- **`debt-monitor` corre en la LAN**, no en la nube — es requisito, porque
  necesita alcanzar tanto los teclados como el CCTV en tiempo real. Ver
  [Hallazgos Hikvision](hallazgos-hikvision.md) para por qué la vía cloud
  (`hccgw`) no sirve para este propósito.
- **La emisión/rotación del PIN es responsabilidad de `vistara`**, no de
  este proyecto. `vistara/apps/api/src/hik-connect/` ya tiene
  `hik-connect-roster.service.ts` y `hik-connect-rotation.service.ts`
  hablando con `hccgw`. `debt-monitor` solo consume el hecho de que un PIN
  fue usado — no gestiona altas ni rotación.
- **`debt-monitor` es un satélite que alimenta a `vistara`**, no lo
  reemplaza ni se fusiona con él en vivo. El flujo es: capturar y auditar
  acá, y periódicamente "vaciar" el padrón de vehículo↔domicilio↔PIN hacia
  `vistara` (mecanismo exacto de export — API vs. batch — pendiente de
  decidir cuando lleguemos a esa fase).
- **El OCR de placa no se escribe desde cero** — se evalúa reusar/adaptar
  `lpr-caseta` (Python, ya resuelve detección de vehículo + OCR) como
  servicio hermano dentro del mismo repo, invocado por `apps/api`.

## Retención de datos (decidido, pendiente de implementar)

Decisión del usuario (2026-08-22): **ventana rodante de 1 año**, tanto
para los eventos crudos como para su forma parseada. Aplica en dos
niveles distintos:

- **Ruido (puerta abrió/cerró, videoloss, excepciones de red/voltaje,
  etc.)** — no se persiste en absoluto, ni crudo ni parseado. Se descarta
  en el momento de recibir el `POST`, antes de tocar disco o DB (ver
  criterio de filtrado — sección "`capabilities` no documenta bien..." en
  [Hallazgos Hikvision](hallazgos-hikvision.md)).
- **Cruces reales (`AccessControllerEvent` con identidad)** — sí se
  guardan, en dos formas que expiran juntas a 1 año:
  - El registro parseado en la tabla `AccessEvent` (Fase 2) — la fuente
    de verdad para consultas/auditoría.
  - El `.raw` original como respaldo — útil para reprocesar si el parser
    tenía un bug, no para consultar directamente.

**Mecanismo de purga:** un job semanal que borra ambas cosas (fila de DB
+ `.raw` asociado) con más de 1 año de antigüedad. Debe vivir **dentro de
`apps/api`** cuando exista (cron interno de la app, o cron del sistema
donde corra) — no es algo que deba depender de una sesión de Claude Code,
que es efímera.

Mientras no exista `apps/api`, los `.raw` de prueba en
`tools/httphosts-probe/captures/` no tienen todavía un mecanismo de purga
automático — se limpian manualmente cuando haga falta (ver
[Fase 1](fase1-recepcion-eventos.md) por cómo se comprimieron los del
2026-08-22).

## Layout del monorepo (decidido, pendiente de scaffold)

Mismo patrón que `vistara` (pnpm + Turborepo, `apps/*` + `libs/*`) por
consistencia entre proyectos hermanos:

```
debt-monitor/
  developersDocs/        # este mkdocs
  docs/hikvision/         # manuales oficiales (ISAPI, hccgw OpenAPI)
  tools/httphosts-probe/  # herramienta de prueba de Fase 1 (ver fase1-recepcion-eventos.md)
  apps/
    api/                  # NestJS — listener de eventos, orquesta capturas CCTV, DB, export a vistara
    web/                  # Next.js — dashboard admin (mismo stack que vistara/apps/web)
    vision/                # Python (fork/adaptación de lpr-caseta) — detección + OCR de placa
  libs/
    prisma/                # schema/cliente compartido (a definir si comparte DB con vistara o es propia)
  pnpm-workspace.yaml
  turbo.json
```

`apps/web` queda confirmado en **Next.js** (React), igual que
`vistara/apps/web`, en vez de Angular — decisión tomada explícitamente
para mantener consistencia entre los dos proyectos hermanos.

Este layout todavía no está scaffoldeado — se arma cuando cerremos
Fase 1 (recepción de eventos) y tengamos claro el shape real del payload
del evento, para no adivinar el modelo de datos antes de tiempo.
