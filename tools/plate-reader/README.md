# plate-reader

Servicio HTTP local que lee la placa de un vehículo a partir de UNA imagen
(el snapshot del canal "Placas" que `ingest.js` ya guarda por evento, ver
`tools/httphosts-probe/`). No vigila video en vivo — recibe una ruta de
imagen y regresa el resultado.

## Por qué existe este código (y no se llama directo al de `lpr-caseta`)

`lpr-caseta` (`C:\Users\lares\lpr-caseta`) ya tiene un pipeline completo de
detección de vehículo + lectura de placa, corriendo 24/7 contra la misma
cámara IP de placas (`192.168.100.2`) vía RTSP + tracking. Se evaluaron 3
formas de reusarlo (ver `developersDocs/docs/fases.md`, Fase 4) y se optó
por **reescribir la lógica de lectura aquí, en Python propio de
debt-monitor** — mismo criterio que `tools/dvr-video/`:

- No se llama a su `webapp.py` en vivo — evita acoplar dos sistemas en
  producción (si su servicio cae o cambia, no debe tumbar esto) y evita
  insertar duplicados en su base de datos (`lpr.db`) por cada evento
  nuestro.
- Sí se **reusa el entorno Python ya instalado** en
  `lpr-caseta\.venv` (torch/ultralytics/opencv/fast-plate-ocr/openvino) —
  duplicar esos paquetes (varios GB) no tiene sentido estando en la misma
  máquina. Este servicio corre con ESE intérprete, pero el código
  (`plate_ocr.py`, `service.py`) es propio, sin importar nada de
  `lpr-caseta/src` en tiempo de ejecución.
- La lógica de lectura de placa (patrones, corrección J/U, umbral de
  confianza por carácter) SÍ se portó de `stage2_ocr.py` — es calibración
  real medida contra semanas de producción, no algo que valga la pena
  re-derivar a ciegas.

## Diferencia clave con `lpr-caseta`

`lpr-caseta` vigila un stream y usa tracking (ByteTrack) para acumular el
mejor recorte de un vehículo a lo largo de varios frames antes de intentar
OCR. Aquí no hay stream ni tracking — es una sola imagen ya capturada, así
que se agregó un paso propio de **detección de vehículo en frío**
(`_detect_vehicle` en `plate_ocr.py`, YOLOv8n genérico de Ultralytics)
para encontrar el auto en la foto completa antes de recortar y pasarle el
recorte al lector de placa.

## Uso

```powershell
cd tools\plate-reader
C:\Users\lares\lpr-caseta\.venv\Scripts\python.exe service.py 9300
```

`ingest.js` le pega a `http://127.0.0.1:9300/read-plate` (configurable con
`PLATE_SERVICE_URL`) después de guardar la foto del canal de placas.

```
POST /read-plate
{"image_path": "C:/ruta/absoluta/a/la/foto.jpg"}

-> {"plate": "LFL-790-A", "confidence": 0.96, "vehicle_label": "car", "vehicle_conf": 0.64, "reason": null}
-> {"plate": null, "reason": "sin_vehiculo_detectado"}   -- no se detectó ningún vehículo
-> {"plate": null, "reason": "placa_no_legible", ...}    -- sí hay vehículo, la placa no se pudo leer
```

## Estado de calibración (honesto, 2026-08-23)

Probado contra 3 fotos reales de `lpr-caseta\captures\` (ya con placa
confirmada en su `placas.txt`): 1/3 exitosa en el primer intento, 3/3
después de agregar margen lateral al recorte de vehículo
(`CROP_PAD_SIDE_PX`, no existía en el código original — ahí el bbox sale
de tracking sobre video, aquí es detección en frío sobre una imagen fija,
recorta distinto). **Esas pruebas usan fotos ya muy recortadas por el otro
pipeline — no son representativas de nuestra entrada real** (foto ancha
completa del canal "Placas", auto de tamaño variable en el cuadro). Falta
validar contra un evento real de nuestra propia cámara con auto en cuadro
— la calibración real, como con `lpr-caseta`, va a venir de datos de
producción, no de ajustar a ciegas de antemano.
