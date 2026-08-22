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
[Fase 2 — Parseo + modelo de datos](fase2-parseo-modelo-datos.md).

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
Next.js + `libs/`) se arma **al cerrar Fase 2**, no antes — el modelo de
datos mínimo (`access_events`) ya está validado contra datos reales
(ver [Fase 2](fase2-parseo-modelo-datos.md)), así que formalizarlo a
Prisma/NestJS ya no es adivinar. Sigue sin armarse porque Fase 3 (CCTV)
puede cambiar qué necesita guardar el modelo (referencias a capturas de
cámara), y no queremos migrar el schema formal dos veces.
