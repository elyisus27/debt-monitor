# Fases del proyecto

Roadmap de alto nivel. Cada fase se cierra con algo verificable (no con
"código escrito") antes de pasar a la siguiente — este proyecto arranca
de cero a propósito y no queremos construir sobre supuestos, dado que ya
una vez el supuesto inicial (hccgw push directo) resultó incorrecto.

## Fase 0 — Investigación del mecanismo ✅

Leer los manuales, confirmar qué API aplica a qué. Cerrada — ver
[Hallazgos Hikvision](hallazgos-hikvision.md).

## Fase 1 — Recepción de eventos ✅

Probar que se puede enganchar al push HTTP local de un teclado y capturar
el evento real cuando alguien marca un NIP. Cerrada 2026-08-22 contra los
2 teclados reales del sitio. Ver el detalle completo en
[Fase 1 — Recepción de eventos](fase1-recepcion-eventos.md) y el schema
real confirmado en [Hallazgos Hikvision](hallazgos-hikvision.md).

**Nota histórica sobre el entorno de esta fase:** originalmente se asumió
que la sesión de Claude Code no estaría en la LAN de los teclados/CCTV, así
que el plan era armar el código localmente (mocks) y correr el runbook real
desde otra máquina/sesión sí dentro de la LAN. En la práctica, la sesión
que cerró esta fase **sí tenía acceso directo a la LAN** (con Wi-Fi en el
mismo segmento `192.168.100.0/24` que los teclados), así que el runbook se
corrió directo, sin el paso intermedio de subir/bajar el repo.

## Fase 2 — Parseo real del evento + modelo de datos ✅

Con el schema real en mano: parser + modelo de datos mínimo (SQLite,
prototipo en `tools/httphosts-probe/`), validados contra el histórico real
del sitio (1074 eventos, 102 casas) y contra eventos en vivo. Cerrada
2026-08-22. Ver el detalle completo en
[Fase 2 — Parseo + modelo de datos](fase2-parseo-modelo-datos.md). *(Ese
histórico se borró después, mismo día — ver
["Reinicio de datos"](#reinicio-de-datos-2026-08-22) más abajo. Lo que
validó esta fase — que el modelo funciona contra datos reales — sigue en
pie; los datos en sí ya no existen.)*

## Fase 3 — Disparo de capturas CCTV ✅ Prácticamente cerrada

Al recibir el evento, disparar captura de cámara(s) y asociarla(s) al
evento. Cerrada 2026-08-22 (queda abierta solo Fase 4 como consumidor de
las fotos). Se rompió en sub-pasos porque el
alcance creció al confrontar la realidad (acceso remoto por SSH sin
navegación de archivos, deuda histórica de 1085 eventos sin foto, y un
proyecto hermano con código reusable pero mal estructurado):

1. **Acceso al DVR** ✅ — confirmado vía ISAPI contra `192.168.100.153`
   (Hikvision DVR, modelo `EV4016TURBOD(C)`, 5 canales activos). Detalle en
   [Hallazgos Hikvision](hallazgos-hikvision.md#dvr-del-sitio--confirmado-accesible-2026-08-22).
2. **Mapeo canal↔puerta** ✅ — confirmado por el administrador: entrada usa
   canales 1, 3 y 17 (esta última es una cámara IP proxied, no analógica —
   ver hallazgo del DVR híbrido); salida usa solo el canal 2. El canal 5
   ("Salida residentes") **no aplica** — es de las antenas RFID, sistema
   aparte, no el de morosos.
3. **Reestructurar el recuperador de video del proyecto hermano** ✅ —
   portado a [`tools/dvr-video/`](../../tools/dvr-video/) (`isapiDigest.mjs`,
   `isapiVideo.mjs`, `fetch-clip.mjs`). Reescrito en vez de copiado (el
   original vive en otro repo/máquina, fuera de alcance de esta sesión) —
   misma lógica ya probada (búsqueda `ContentMgmt/search` + descarga
   acotada por `playbackURI`, manejo de hora local sin conversión de zona
   horaria), pero credenciales solo por variable de entorno, sin PII
   quemada en código. Probado extremo a extremo contra un evento real de
   `access_events` — 3 clips descargados correctamente (canales 101, 301,
   1701).
4. **Recuperación post-mortem — descartada** ❌ (2026-08-22) — se llegó a
   medir la ventana real de retención del DVR (~15-18 días, entre el 3 y
   el 7 de agosto) y a identificar 685 de los 1086 eventos como
   recuperables dentro de esa ventana. Se decidió **no correr ese batch**:
   el reloj del teclado y el del DVR no estaban confirmados como
   sincronizados durante todo ese histórico, así que aunque el video
   exista, no hay garantía de que el vehículo siga en cuadro a la hora
   registrada — el mismo problema que ya se había visto en el proyecto
   hermano. Se prefirió no invertir el volumen de descarga (~2045 clips)
   en datos de valor dudoso.

   **Decisión (2026-08-22): la DB se recortó a los 200 eventos más
   recientes** (`access_events` pasó de 1086 a 200 filas) — se descartan
   los 886 eventos viejos en vez de cargar con datos que no se van a poder
   cruzar con video de forma confiable. El `.zip` del volcado crudo
   (`captures/_archive_2026-08-22.zip`) y el JSON parseado del batch **se
   conservan** por si sirven para otro análisis (no de video) más
   adelante.
5. **Captura en vivo** ✅ (2026-08-22) — se abandonó también el enfoque de
   "video corto" para eventos nuevos: el MP4 que exporta el DVR no trae el
   `moov atom` al frente (sin "faststart"), así que el navegador no lo
   reproduce sin remux — se confirmó el bug reproduciendo un clip real, no
   solo en teoría. En su lugar, `ingest.js` ahora dispara un **snapshot
   JPEG** (`/ISAPI/Streaming/channels/<ID>/picture`) de los canales de la
   puerta correspondiente **en el instante en que llega el evento real**
   (fire-and-forget, no bloquea el ack al teclado). Sin buscar por hora,
   sin depender de retención del DVR, sin problema de reloj — el snapshot
   ya es "ahorita". Nueva columna `access_events.photo_paths` (JSON, rutas
   relativas en `captures/event-photos/`). Probado extremo a extremo con
   un evento sintético: insertó, capturó los 3 canales de entrada, guardó
   las rutas — limpiado después por ser de prueba, no real.

   **Corrección de calidad (mismo día):** el primer evento real capturado
   salió en 704×480 — el default del endpoint de snapshot, aunque el canal
   soporte 1080p. Corregido pidiendo explícitamente
   `?videoResolutionWidth=1920&videoResolutionHeight=1080` (documentado
   pero opcional en el manual) — confirmado 1920×1088 real contra los 6
   canales. Ver [Hallazgos Hikvision](hallazgos-hikvision.md). El evento
   real ya capturado antes del fix se queda en baja resolución (no tiene
   caso re-capturarlo, el vehículo ya no está ahí); todo evento nuevo sale
   ya en resolución completa.

   `tools/dvr-video/` (el port del recuperador de clips) queda **sin usar
   por ahora** — no se borra (puede servir de referencia si algún día se
   necesita video de verdad, ej. evidencia legal), pero no es el camino
   activo.
6. **Interfaz gráfica mínima** ✅ — lista eventos con su foto real inline
   (o "sin foto" si no aplica) en `http://192.168.196.9:9200`. Necesaria
   porque la operación es en sesión remota (SSH), sin acceso a navegación
   de archivos local.

## Reinicio de datos (2026-08-22)

Se borró todo el histórico acumulado hasta este punto: la tabla
`access_events` completa (203 filas — el recorte a 200 de más temprano
más 3 eventos nuevos en vivo), el archivo crudo original
(`captures/_archive_2026-08-22.zip`), el JSON parseado del batch, 6 pares
`.raw`/`.meta.json` sueltos de `listener.js` que nunca se habían archivado,
y las fotos del único evento real capturado antes del fix de calidad.

**Motivo:** el objetivo del proyecto no es solo el registro de "casa X, a
la hora Y" — es identificar **qué vehículo** usa el NIP de cada casa
(para estadística de autos por casa, y para detectar visitas usando el
NIP de un moroso). Ningún evento del histórico borrado traía esa
asociación vehículo↔evento (la captura de foto por evento, Fase 3, se
armó después). Conservar datos sin esa asociación no aportaba al objetivo
real, así que se prefirió reiniciar limpio en vez de cargar con ellos.

De aquí en adelante, `access_events` empieza otra vez desde `id=1` y todo
evento nuevo ya trae su foto en alta resolución desde el primer segundo.

## Fase 4 — Pipeline de placa / marca / modelo 🔶 En progreso (lectura pasiva)

### Hallazgo previo: no se puede negar acceso con la arquitectura actual

Antes de diseñar nada, se investigó si era técnicamente posible "no abrir
la pluma hasta validar placa" (idea del usuario, para el caso de vehículo
sin placa o placa no legible). **Confirmado por el usuario: el panel de
acceso abre la pluma por su cuenta en cuanto el NIP es válido, sin
autorización externa** — `httpHosts` (lo que usamos) es notificación
posterior al hecho, no un punto de decisión. Bloquear acceso requeriría un
modo de integración distinto (posiblemente vía `hccgw`, no documentado
todavía) — **queda fuera de alcance por ahora**, anotado como iniciativa
aparte a investigar, no como parte de esta fase. Fase 4 se acotó a lectura
**pasiva**: identificar la placa cuando se pueda, registrar por qué no
cuando no se pueda — sin tocar el control de acceso físico.

### Integración con `lpr-caseta`

Se evaluaron 3 formas de reusar el pipeline ya maduro de `lpr-caseta`
(mismo dominio, misma cámara de placas `192.168.100.2`, semanas de
calibración real): (a) llamar a su `webapp.py` en vivo, (b) copiar su
código, (c) reescribir en Python propio reusando su entorno ya instalado.
Se eligió **(c)** — mismo criterio que `tools/dvr-video/` — para no
acoplar dos sistemas en producción ni duplicar sus datos. Detalle completo
en [`tools/plate-reader/README.md`](../../tools/plate-reader/README.md).

Resultado: `tools/plate-reader/` (Python, corre con el intérprete de
`lpr-caseta/.venv` para no duplicar dependencias pesadas) — servicio HTTP
local (`service.py`, puerto 9300) que recibe una ruta de imagen y regresa
`{plate, confidence}` o `{plate: null, reason}`. `ingest.js` ya lo llama
automáticamente tras capturar la foto del canal "Placas" de cada evento de
entrada (columnas nuevas `plate_text`/`plate_confidence`/`plate_reason` en
`access_events`), y el visor ya la muestra. Probado extremo a extremo con
un evento sintético — cadena completa funcionando (evento → foto → placa
→ DB → visor).

**Calibración inicial contra fotos de `lpr-caseta` (no representativa):**
se validó la lógica de lectura contra 3 fotos ya recortadas por ese otro
pipeline (2/3 fallaban por falta de margen lateral en el recorte —
corregido, `CROP_PAD_SIDE_PX`; 3/3 después) — pero esas fotos no
representan nuestra entrada real (foto ancha completa del canal, no un
recorte ya hecho).

**Backfill contra los 4 eventos reales propios (2026-08-23):** al correr
el lector contra las fotos reales ya capturadas por `ingest.js`
(`event1`-`event5`, canal "Placas"), salieron 2 problemas nuevos que no
aparecían en las pruebas anteriores:

1. **Detección de vehículo con confianza muy baja incluso en fotos
   nítidas** — el evento con mejor foto (auto completo, bien iluminado)
   solo dio `conf=0.27` como "car" (posible efecto de la distorsión de
   lente gran angular del canal). Bajado `VEHICLE_CONF_THRESHOLD` de 0.4 a
   0.2 para no descartarlo.
2. **Con el umbral más bajo, apareció un caso de caja basura** — un
   vehículo con las luces muy encandiladas dio 2 cajas "car" de
   fragmentos diminutos (~0.2% del cuadro) en vez de la silueta completa.
   Agregado `VEHICLE_MIN_AREA_RATIO` (mínimo 1% del cuadro) para
   descartar cajas implausiblemente chicas antes de intentar leer nada.

**Resultado real, honesto:** de 4 eventos reales, **1 dio lectura** (placa
`5ZN563`, confianza 31% — comparado a mano con la foto, la placa real es
`57N-563`, el lector confundió "7" por "Z"; el visor ya marca esto como
⚠ dudosa por debajo de 60% de confianza), **3 sin lectura** — 2 por luces
delanteras encandilando la cámara al punto de que ni el auto se distingue
bien (justo el caso que anticipó el usuario), 1 por el mismo motivo con
menor severidad. **Ningún falso positivo con alta confianza** hasta ahora
— cuando lee algo con baja confianza, el número ya lo delata como no
confiable.

**No incluye marca/modelo del vehículo** — eso es un modelo de
reconocimiento visual distinto (VMMR, "vehicle make/model recognition"),
no algo que `lpr-caseta` o este pipeline ya resuelvan. Evaluar como
extensión futura si hace falta, no es parte de lo entregado en este cierre
de Fase 4.

## Fase 5 — Padrón y auditoría

**Corrección de diseño (2026-08-23, aclarado por el usuario):** debt-monitor
**no es dueño del padrón vehículo↔casa** — ese dato vive en Vistara (la
nube), que ya es la fuente de verdad de morosidad (cambia mes a mes: qué
casas están en el teclado de morosos varía según quién pagó). Este
proyecto es un **satélite**: para saber "¿esta placa está autorizada para
esta casa?" la jugada correcta es **consultar un endpoint en Vistara**
(pendiente de habilitar allá), no mantener una copia local del padrón que
se desincronizaría del original.

**Bloqueo de pluma sin placa válida — fuera de alcance:** se descarta el
pulso directo del teclado a la pluma (`ver hallazgos: "panel abre pluma sin
autorización externa"`). Detener la pluma *antes* de que abra requeriría un
modo de integración distinto (vía `hccgw`, no documentado todavía) — queda
anotado como iniciativa aparte, no parte de estas fases.

### Actuación de pluma — worker de poll `apps/barrier-gateway` (2026-09)

`debt-monitor` **sí puede abrir la pluma**, pero solo **drenando una cola
que Vistara llena** — nunca expone un endpoint entrante, no hay túnel.

`apps/barrier-gateway` es un worker Node plano (sin dependencias) que corre
como servicio NSSM (el 4º del proyecto). Cada ~2 s pregunta a la Vistara
API `GET /visits/barrier-commands/poll` (auth por `X-Tenant-Slug` +
`X-Device-Key`); por cada comando encolado, dispara el GPIO del tótem
CondoVive localmente (mismo endpoint que `lpr-caseta/src/totem_gpio.py`).
Un click en Vistara Web encola el comando (`POST /devices/:id/open-barrier`).

Cero superficie entrante: la LAN pregunta hacia afuera, nada de la nube
entra. Anti-rebote + log JSON por intento se conservan.

> **El diseño anterior — túnel `cloudflared` + `POST /abrir` entrante +
> Cloudflare Access — se descartó** (endpoint público para una puerta
> física, demonio extra que se cae, config Zero Trust frágil). El commit
> `a26b25b` trajo ese código; se **pivotea** a worker de poll, no se tira.

Estado: **por implementar**. El código de `apps/barrier-gateway` ya tiene
la mitad hecha (`pulseTotem()`, anti-rebote, logging, carga de `.env`);
falta cambiar el disparador entrante por el loop de poll y crear los
endpoints del lado de Vistara.

Registro de decisión y plan completo:
`vistara-docs/docs/apertura-pluma-remota.md`.

La lógica condicional de Fase 5 (leer placa → consultar Vistara → abrir
solo si procede) se apoyará en este mismo mecanismo cuando se implemente.

**Caso real que motiva esto** (2026-08-03): 3 autos entraron con el mismo
NIP de una casa morosa — un placa recurrente (probable oficial/staff) y
otras dos distintas (probables familiares). Sospecha: uno de esos pudo
ser una visita coleada con el NIP del moroso, no un vehículo autorizado.
*(Placas reales omitidas aquí a propósito — este archivo se sube a
GitHub; identifican un vehículo real de forma más directa que un número
de casa, mismo criterio de cuidado que ya se aplicó con nombres/PIN en
`hallazgos-hikvision.md`. El caso real completo queda en la sesión, no en
git.)* El objetivo final es limitar cada NIP a máximo los autos que le
corresponden según los cajones de su casa (típicamente 2) — la Fase de
Estadísticas (ver `RESUMEN.md`) es el primer paso visual para detectar
casos así a simple vista.

## Fase 6 — Dashboard

`apps/web` (Next.js): herramientas para el administrador — ver los 2
autos más usados por casa, autorizar/restringir, exportar evidencia para
abordar al vecino moroso.

## Fase 7 — Integración con `vistara`

Definir mecanismo de "vaciar a vistara" (API vs. export batch) del padrón
de morosos detectados.

---

**Scaffold del monorepo armado 2026-08-23** (`pnpm` + Turborepo, `apps/api`
NestJS + Prisma, `apps/web` Next.js + React) — se esperó a que Fase 3/4
estuvieran cerradas y validadas contra datos reales (justo la razón por la
que se había pospuesto: no migrar el schema formal dos veces). `tools/
httphosts-probe/ingest.js` y `viewer.js` (el prototipo) se retiraron —
`apps/api` corre en su lugar, mismo puerto 9100 que ya tenían configurado
los teclados. Detalle completo en
[Fase 3 y 4](#fase-3--disparo-de-capturas-cctv-prácticamente-cerrada) de
este mismo archivo y en `RESUMEN.md`. `tools/plate-reader/` (Python) sigue
igual, `apps/api` lo sigue usando tal cual.
