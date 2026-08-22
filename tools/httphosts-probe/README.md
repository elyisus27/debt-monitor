# Probe: push HTTP local de los teclados (ISAPI httpHosts)

> Runbook corto para copiar/pegar en terminal. Para la narrativa completa
> (por qué este mecanismo y no hccgw, diagrama de flujo, qué ya se
> validó) ver
> [`developersDocs` — Fase 1](../../developersDocs/docs/fase1-recepcion-eventos.md)
> (`mkdocs serve` en `developersDocs/`).

Objetivo de esta carpeta: **validar la conectividad real** teclado -> listener,
sin tocar todavía nada del backend definitivo. Solo captura cruda.

Ya se validó en local (laptop, sin red del teclado) que `listener.js`
recibe y guarda correctamente:
- un POST con body XML plano (`Content-Type: text/xml`) — formato de
  `isapi.txt` línea ~1300.
- un POST multipart con XML + imagen adjunta (`Event_Type` +
  `Picture_Name`) — formato de `isapi.txt` línea ~1298.

Lo que falta es correr esto **desde una máquina/sesión dentro de la LAN de
los teclados** (o con tu VPN metiéndote ahí) contra un teclado real.

## 0. Antes que nada: NO usar PUT a ciegas

`ivms4200` ya recibe alertas de estos teclados, así que lo más probable es
que **ya exista una entrada `httpHosts` configurada** apuntando a esa
instancia. `PUT /ISAPI/Event/notification/httpHosts` **reemplaza toda la
lista** de listening servers (`isapi.txt` §15.3.5). Si se usa mal, se
puede tirar esa integración existente. Por eso el orden es:

1. **GET** — ver qué hay configurado ahora mismo (no modifica nada).
2. **POST** — agregar nuestra entrada nueva (no toca las existentes).
3. Nunca usar PUT salvo que quieras reescribir la lista completa a propósito.

Reemplaza en los comandos:
- `<KEYPAD_IP>` — IP del teclado.
- `<ADMIN_USER>` / `<ADMIN_PASS>` — credenciales admin del teclado.
- `<LISTENER_IP>` — IP de la máquina donde corre `listener.js` (la que el
  teclado debe poder alcanzar).
- `<PORT>` — puerto donde corre `listener.js` (default `9099`).

Todos los ISAPI usan **HTTP Digest auth**, por eso `curl --digest`.

## 1. Levantar el listener

```
node listener.js 9099
```

Déjalo corriendo. Cada request que reciba se guarda en
`captures/<timestamp>.raw` + `.meta.json`, y se imprime una línea en
consola.

## 2. GET — capacidades (opcional, de solo lectura)

```
curl --digest -u <ADMIN_USER>:<ADMIN_PASS> \
  "http://<KEYPAD_IP>/ISAPI/Event/notification/httpHosts/capabilities"
```

## 3. GET — listeners actuales (importante, hacerlo SIEMPRE antes de tocar nada)

```
curl --digest -u <ADMIN_USER>:<ADMIN_PASS> \
  "http://<KEYPAD_IP>/ISAPI/Event/notification/httpHosts"
```

Guarda esta respuesta. Si ya hay una entrada (ej. la de ivms4200), anota su
`<id>` para no confundirla con la nuestra.

## 4. POST — agregar nuestra entrada (no toca las existentes)

Usa un `<id>` que no esté ocupado (revisa el resultado del paso 3; si solo
hay una entrada con id `1`, usa `2`).

```
curl --digest -u <ADMIN_USER>:<ADMIN_PASS> \
  -X POST "http://<KEYPAD_IP>/ISAPI/Event/notification/httpHosts" \
  -H "Content-Type: application/xml" \
  --data '<HttpHostNotification version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
  <id>2</id>
  <url>/events/keypad-probe</url>
  <protocolType>HTTP</protocolType>
  <parameterFormatType>JSON</parameterFormatType>
  <addressingFormatType>ipaddress</addressingFormatType>
  <ipAddress><LISTENER_IP></ipAddress>
  <portNo><PORT></portNo>
  <httpAuthenticationMethod>none</httpAuthenticationMethod>
  <uploadImagesDataType>binary</uploadImagesDataType>
</HttpHostNotification>'
```

Notas:
- `parameterFormatType` pedimos `JSON` (más fácil de parsear que XML luego);
  si el equipo no lo soporta, revisa `parameterFormatType` en la respuesta
  del paso 2 (capabilities) y cae a `XML`.
- `uploadImagesDataType: binary` pide que mande la imagen (si el evento
  trae una) en el mismo POST multipart, en vez de solo una URL.

## 5. POST — probar que el listener responde bien

```
curl --digest -u <ADMIN_USER>:<ADMIN_PASS> \
  -X POST "http://<KEYPAD_IP>/ISAPI/Event/notification/httpHosts/2/test"
```

Debe regresar `XML_HttpHostTestResult` con `errorDescription` vacío/ok. Y en
la consola del `listener.js` debería aparecer una línea nueva.

## 6. La prueba real: meter un NIP en el teclado

Con el listener corriendo, presiona un NIP real en el teclado (uno de
prueba, no uno de un residente). Revisa:
- la consola de `listener.js` (¿llegó algo?),
- `captures/<timestamp>.raw` — el payload completo tal cual lo manda el
  equipo. **Esto es lo que necesitamos ver primero**: el manual ISAPI
  general no trae el schema detallado de `AccessControllerEvent`, así que
  vamos a inferir los campos (PIN usado, nombre/employeeNo, puerta, hora)
  directamente de esta captura real.

Copia el `.raw` de vuelta (o pégalo en el chat) para seguir con el parser
real en el backend.

## Cleanup

Si algo sale mal y quieres quitar la entrada que agregamos:

```
curl --digest -u <ADMIN_USER>:<ADMIN_PASS> \
  "http://<KEYPAD_IP>/ISAPI/Event/notification/httpHosts"
```

...y volver a mandar un `PUT` con la lista completa **sin** nuestra
entrada (PUT sí reemplaza todo — úsalo aquí a propósito, con la lista
completa que viste en el paso 3 menos la nuestra).
