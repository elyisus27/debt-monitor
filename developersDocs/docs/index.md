# Debt Monitor

Monitoreo/auditoría de cruce de accesos de casas morosas (residencial) contra el
sistema de control de acceso Hikvision (teclados numéricos con NIP) y el
CCTV del fraccionamiento.

## Qué resuelve

De 504 casas, ~70 son morosas y tienen acceso restringido a NIP en unos
teclados numéricos Hikvision (no tarjeta/tag, sí en el paradigma
`person` + `PIN` de Hikvision). Hoy solo existe **análisis post-mortem**:
exportar el log del teclado y sacar estadística de cruces por casa, ya
después de que pasó.

El objetivo de este proyecto es pasar de post-mortem a **tiempo real +
auditoría de uso**:

1. Escuchar el evento del teclado **en el momento** en que se marca el NIP
   (domicilio, hora).
2. En ese instante, disparar captura de **3 cámaras** del CCTV (LAN, misma
   red que los teclados) — una de ellas de placas.
3. Extraer **placa / marca / modelo** del vehículo que cruzó con ese NIP.
4. Levantar un **padrón**: qué vehículos entran a qué domicilio con qué
   NIP, cuáles son "los 2 autos permitidos" según el modelo de casa
   (1 o 2 cajones), y detectar mal uso (visitas a domicilios que no son
   el suyo, vehículos no autorizados, etc.).
5. Darle al administrador una interfaz para decidir, casa por casa,
   "¿cuál auto vas a querer con acceso?" y para volcar esos morosos
   detectados hacia `vistara` (censo de morosos por domicilio).

## Cómo se relaciona con los proyectos hermanos

Este proyecto **no arranca de cero en aislamiento** — hay dos proyectos
hermanos en el mismo entorno (`C:\ProyectosProasser\VistaSur\`) que ya
resuelven partes del problema. Ver [Arquitectura general](arquitectura.md)
para el detalle de cómo encajan:

- **`vistara`** — ya tiene un módulo `hik-connect` completo (alta de
  persona, emisión y rotación mensual de PIN vía la API cloud de
  HikCentral Connect / `hccgw`). Ese lado **ya está resuelto** ahí; este
  proyecto no lo reimplementa.
- **`lpr-caseta`** — ya tiene un pipeline Python (OpenCV + YOLO +
  `fast-plate-ocr`) que detecta vehículo y hace OCR de placa a partir de
  frames de cámara. Candidato directo a reusar/adaptar para el paso 3
  de arriba en vez de escribir OCR desde cero.

## Estado actual

Ver [Fases del proyecto](fases.md) para el roadmap completo. Ahora mismo
estamos en **Fase 1 — Recepción de eventos**: validar que se puede
enganchar al push HTTP local de los teclados. Ver el detalle en
[Fase 1 — Recepción de eventos](fase1-recepcion-eventos.md).

## Cómo correr esta documentación

```
pip install mkdocs-material
mkdocs serve
```

(mismo patrón que `lpr-caseta/mkdocs.yml`, así que si ya tienes el entorno
de ese proyecto, sirve el mismo).
