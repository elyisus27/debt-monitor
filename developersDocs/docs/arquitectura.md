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
