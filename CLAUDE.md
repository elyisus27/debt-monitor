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
