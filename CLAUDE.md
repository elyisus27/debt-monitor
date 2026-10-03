# debt-monitor

Monitoreo/auditoría de cruce de accesos de casas morosas (residencial) contra el
sistema Hikvision / HikCentral Connect (hccgw).

## Manuales de referencia (Hikvision / Hik-Connect)

En [docs/hikvision/](docs/hikvision/) hay dos manuales oficiales, cada uno con su
versión en PDF y su versión ya convertida a texto plano (más barata de leer/grepear
que el PDF):

- `isapi.pdf` / `isapi.txt` — manual "ISAPI General Application". Cubre el DVR local
  (video). **No cubre** el módulo AccessControl/UserInfo del panel de acceso.
- `909409593-Hik-Connect-for-Teams-OpenAPI-Developer-Guide-V2-13-0-20250516-1.pdf` /
  `hccgw-openapi-guide.txt` — manual oficial "Hik-Connect for Teams (HikCentral
  Connect) OpenAPI V2.13.0 Developer Guide". Cubre la API cloud (`hccgw`,
  `ius.hikcentralconnect.com`): personas, PINs, contraseñas, niveles de acceso,
  puertas. Es el que aplica a control de acceso (PIN/password de morosos).

**Cómo consultarlos:** preferir `Grep`/lectura parcial sobre los `.txt` en vez de
abrir los `.pdf` completos — son manuales largos (cientos de páginas) y el texto ya
extraído permite buscar el endpoint/campo exacto sin releer todo. Los `.pdf` quedan
como respaldo/fuente original si el `.txt` pierde formato en alguna tabla.

Estos manuales vienen del proyecto hermano `tags-auditor` (mismo dominio Hikvision,
otro caso de uso: ese proyecto resuelve el cruce de video/tag del DVR local; este
proyecto es el nuevo enfoque, en limpio, para morosidad/accesos). No se portó
ningún hallazgo previo de ese proyecto (endpoints confirmados, bugs, etc.) — este
arranca de cero a propósito.

## Estado

Proyecto recién creado, sin código todavía.

## Relay local de avisos para Vistara (2026-10-02)

`apps/api/src/relay/`. La pestaña "Placas no reconocidas" de Vistara en la PC de caseta
se suscribe por SSE a `http://localhost:9100/api/relay/events` y solo pide datos a la
nube cuando llega un aviso (sin carros, Neon y Cloud Run se duermen). Detalle en
`vistara/CLAUDE.md` § COSTOS punto 2.

- `GET /api/relay/events`: SSE sin datos (`{"kind":"gate"}` + heartbeat cada 25 s).
- `POST /api/relay/notify`: solo desde loopback (cualquier otra IP recibe 403). Varios
  avisos en 1 s se juntan en uno.
- Avisan: `sync-vistara.service.ts` (tras cada cruce del teclado aceptado por Vistara) y
  `lpr-caseta` (`src/vistara.py`, tras cada placa aceptada; `RELAY_NOTIFY_URL`).
- En Vistara se activa en Configuración → Vigilancia → "Avisos en vivo en la PC de
  caseta" con `http://localhost:9100`.
