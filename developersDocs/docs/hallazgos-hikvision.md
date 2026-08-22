# Hallazgos Hikvision (ISAPI / hccgw)

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

## Gap conocido: schema de `AccessControllerEvent`

`isapi.txt` confirma que existe el tipo de evento `accessControllerEvent`
(`isapi.txt:21444`) y que hay un nodo `<minorAlarm>` con submodos como
`0x400,0x401,0x402,0x403` (`isapi.txt:21050-21071`), pero **no trae el
schema detallado del payload** (qué campo trae el PIN usado, el nombre o
`employeeNo` de la persona, el nombre de la puerta/domicilio, etc.) — eso
vive en un manual de AccessControl que no tenemos.

**No hay que adivinarlo**: se resuelve en cuanto tengamos una captura real
de un evento (ver [Fase 1](fase1-recepcion-eventos.md)) — se inspecciona
el `.raw` capturado y de ahí se construye el parser real.
