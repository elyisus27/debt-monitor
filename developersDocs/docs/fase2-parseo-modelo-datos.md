# Fase 2 — Parseo real del evento + modelo de datos

Objetivo: con el schema real ya confirmado en
[Hallazgos Hikvision](hallazgos-hikvision.md), construir el parser y el
modelo de datos mínimo — y probarlos contra datos reales, no sintéticos.
Cerrada 2026-08-22.

Todo vive todavía en [`tools/httphosts-probe/`](../../tools/httphosts-probe/)
(prototipo), no en el monorepo formal — mismo criterio que Fase 1: no
formalizar (`apps/api`, Prisma, etc.) hasta tener el modelo validado contra
datos reales.

## Los 4 scripts y para qué es cada uno

| Script | Rol |
|---|---|
| `listener.js` | El de Fase 1 — dump crudo a `.raw`, sin parsear. Sigue existiendo tal cual, como herramienta de depuración para cuando aparezca un campo/evento que no reconozcamos. |
| `parse-captures.js` | Parser **batch**: lee un directorio de `.raw` (ej. el histórico ya archivado), filtra ruido y escribe un `.json` con los eventos reales. Solo lee, no modifica el origen. |
| `watch-events.js` | Vigila `captures/` en vivo y emite una línea por cada cruce real. Pensado para depurar/observar, no para persistir. |
| `ingest.js` | El camino real: recibe el `POST` de `httpHosts` directo (sin pasar por `.raw` intermedio), parsea, filtra, y guarda en SQLite en el mismo request. Puerto por defecto `9100` (distinto al `9099` de `listener.js`, para poder correr ambos en paralelo si hace falta comparar). |
| `backfill.js` | Carga a la misma SQLite el resultado de un batch de `parse-captures.js` — útil para meter el histórico una sola vez. `INSERT OR IGNORE` + `UNIQUE`, así que correrlo dos veces con el mismo archivo no duplica. |

## Criterio de filtrado (el mismo en los 4)

**No se filtra por `subEventType` fijo.** Ver
[el gap de `capabilities`](hallazgos-hikvision.md) — el fabricante no
documenta bien sus propios códigos (el `179`, que es justo el que más
importa, ni aparece en la lista de `capabilities`). Se filtra por:

```
eventType === "AccessControllerEvent" && ace.name && ace.employeeNoString
```

Es decir: "¿alguien se identificó?" — no "¿coincide con este código
numérico?". Esto descartó **2973 de 4048** eventos del histórico
(puertas abrir/cerrar sueltas, `videoloss`, excepciones de red/voltaje,
etc.) sin perder ningún cruce real.

## Modelo de datos

SQLite (`tools/httphosts-probe/data/events.db`), tabla `access_events`:

```sql
CREATE TABLE access_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,       -- IP del teclado origen
  serial_no INTEGER,              -- serialNo del equipo, para deduplicar
  casa_unidad TEXT NOT NULL,      -- de AccessControllerEvent.name
  employee_no TEXT NOT NULL,      -- de AccessControllerEvent.employeeNoString
  timestamp TEXT NOT NULL,        -- de EventNotificationAlert.dateTime (hora del equipo, no de llegada)
  puerta TEXT NOT NULL,           -- "entrada" | "salida" | "desconocida", inferido de deviceName/IP
  device_name TEXT,
  verify_mode TEXT,               -- currentVerifyMode, ej. "cardOrPw"
  sub_event_type INTEGER,
  door_no INTEGER,
  card_reader_no INTEGER,
  raw_payload TEXT,               -- JSON completo, por si hace falta reprocesar
  received_at TEXT NOT NULL,      -- hora de nuestro servidor al recibir
  UNIQUE(ip_address, serial_no)   -- de-dup: mismo evento del mismo equipo no se duplica
);
```

`UNIQUE(ip_address, serial_no)` es la pieza clave de deduplicación —
permite correr `backfill.js` o recibir el mismo evento dos veces (ej. si
el equipo reenvía) sin ensuciar la tabla.

## Resultado real (2026-08-22)

- **1074 eventos** cargados (1072 del histórico vía `backfill.js` + 2
  capturados en vivo por `ingest.js` antes del backfill).
- **102 casas únicas.**
- **1034 por entrada, 40 por salida** — la entrada concentra casi todo el
  tráfico real; la salida casi no se usa (coincide con que en las pruebas
  de Fase 1 nunca vimos un cruce nuevo en vivo por ahí).
- Rango de fechas: 2026-07-13 → 2026-08-22 (hoy).

## Hallazgo operativo: cambiar el puerto de un slot ya configurado no dispara el volcado

En Fase 1 confirmamos que un `PUT` que pasa un slot de "sin configurar" a
configurado dispara el volcado completo del historial interno del equipo.
Ahora confirmamos el caso contrario: **cambiar un valor (el `portNo`, de
`9099` a `9100`, para pasar de `listener.js` a `ingest.js`) en un slot que
ya estaba configurado NO vuelve a disparar el volcado** — solo llegan
eventos genuinamente nuevos desde ese momento. Verificado con datos reales
persistidos en la DB (dos cruces reales, separados por casi una hora, sin
ningún otro evento de relleno entre medio).

## Próximos pasos

[Fase 3 — Disparo de capturas CCTV](fases.md#fase-3-disparo-de-capturas-cctv):
con cada fila de `access_events` ya identificable (casa, hora, puerta),
usar ese trigger para ir a buscar/disparar la captura de cámara
correspondiente.
