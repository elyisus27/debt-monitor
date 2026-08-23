"""
service.py
----------
Servicio HTTP local minimo sobre plate_ocr.py -- los modelos se cargan UNA
vez al arrancar (tarda unos segundos) y se quedan en memoria; cada request
solo corre inferencia, no recarga nada. ingest.js (Node) le pega a esto
despues de guardar el snapshot del canal "Placas" de un evento real.

Uso:
    C:\\Users\\lares\\lpr-caseta\\.venv\\Scripts\\python.exe service.py [puerto]
    (puerto por defecto: 9300)
"""
import sys
from flask import Flask, request, jsonify
from plate_ocr import read_plate_from_image, _load_models

app = Flask(__name__)


@app.route("/read-plate", methods=["POST"])
def read_plate():
    data = request.get_json(force=True, silent=True) or {}
    image_path = data.get("image_path")
    if not image_path:
        return jsonify({"error": "falta image_path"}), 400
    try:
        result = read_plate_from_image(image_path)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify(result)


@app.route("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9300
    print("Cargando modelos (vehiculo + placa + OCR)...", flush=True)
    _load_models()
    print(f"Listo. Escuchando en 0.0.0.0:{port}", flush=True)
    app.run(host="0.0.0.0", port=port)
