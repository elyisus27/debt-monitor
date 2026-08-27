"""
plate_ocr.py
------------
Deteccion de vehiculo + lectura de placa sobre UNA imagen ya capturada (el
snapshot del canal "Placas" que ingest.js guarda por evento, Fase 3) -- no
un stream continuo.

No es un port linea por linea de stage1_detect.py/stage2_ocr.py de
lpr-caseta (ese pipeline vigila video 24/7 con tracking por ByteTrack; aqui
no hace falta nada de eso, ya tenemos la foto exacta del momento del NIP).
SI se porta la logica de lectura de placa ya calibrada de stage2_ocr.py
(patrones de placa, correccion J/U, umbral de confianza por caracter en vez
de por deteccion) porque es conocimiento real medido contra produccion, no
algo que tenga sentido re-derivar a ciegas. Fuente:
C:\\Users\\lares\\lpr-caseta\\src\\stage2_ocr.py, revisado 2026-08-23.

Corre con el interprete de lpr-caseta/.venv (ya tiene torch/ultralytics/
opencv/fast-plate-ocr instalados -- no se duplica ese entorno de varios GB
aqui) pero este archivo es codigo propio de debt-monitor, sin imports de
lpr-caseta/src en tiempo de ejecucion. Se omite deliberadamente la
optimizacion OpenVINO de lpr-caseta (calibrada para 24/7 a fps sostenidos) --
aqui corre unas pocas veces al dia, la latencia extra de YOLO en modo normal
no importa y evita replicar tuning fragil para un caso que no aplica.
"""
from __future__ import annotations
import re
import cv2
import numpy as np
from ultralytics import YOLO
from fast_plate_ocr import LicensePlateRecognizer

VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
VEHICLE_CONF_THRESHOLD = 0.2  # 2026-08-23: bajado de 0.4 -- primer evento real (foto
# nitida, auto claramente visible) solo detecto conf=0.27 como "car" (posible efecto
# de la distorsion de lente gran angular de este canal). Se compensa con el filtro de
# clases ya aplicado (classes=VEHICLE_CLASSES.keys() en el propio YOLO call, nunca deja
# pasar "airplane" ni otras clases falsas) + que el paso de placa despues actua como
# segundo filtro real (si no hay auto de verdad, no va a aparecer un rectangulo de
# placa). Sin calibrar mas alla de esta primera muestra -- ver README.md
VEHICLE_IMGSZ = 960  # nuestra imagen es ancha (1920x1080, foto completa del canal,
                      # no un ROI recortado) -- 640 default deja autos chicos sin detectar
VEHICLE_MIN_AREA_RATIO = 0.01  # 2026-08-23: caso real -- con el umbral de confianza ya
# bajado, un auto con las luces muy encandiladas dio 2 cajas "car" de fragmentos chicos
# (~0.2% del cuadro cada una, ningun candidato bueno) en vez de la silueta completa --
# la luz rompe la forma que el detector reconoce como auto, no es un problema de
# threshold. Sin esto se recortaba esa caja basura igual y se le pasaba al OCR sin
# sentido. Valor conservador (un auto real cerca de esta camara mide ~15-20% del
# cuadro segun el primer caso bueno visto) -- sin calibrar mas alla de 2 muestras reales

CROP_PAD_BOTTOM_PX = 25  # mismo hallazgo que lpr-caseta: el bbox de vehiculo a veces
                          # no llega a la placa/defensa
CROP_PAD_SIDE_PX = 20    # 2026-08-23: confirmado con un caso real (LFL790A leido como
                          # FL790A) que el bbox del detector de vehiculo puede cortar
                          # justo al ras de un lado de la placa -- lpr-caseta no necesita
                          # esto porque su bbox sale de tracking sobre video (mejor score
                          # acumulado entre frames), aqui es deteccion en frio sobre una
                          # sola imagen. Valor inicial conservador, sin calibrar contra
                          # mas datos reales todavia (a diferencia de CROP_PAD_BOTTOM_PX,
                          # que si viene de semanas de produccion de lpr-caseta)

PLATE_DET_CONF_THRESHOLD = 0.5  # ¿esto es un rectangulo de placa? (no si se leyo bien)

_PLATE_PATTERNS = [
    re.compile(r'^[A-Z]{3}\d{4}$'),
    re.compile(r'^[A-Z]{3}\d{3}[A-Z]$'),
    re.compile(r'^[A-Z]{2}\d{4}[A-Z]$'),
    re.compile(r'^[A-Z]{2}\d{5}$'),
    re.compile(r'^[A-Z]\d{2}[A-Z]{3}$'),
    re.compile(r'^[A-Z]{3}\d{3}$'),
    re.compile(r'^\d{2}[A-Z]\d{3}$'),   # Jalisco: 61J-729
    re.compile(r'^\d{3}[A-Z]{3}$'),
]

_vehicle_model = None
_plate_detector = None
_ocr = None
_clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))


def _load_models():
    global _vehicle_model, _plate_detector, _ocr
    if _vehicle_model is None:
        _vehicle_model = YOLO("yolov8n.pt")
    if _plate_detector is None:
        from huggingface_hub import hf_hub_download
        pt_path = hf_hub_download(
            repo_id="Koushim/yolov8-license-plate-detection", filename="best.pt"
        )
        _plate_detector = YOLO(pt_path)
    if _ocr is None:
        _ocr = LicensePlateRecognizer("global-plates-mobile-vit-v2-model")


def _normalize(text: str) -> str:
    """Mayúsculas, solo letras y números -- este es también el formato final
    que se guarda (2026-08-27: se quitó el guionado tipo "ABC-123-D" que
    tenía _format_plate; ver normalizarPlaca() en plate.service.ts del lado
    Node, que aplica el mismo criterio a capturas manuales)."""
    return re.sub(r'[^A-Z0-9]', '', text.upper())


def _try_j_u_correction(raw: str) -> str | None:
    # error sistemico documentado en lpr-caseta (~13/32 errores de una muestra real):
    # OCR lee U en vez de J en el primer caracter de placas Jalisco.
    if not raw or raw[0] != "U":
        return None
    candidate = "J" + raw[1:]
    return candidate if any(p.match(candidate) for p in _PLATE_PATTERNS) else None


def _enhance(image: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = _clahe.apply(lab[:, :, 0])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def _detect_vehicle(image: np.ndarray):
    """Mejor vehiculo detectado en la imagen completa, o None. Descarta cajas
    implausiblemente chicas (VEHICLE_MIN_AREA_RATIO) antes de rankear por
    confianza -- un fragmento chico con confianza alta no debe ganarle a
    nada si ni siquiera parece el vehiculo completo."""
    h, w = image.shape[:2]
    frame_area = h * w
    results = _vehicle_model(
        image, imgsz=VEHICLE_IMGSZ, verbose=False, classes=list(VEHICLE_CLASSES.keys())
    )[0]
    if not results.boxes:
        return None

    candidates = []
    for box in results.boxes:
        conf = float(box.conf[0])
        if conf < VEHICLE_CONF_THRESHOLD:
            continue
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        area_ratio = ((x2 - x1) * (y2 - y1)) / frame_area
        if area_ratio < VEHICLE_MIN_AREA_RATIO:
            continue
        candidates.append((conf, x1, y1, x2, y2, int(box.cls[0])))

    if not candidates:
        return None
    conf, x1, y1, x2, y2, cls = max(candidates, key=lambda c: c[0])
    return int(x1), int(y1), int(x2), int(y2), VEHICLE_CLASSES[cls], conf


def _read_plate_from_crop(crop: np.ndarray) -> tuple[str, float] | None:
    """Misma logica que stage2_ocr.read_plate() de lpr-caseta -- detector de
    placa + OCR + patrones/correccion, sobre un recorte ya centrado en el
    vehiculo (no la imagen completa)."""
    image = _enhance(crop)
    det_results = _plate_detector(image, verbose=False, imgsz=640)[0]
    if not det_results.boxes:
        return None

    best = max(det_results.boxes, key=lambda b: float(b.conf[0]))
    plate_conf = float(best.conf[0])
    if plate_conf < PLATE_DET_CONF_THRESHOLD:
        return None

    x1, y1, x2, y2 = [int(v) for v in best.xyxy[0].tolist()]
    pw, ph = x2 - x1, y2 - y1
    if ph == 0 or (pw / ph) < 1.1:  # placa real siempre mas ancha que alta
        return None

    plate_crop = image[y1:y2, x1:x2]
    if plate_crop.size == 0:
        return None

    gray = cv2.cvtColor(plate_crop, cv2.COLOR_BGR2GRAY)
    results = _ocr.run(gray, return_confidence=True)
    if not results:
        return None

    raw_plate = results[0].plate
    raw = _normalize(raw_plate)
    if not raw:
        return None

    # char_probs (por caracter) es la confianza real de lectura -- NO plate_conf
    # (esa solo dice "esto es un rectangulo de placa", no si se leyo bien). Mismo
    # hallazgo que lpr-caseta 2026-08-15.
    char_probs = results[0].char_probs
    ocr_conf = float(min(char_probs[:len(raw_plate)])) if char_probs is not None else plate_conf

    if any(p.match(raw) for p in _PLATE_PATTERNS):
        corrected = _try_j_u_correction(raw)
        return (corrected or raw), ocr_conf

    letters = sum(c.isalpha() for c in raw)
    digits = sum(c.isdigit() for c in raw)
    if 6 <= len(raw) <= 8 and letters >= 2 and digits >= 2:
        return raw, ocr_conf
    return None


def read_plate_from_image(image_path: str) -> dict:
    """Punto de entrada: ruta de imagen -> resultado. Nunca lanza por casos
    esperados (sin vehiculo, sin placa legible) -- reason describe por que."""
    _load_models()

    image = cv2.imread(image_path)
    if image is None:
        return {"plate": None, "reason": "no_se_pudo_leer_imagen"}

    vehicle = _detect_vehicle(image)
    if vehicle is None:
        return {"plate": None, "reason": "sin_vehiculo_detectado"}

    x1, y1, x2, y2, label, vconf = vehicle
    h, w = image.shape[:2]
    x1p = max(0, x1 - CROP_PAD_SIDE_PX)
    x2p = min(w, x2 + CROP_PAD_SIDE_PX)
    y2p = min(h, y2 + CROP_PAD_BOTTOM_PX)
    crop = image[y1:y2p, x1p:x2p]
    if crop.size == 0:
        return {"plate": None, "reason": "recorte_vacio", "vehicle_label": label, "vehicle_conf": vconf}

    result = _read_plate_from_crop(crop)
    if result is None:
        return {"plate": None, "reason": "placa_no_legible", "vehicle_label": label, "vehicle_conf": vconf}

    plate, conf = result
    return {
        "plate": plate,
        "confidence": conf,
        "vehicle_label": label,
        "vehicle_conf": vconf,
        "reason": None,
    }
