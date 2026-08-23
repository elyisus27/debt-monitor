/**
 * ingest.js
 * ----------
 * Camino de "produccion" (informal, sigue siendo un prototipo dentro de
 * tools/httphosts-probe) para recibir eventos httpHosts: en el MISMO
 * proceso que atiende el POST se parsea, se filtra el ruido y se guarda
 * el cruce real directo en SQLite. No hay archivo intermedio ni proceso
 * aparte vigilando disco (esa era la arquitectura de depuracion de Fase 1
 * con listener.js + watch-events.js - util para inspeccionar bytes crudos,
 * pero no para esto).
 *
 * listener.js sigue existiendo tal cual, sin tocar, como herramienta de
 * depuracion cruda (dump a .raw) para cuando aparezca un campo/evento que
 * no reconozcamos.
 *
 * Criterio de filtrado (igual que parse-captures.js / watch-events.js,
 * ver developersDocs/docs/hallazgos-hikvision.md): NO por subEventType
 * fijo - por eventType=AccessControllerEvent + presencia de
 * name/employeeNoString.
 *
 * Uso:
 *   node ingest.js [puerto]
 *   (puerto por defecto: 9100 - distinto al de listener.js para poder
 *   correr los dos en paralelo mientras se compara)
 *
 * Fotos del evento (2026-08-22): se descartó el enfoque de video (clips
 * ISAPI/ContentMgmt) - el MP4 que exporta el DVR no trae el moov atom al
 * frente ("faststart"), el navegador no lo reproduce sin remux, y encima
 * el post-mortem por hora ya se abandonó (ver fases.md, riesgo de reloj
 * no sincronizado). En vez de eso: snapshot JPEG del canal en vivo
 * (/ISAPI/Streaming/channels/<ID>/picture), tomado en el instante en que
 * llega el evento real - no hace falta buscar por hora ni depender de
 * cuanto retiene el DVR. Requiere ISAPI_HOST/ISAPI_USER/ISAPI_PASS por
 * variable de entorno; si faltan, ingest.js sigue guardando eventos igual,
 * solo sin foto (nunca bloquea lo ya probado de Fase 2 por esto).
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.argv[2]) || 9100;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'events.db');
const PHOTOS_DIR = path.join(__dirname, 'captures', 'event-photos');

const ISAPI_HOST = process.env.ISAPI_HOST;
const ISAPI_PORT = process.env.ISAPI_PORT || '80';
const ISAPI_USER = process.env.ISAPI_USER;
const ISAPI_PASS = process.env.ISAPI_PASS;
const FOTOS_HABILITADAS = Boolean(ISAPI_HOST && ISAPI_USER && ISAPI_PASS);

// Mapeo confirmado 2026-08-22 (ver hallazgos-hikvision.md) -- IDs de streaming
// (canal*100+1). Entrada trae 3 vistas (general, plumas, placas); salida solo 1.
const CANALES_POR_PUERTA = {
  entrada: ['101', '301', '1701'],
  salida: ['201'],
};
const CANAL_PLACAS = '1701'; // única cámara dedicada a placa -- no hay equivalente
                              // para salida (limitación conocida, no resuelta)
const PLATE_SERVICE_URL = process.env.PLATE_SERVICE_URL || 'http://127.0.0.1:9300/read-plate';

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (FOTOS_HABILITADAS && !fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS access_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    serial_no INTEGER,
    casa_unidad TEXT NOT NULL,
    employee_no TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    puerta TEXT NOT NULL,
    device_name TEXT,
    verify_mode TEXT,
    sub_event_type INTEGER,
    door_no INTEGER,
    card_reader_no INTEGER,
    raw_payload TEXT,
    received_at TEXT NOT NULL,
    photo_paths TEXT,
    UNIQUE(ip_address, serial_no)
  );
  CREATE INDEX IF NOT EXISTS idx_access_events_casa ON access_events(casa_unidad);
  CREATE INDEX IF NOT EXISTS idx_access_events_timestamp ON access_events(timestamp);
`);
// access_events puede ya existir de antes de que existiera photo_paths (Fase 2) --
// ALTER TABLE ADD COLUMN falla si ya está, así que se intenta y se ignora ese error.
try {
  db.exec(`ALTER TABLE access_events ADD COLUMN photo_paths TEXT`);
} catch (err) {
  if (!/duplicate column/i.test(err.message)) throw err;
}
// Fase 4 (2026-08-23): lectura de placa vía tools/plate-reader/ sobre la foto del
// canal "Placas". plate_reason queda null si se leyó bien; si no, explica por qué
// (sin_vehiculo_detectado, placa_no_legible, etc.) -- ver plate_ocr.py.
for (const col of ['plate_text TEXT', 'plate_confidence REAL', 'plate_reason TEXT']) {
  try {
    db.exec(`ALTER TABLE access_events ADD COLUMN ${col}`);
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
}

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO access_events
    (ip_address, serial_no, casa_unidad, employee_no, timestamp, puerta, device_name,
     verify_mode, sub_event_type, door_no, card_reader_no, raw_payload, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updatePhotosStmt = db.prepare(`UPDATE access_events SET photo_paths = ? WHERE id = ?`);
const updatePlateStmt = db.prepare(
  `UPDATE access_events SET plate_text = ?, plate_confidence = ?, plate_reason = ? WHERE id = ?`
);

let digestFetchPromise = null;
function getDigestFetch() {
  // digestFetch vive en tools/dvr-video (ESM) -- import() dinámico para no
  // duplicar el algoritmo de Digest Auth aquí en CommonJS.
  if (!digestFetchPromise) {
    digestFetchPromise = import('../dvr-video/isapiDigest.mjs').then((m) => m.digestFetch);
  }
  return digestFetchPromise;
}

let avisoFotosDeshabilitadas = false;

async function capturarFotosEvento(eventId, puerta) {
  if (!FOTOS_HABILITADAS) {
    if (!avisoFotosDeshabilitadas) {
      console.log('(fotos deshabilitadas: falta ISAPI_HOST/ISAPI_USER/ISAPI_PASS)');
      avisoFotosDeshabilitadas = true;
    }
    return;
  }
  const canales = CANALES_POR_PUERTA[puerta] || [];
  if (canales.length === 0) return;

  const digestFetch = await getDigestFetch();
  const baseUrl = `http://${ISAPI_HOST}:${ISAPI_PORT}`;
  const rutas = [];

  for (const canal of canales) {
    const rutaRelativa = `event-photos/event${eventId}_ch${canal}.jpg`;
    try {
      // Sin videoResolutionWidth/Height el equipo regresa 704x480 (substream) aunque
      // el canal soporte 1080p -- confirmado 2026-08-22 comparando ambos casos contra
      // el DVR real. Pedimos la resolución explícita siempre.
      const res = await digestFetch(baseUrl, `/ISAPI/Streaming/channels/${canal}/picture?videoResolutionWidth=1920&videoResolutionHeight=1080`, {
        method: 'GET',
        username: ISAPI_USER,
        password: ISAPI_PASS,
      });
      if (res.status !== 200) {
        console.error(`  foto canal ${canal} (evento ${eventId}): HTTP ${res.status}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(__dirname, 'captures', rutaRelativa), buffer);
      rutas.push(rutaRelativa);
    } catch (err) {
      console.error(`  foto canal ${canal} (evento ${eventId}): ${err.message}`);
    }
  }

  if (rutas.length > 0) {
    updatePhotosStmt.run(JSON.stringify(rutas), eventId);
    console.log(`  fotos guardadas (evento ${eventId}): ${rutas.join(', ')}`);
  }

  const rutaPlaca = rutas.find((r) => r.includes(`_ch${CANAL_PLACAS}.`));
  if (rutaPlaca) {
    await leerPlaca(eventId, rutaPlaca);
  }
}

async function leerPlaca(eventId, rutaRelativaFoto) {
  const imagePath = path.join(__dirname, 'captures', rutaRelativaFoto);
  try {
    const res = await fetch(PLATE_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: imagePath }),
    });
    if (!res.ok) {
      console.error(`  placa (evento ${eventId}): servicio respondió HTTP ${res.status}`);
      return;
    }
    const result = await res.json();
    updatePlateStmt.run(result.plate || null, result.confidence ?? null, result.reason || null, eventId);
    if (result.plate) {
      console.log(`  PLACA (evento ${eventId}): ${result.plate} (conf=${result.confidence.toFixed(2)})`);
    } else {
      console.log(`  placa (evento ${eventId}): sin lectura (${result.reason})`);
    }
  } catch (err) {
    // Servicio caído/no disponible -- no debe tumbar ingest.js, solo esta lectura.
    console.error(`  placa (evento ${eventId}): error llamando al servicio (${err.message})`);
  }
}

function extractJsonPart(buf) {
  const text = buf.toString('utf8');
  const idx = text.indexOf('application/json');
  if (idx === -1) return null;
  const braceStart = text.indexOf('{', idx);
  if (braceStart === -1) return null;
  const boundaryIdx = text.indexOf('--MIME_boundary', braceStart);
  const braceEnd = boundaryIdx === -1 ? text.lastIndexOf('}') : text.lastIndexOf('}', boundaryIdx);
  if (braceEnd === -1) return null;
  try {
    return JSON.parse(text.slice(braceStart, braceEnd + 1));
  } catch {
    return null;
  }
}

function inferPuerta(deviceName, ip) {
  const n = (deviceName || '').toLowerCase();
  if (n.includes('salida')) return 'salida';
  if (n.includes('entrada')) return 'entrada';
  if (ip === '192.168.100.103') return 'salida';
  if (ip === '192.168.100.104') return 'entrada';
  return 'desconocida';
}

let recibidos = 0;
let ruido = 0;
let guardados = 0;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    recibidos++;
    const body = Buffer.concat(chunks);

    // Responder rapido siempre, el equipo espera una respuesta pronta -
    // el procesamiento no debe bloquear el ack.
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');

    const json = extractJsonPart(body);
    if (!json || json.eventType !== 'AccessControllerEvent') {
      ruido++;
      return;
    }
    const ace = json.AccessControllerEvent || {};
    if (!ace.name || !ace.employeeNoString) {
      ruido++;
      return; // puerta abrio/cerro, diagnostico, etc. - se descarta, nunca toca disco
    }

    const puerta = inferPuerta(ace.deviceName, json.ipAddress);
    try {
      const result = insertStmt.run(
        json.ipAddress || null,
        ace.serialNo ?? null,
        ace.name.trim(),
        ace.employeeNoString,
        json.dateTime || null,
        puerta,
        ace.deviceName || null,
        ace.currentVerifyMode || null,
        ace.subEventType ?? null,
        ace.doorNo ?? null,
        ace.cardReaderNo ?? null,
        JSON.stringify(json),
        new Date().toISOString()
      );
      if (result.changes > 0) {
        guardados++;
        console.log(
          `CRUCE ${json.dateTime} casa=${ace.name.trim()} puerta=${puerta} modo=${ace.currentVerifyMode || '?'}`
        );
        // Fire-and-forget: no bloquea el ack al teclado ni el siguiente POST
        // (el ack ya se mandó arriba, antes de tocar la DB).
        capturarFotosEvento(result.lastInsertRowid, puerta).catch((err) =>
          console.error(`  error capturando fotos (evento ${result.lastInsertRowid}): ${err.message}`)
        );
      } else {
        console.log(
          `DUPLICADO ignorado (ip=${json.ipAddress} serialNo=${ace.serialNo}, ya existia)`
        );
      }
    } catch (err) {
      console.error(`Error guardando evento (serialNo=${ace.serialNo}): ${err.message}`);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ingest.js escuchando en 0.0.0.0:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log('Esperando eventos... (Ctrl+C para salir)');
});

process.on('SIGINT', () => {
  console.log(`\nTotales: recibidos=${recibidos} ruido=${ruido} guardados=${guardados}`);
  db.close();
  process.exit(0);
});
