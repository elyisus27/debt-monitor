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
 */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.argv[2]) || 9100;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'events.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
    UNIQUE(ip_address, serial_no)
  );
  CREATE INDEX IF NOT EXISTS idx_access_events_casa ON access_events(casa_unidad);
  CREATE INDEX IF NOT EXISTS idx_access_events_timestamp ON access_events(timestamp);
`);

const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO access_events
    (ip_address, serial_no, casa_unidad, employee_no, timestamp, puerta, device_name,
     verify_mode, sub_event_type, door_no, card_reader_no, raw_payload, received_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

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
