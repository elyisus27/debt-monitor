# Hallazgos Hikvision (ISAPI / hccgw)

## DVR del sitio — confirmado accesible (2026-08-22)

`192.168.100.153`, credenciales admin ya provistas por el usuario (no
repetir aquí — mismo criterio que las de los teclados: solo en comandos
directos/variables de entorno, nunca en archivos del repo). Confirmado vía
ISAPI estándar (mismo manual `isapi.txt` que ya usamos para `httpHosts` —
sí cubre DVR/video, a diferencia del módulo AccessControl):

- `GET /ISAPI/System/deviceInfo` → `manufacturer: hikvision`,
  `model: EV4016TURBOD(C)`, `deviceType: DVR`, firmware `V4.70.101`.
- `GET /ISAPI/System/Video/inputs/channels` → 16 canales, solo 5 activos
  (`videoInputEnabled: true`), con nombres ya puestos por el sitio:

  | ID canal | Nombre | Candidato a |
  |---|---|---|
  | 1 | Entrada Residentes | teclado `192.168.100.104` ("Entrada Morosos") |
  | 2 | Salida visitas | — |
  | 3 | Plumas de ingreso | posible vista de placa en entrada |
  | 4 | Caseta interior | — |
  | 5 | Salida residentes | teclado `192.168.100.103` ("Salida Morosos") |

  Mapeo canal↔teclado **sin confirmar todavía** — los nombres son
  candidatos fuertes (coinciden semánticamente con "Entrada/Salida
  Morosos") pero falta validación visual/física del administrador. Se
  mandaron snapshots de los 5 canales para esa confirmación.

- `GET /ISAPI/Streaming/channels/<ID>/picture` (`isapi.txt:8979-9013`) —
  snapshot manual JPEG del stream principal de un canal.
  `<ID> = número de canal × 100 + 1` (ej. canal 1 → `101`, canal 17 → `1701`).
  Probado contra los 5 canales analógicos activos + el 17 (IP proxied, ver
  abajo) — todos responden `200` con JPEG válido.

  ⚠️ **Sin parámetros, la calidad es baja:** confirmado que sin
  `videoResolutionWidth`/`videoResolutionHeight`, el equipo regresa
  **704×480** aunque el canal esté configurado a 1080p (`resDesc` de
  `Video/inputs/channels` ya lo decía, pero el default del snapshot no lo
  respeta). El manual sí documenta esos dos parámetros opcionales en el
  mismo endpoint — pasando `?videoResolutionWidth=1920&videoResolutionHeight=1080`
  se obtiene **1920×1088** real (probado contra los 5 canales + el 17, los
  6 responden 1920×1088, 4-7x más peso que el default). `ingest.js` ya
  pide siempre esta resolución explícita.

### DVR híbrido: canales analógicos (1-16) + cámaras IP proxied (17+), APIs distintas

`GET /ISAPI/System/Video/inputs/channels` (usado arriba) solo cubre los 16
canales **analógicos** — de esos, únicamente 1-5 tienen señal, 6-16
confirmado con `Device Error` real al pedir snapshot (`statusCode:3`,
`deviceError`), no solo el flag `videoInputEnabled:false` de la config.

Las cámaras **IP** que este DVR administra (activadas/proxied vía NVR) son
un universo aparte, expuesto por
`GET /ISAPI/ContentMgmt/InputProxy/channels` (`isapi.txt:1803-1832`) — en
este sitio, 7 cámaras IP en los IDs 17-22 (`192.168.100.2`,
`192.168.100.200-204`), cada una con su propia IP/usuario en
`sourceInputPortDescriptor`. La fórmula de `<ID>` de streaming/snapshot es
la misma que para los analógicos (`canal×100+1`) — confirmado con el canal
17 ("Placas", `192.168.100.2`).

### Mapeo canal DVR ↔ puerta, confirmado por el administrador (2026-08-22)

| Uso | Canales |
|---|---|
| **Entrada** | 1 (Entrada Residentes), 3 (Plumas de ingreso), 17 (Placas) |
| **Salida** | 2 (Salida visitas) |
| No aplica a morosos/NIP | 4 (Caseta interior, sin uso definido), 5 (Salida residentes — es de las antenas RFID, **otro sistema**, no el de morosos) |


Notas de investigación sobre los dos manuales en [`docs/hikvision/`](../../docs/hikvision/)
(ver también `CLAUDE.md` en la raíz del repo, que explica qué cubre cada
uno). Este documento existe para no tener que releer los manuales cada vez
— aquí quedan los hallazgos ya masticados, con referencia a la línea del
`.txt` de donde salieron.

## hccgw (HikCentral Connect OpenAPI) — es cloud, y es subscribe+poll, no push

Al leer `hccgw-openapi-guide.txt:1056-3918` (§4.2, §4.4, §5.3.1, §5.3.2):
el modelo de "alarmas" del cloud (`ius.hikcentralconnect.com`) es
**suscribirse y luego hacer poll**, no un push a una IP propia:

1. `POST /api/hccgw/alarm/v1/mq/subscribe`
2. `POST /api/hccgw/alarm/v1/mq/messages` (recomendado cada ~500 ms)
3. Si no haces poll en 2 días, la suscripción se cancela.

Conclusión: **este manual no es el camino para escuchar el NIP en tiempo
real desde la LAN.** Es el manual correcto para lo que `vistara` ya hace
(`hik-connect/`): alta de persona y rotación de PIN, que si es un flujo
cloud-to-cloud, no LAN.

## ISAPI `Event/notification/httpHosts` — el mecanismo correcto para esto

Es una función **genérica de ISAPI** (no específica del módulo
AccessControl/UserInfo — por eso `isapi.txt` "no cubre AccessControl" y
aun así esto sí aplica). Endpoints (`isapi.txt:3797-3874`):

| Método | URL | Qué hace |
|---|---|---|
| GET | `/ISAPI/Event/notification/httpHosts/capabilities` | Capacidades soportadas (formatos, límites) |
| GET | `/ISAPI/Event/notification/httpHosts` | Lista completa de listeners configurados |
| **PUT** | `/ISAPI/Event/notification/httpHosts` | **Reemplaza toda la lista** — ⚠️ ver regla de seguridad abajo |
| **POST** | `/ISAPI/Event/notification/httpHosts` | Agrega un listener nuevo, sin tocar los existentes |
| POST | `/ISAPI/Event/notification/httpHosts/<ID>/test` | Dispara un test hacia ese listener |
| DELETE | `/ISAPI/Event/notification/httpHosts` | Borra **todos** los listeners |

Schema del objeto `HttpHostNotification` (`isapi.txt:20350-20359`):

```xml
<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <id></id>                          <!-- req -->
  <url></url>                        <!-- req, path absoluto, ej. /events/keypad -->
  <protocolType></protocolType>      <!-- req: HTTP, HTTPS, EHome -->
  <parameterFormatType></parameterFormatType> <!-- req: XML, JSON -->
  <addressingFormatType></addressingFormatType> <!-- req: ipaddress, hostname -->
  <ipAddress></ipAddress>
  <portNo></portNo>
  <userName></userName>
  <password></password>
  <httpAuthenticationMethod></httpAuthenticationMethod> <!-- req: MD5digest, none -->
  <uploadImagesDataType></uploadImagesDataType> <!-- opt: binary (default) | URL -->
  <eventMode></eventMode>            <!-- opt: all, list -->
</HttpHostNotification>
```

Al dispararse un evento, el dispositivo hace un `POST` al `url`
configurado. Puede venir como body plano (`Content-Type: text/xml`) o como
`multipart/mixed`/`multipart/form-data` con una parte `Event_Type` (XML) y
opcionalmente `Picture_Name` (JPEG binario) si `uploadImagesDataType` es
`binary` (`isapi.txt:1290-1300`).

### ⚠️ Regla de seguridad: nunca PUT a ciegas

`PUT` reemplaza **toda** la lista de listeners. Si el dispositivo ya tiene
algo configurado (otro sistema, otro integrador), un `PUT` sin haber
hecho `GET` antes lo destruye. Regla fija para este proyecto:

1. **Siempre GET primero** para ver qué hay.
2. **Agregar con POST**, nunca reescribir con PUT, salvo que sea
   intencional y con la lista completa en la mano.

## Dos modos de entrega — y por qué iVMS-4200 no aparece en `httpHosts`

`isapi.txt` documenta dos modos distintos para recibir eventos:

- **Modo armado ("Arming Mode")** — `GET /ISAPI/Event/notification/alertStream`
  (`isapi.txt:1274-1316`). El cliente abre una conexión HTTP larga y la
  mantiene viva; el dispositivo va escribiendo eventos en esa misma
  conexión (`multipart/mixed`, boundary). No queda ningún registro en
  `httpHosts` — la "suscripción" es, literalmente, tener la conexión
  abierta. Heartbeat cada ~30s por default.
- **Modo escucha ("Listening Mode")** — `httpHosts`, descrito arriba. El
  dispositivo mantiene una lista de listeners y hace un POST nuevo por
  cada evento, independiente de si el cliente tiene o no una conexión
  abierta.

**Verificado empíricamente** (2026-08-21, contra un teclado real vía
`GET /ISAPI/Event/notification/httpHosts`): la lista tenía únicamente
dos slots en estado default (`ipAddress 0.0.0.0`, `portNo 0`, sin `url`).
Ninguno apuntaba a iVMS-4200, a pesar de que iVMS-4200 sí recibe
notificaciones en vivo de ese mismo teclado (confirmado tanto en LAN como
vía el port-forwarding del usuario hacia su laptop).

**Conclusión:** iVMS-4200 usa **Modo armado (`alertStream`)**, no
`httpHosts`. Esto es coherente con el flujo de la GUI: "dar de alta el
dispositivo + verificación de conexión" es, por debajo, abrir y mantener
viva esa conexión larga — no hay un paso visible de "suscribirse" porque
la suscripción *es* la conexión.

Implicación práctica: **no hay conflicto entre lo que hace iVMS-4200 y lo
que vamos a registrar nosotros en `httpHosts`** — son mecanismos
completamente distintos y pueden convivir. Confirmado también que el
port-forwarding que ya tiene el usuario hacia su laptop deja pasar tráfico
en el sentido teclado→cliente (porque así es como iVMS-4200 recibe sus
notificaciones), lo cual es buena señal para que el mismo camino sirva
para nuestro listener.

## Schema real de `AccessControllerEvent` (confirmado contra hardware, 2026-08-22)

`isapi.txt` documentaba que existe el tipo de evento `accessControllerEvent`
(`isapi.txt:21444`) pero **no traía el schema detallado del payload** — eso
vive en un manual de AccessControl que no tenemos. Se resolvió capturando
eventos reales contra los 2 teclados del sitio (ver
[Fase 1](fase1-recepcion-eventos.md) para el runbook). Aunque configuramos
`parameterFormatType=XML`, el equipo entrega el evento en **JSON** dentro
del `multipart/form-data` (parte `AccessControllerEvent`,
`Content-Type: application/json`):

```json
{
  "ipAddress": "192.168.100.104",
  "portNo": 9099,
  "protocol": "HTTP",
  "macAddress": "88:de:39:6c:7a:4d",
  "dateTime": "2026-08-22T09:18:29-06:00",
  "activePostCount": 1,
  "eventType": "AccessControllerEvent",
  "eventState": "active",
  "eventDescription": "Access Controller Event",
  "AccessControllerEvent": {
    "deviceName": "Entrada Morosos",
    "majorEventType": 5,
    "subEventType": 179,
    "reportChannel": 5,
    "cardReaderKind": 1,
    "cardReaderNo": 1,
    "doorNo": 1,
    "verifyNo": 248,
    "name": "<casa-unidad, ej. 972-05>",
    "employeeNoString": "<mismo id sin guion, ej. 97205>",
    "serialNo": 3712,
    "currentVerifyMode": "cardOrPw",
    "currentEvent": true,
    "frontSerialNo": 3711,
    "hasRecord": false
  }
}
```

(`name`/`employeeNoString` van redactados arriba — son PII real de
residentes; ver nota de manejo de datos abajo.)

### `subEventType` observados (majorEventType 5 = "event", el que nos importa)

| subEventType | Significado (inferido) | Trae `name`/`employeeNoString` |
|---|---|---|
| **179** | **Verificación exitosa por card/PIN — el evento que buscamos** (identificador `"casa-unidad"`, ej. `972-05`) | Sí |
| 181 | Verificación exitosa, identidad distinta (nombre de persona, no casa — ej. `"David Ramirez"`, probablemente personal/guardia registrado en el panel, no residente) | Sí |
| 8 | Código externo/visitante (ej. `"EXTERNA-1002"`) | Sí |
| 21 | Puerta abierta (sigue casi siempre a un 179) | No |
| 22 | Puerta cerrada (sigue casi siempre a un 21) | No |
| 151 | Sin identificar todavía — trae `verifyNo` pero no `name`/`employeeNo` | No |
| 37 | Sin identificar todavía — acción administrativa/remota, sin identidad | No |

El resto de `majorEventType` (1, 2, 3) son ruido de diagnóstico —
`videoloss`, pérdida de red, exceso/bajo voltaje, etc. — no relacionados a
control de acceso.

### ⚠️ `capabilities` no documenta bien lo que el equipo realmente manda

`GET /ISAPI/Event/notification/httpHosts/capabilities` en este firmware
devuelve un `<minorEvent opt="...">` que **no incluye `0xb3` (179 decimal)**
— exactamente el código más importante para este proyecto (verificación
exitosa). Sí incluye `0xb5` (181). Conclusión práctica: **no confiar en
`capabilities` para armar un filtro de eventos del lado del teclado**
(`eventMode=list` + `EventList`) — el firmware emite códigos que no declara
soportar. Mejor dejar `eventMode=all` (red ancha, ya probado que no se
pierde nada) y filtrar del lado de nuestro propio listener/backend, por
`eventType=AccessControllerEvent` + presencia de `name`/`employeeNoString`
en vez de hardcodear el número de `subEventType`.

### Comportamiento de entrega: volcado inicial + push en vivo confirmado

Al hacer el primer `PUT`/`POST` que pasa un slot de `httpHosts` de
"sin configurar" a configurado, el equipo **vuelca de una sola vez todo su
historial interno almacenado** (en este sitio: 331 eventos en el teclado de
salida desde el 13 de julio, 3708+ en el de entrada) como una ráfaga de
POSTs, sin importar la fecha. Un `PUT` posterior con los mismos valores
**no** vuelve a disparar el volcado. Después de ese volcado inicial,
**confirmado que sí llegan eventos nuevos en tiempo real** sin necesidad de
reconfigurar nada (verificado con un cruce real minutos después de que el
volcado terminó).

### Dos teclados en el sitio, no uno

`192.168.100.103` = **"Salida Morosos"**, `192.168.100.104` =
**"Entrada Morosos"** — cada uno con sus propias credenciales/slots
`httpHosts` independientes (mismas credenciales admin en este sitio, pero
no asumir que siempre es así). Ambos ya están configurados apuntando al
mismo listener (`tools/httphosts-probe/listener.js`, puerto 9099) — un solo
listener recibe de los dos.

### Manejo de datos: esto es PII real de residentes

El volcado histórico trae nombres/identificadores reales de residentes
(formato `"casa-unidad"` en `name`/`employeeNoString`). Las capturas viven
en `tools/httphosts-probe/captures/`, cubierto por `.gitignore`
(`tools/**/captures/`) — nunca se sube a git. El volcado del 2026-08-22 se
comprimió a `captures/_archive_2026-08-22.zip` (también gitignored) en vez
de dejar miles de archivos sueltos.

⚠️ **Esta misma PII también hay que cuidarla fuera del repo.** El 2026-08-22
un `mempalace_mine` apuntado a `tools/httphosts-probe/` completo (en vez de
solo a los `.js`) minó sin querer 542 drawers con datos reales de
residentes hacia MemPalace — `mine` no respeta `.gitignore`. Se detectó y
se borró en la misma sesión (`delete_by_source` con la ruta absoluta, no el
basename — con basename el `dry_run` da `match_count:0` falso-negativo).
Lección fija: cualquier mine sobre este repo apunta solo a `developersDocs/`
y a archivos `.js` sueltos de `tools/`, nunca a la carpeta completa.

### Corrección (2026-08-22, sesión de Fase 3): el teclado sí retiene eventos sin listener

Se había asumido que un evento en vivo, si no hay nadie escuchando en el
puerto configurado (proceso caído), se pierde sin más. Falso: observado 2
veces el mismo día (huecos de ~1h y ~5h, causados por el proceso `ingest.js`
muriendo solo en background) que, al reconectar el listener, el equipo
entrega en ráfaga los eventos ocurridos durante el hueco, con su timestamp
real (no el de reconexión). No se probó el límite de cuánto tiempo/cuántos
eventos retiene — no asumir que es indefinido.
