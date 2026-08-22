# Fases del proyecto

Roadmap de alto nivel. Cada fase se cierra con algo verificable (no con
"código escrito") antes de pasar a la siguiente — este proyecto arranca
de cero a propósito y no queremos construir sobre supuestos, dado que ya
una vez el supuesto inicial (hccgw push directo) resultó incorrecto.

## Fase 0 — Investigación del mecanismo ✅

Leer los manuales, confirmar qué API aplica a qué. Cerrada — ver
[Hallazgos Hikvision](hallazgos-hikvision.md).

## Fase 1 — Recepción de eventos 🔄 en progreso

Probar que se puede enganchar al push HTTP local de un teclado y capturar
el evento real cuando alguien marca un NIP. Ver el detalle completo en
[Fase 1 — Recepción de eventos](fase1-recepcion-eventos.md).

**Plan de repo/entorno para esta fase**, tal como lo definió el usuario:
esta sesión de Claude Code corre en una laptop que **no está en la LAN**
de los teclados/CCTV (solo hay port-forwarding, no confirmado 100%
suficiente para el flujo completo). Por eso:

1. Aquí se deja el código de prueba ya armado y validado localmente
   (mocks, sin tocar hardware real).
2. El usuario sube estos cambios a un repositorio propio.
3. Lo descarga en una máquina/sesión dentro de la LAN real.
4. Ahí se corre el runbook contra el teclado real y se captura el primer
   evento real.
5. Esa captura (`.raw`) se trae de vuelta para construir el parser real
   de `AccessControllerEvent` (gap documentado en
   [Hallazgos Hikvision](hallazgos-hikvision.md)).

## Fase 2 — Parseo real del evento + modelo de datos

Con el `.raw` real en mano: identificar los campos (PIN usado, puerta,
hora, identificador de persona) y definir el modelo de datos mínimo
(evento de acceso: casa, PIN, hora, teclado de origen).

## Fase 3 — Disparo de capturas CCTV

Al recibir el evento, disparar captura de las 3 cámaras (incluida la de
placas) y asociarlas al evento. Requiere investigar la API del CCTV en
cuestión (no cubierta todavía por los manuales que tenemos — son de
teclados/ISAPI general, no del NVR/cámaras específico de este sitio).

## Fase 4 — Pipeline de placa / marca / modelo

Evaluar reuso/adaptación de `lpr-caseta` (Python, OpenCV + YOLO +
`fast-plate-ocr`) como servicio `apps/vision`, invocado por `apps/api`
sobre las capturas de la Fase 3.

## Fase 5 — Padrón y auditoría

Vehículo↔domicilio↔PIN. Detección de patrones (autos más usados por casa,
límite según cajones del modelo de casa, cruces a domicilios ajenos).

## Fase 6 — Dashboard

`apps/web` (Next.js): herramientas para el administrador — ver los 2
autos más usados por casa, autorizar/restringir, exportar evidencia para
abordar al vecino moroso.

## Fase 7 — Integración con `vistara`

Definir mecanismo de "vaciar a vistara" (API vs. export batch) del padrón
de morosos detectados.

---

Scaffold del monorepo (`pnpm` + Turborepo, `apps/api` NestJS + `apps/web`
Next.js + `libs/`) se arma **al cerrar Fase 1**, no antes — para que el
modelo de datos inicial (Fase 2) esté basado en el payload real del
evento y no en una suposición.
