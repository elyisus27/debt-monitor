/**
 * backfill.js
 * ------------
 * Carga a la SQLite de ingest.js (data/events.db) el resultado de un
 * batch previo de parse-captures.js (un .json con el arreglo de eventos
 * ya filtrados/parseados). Usa el mismo INSERT OR IGNORE + UNIQUE que
 * ingest.js, asi que correrlo mas de una vez con el mismo archivo no
 * duplica nada.
 *
 * Uso:
 *   node backfill.js <parsed-events.json>
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const inFile = process.argv[2];
if (!inFile) {
  console.error('Uso: node backfill.js <parsed-events.json>');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'events.db');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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

// ipAddress no viene en el .json de parse-captures.js (se perdio al parsear
// a AccessEvent) - se infiere de vuelta desde `puerta`, que si viene.
const IP_BY_PUERTA = { salida: '192.168.100.103', entrada: '192.168.100.104' };

const events = JSON.parse(fs.readFileSync(inFile, 'utf8'));
let insertados = 0;
let duplicados = 0;

for (const ev of events) {
  const ip = IP_BY_PUERTA[ev.puerta] || 'desconocida';
  const result = insertStmt.run(
    ip,
    ev.serialNo ?? null,
    ev.casaUnidad,
    ev.employeeNo,
    ev.timestamp,
    ev.puerta,
    ev.deviceName || null,
    ev.verifyMode || null,
    ev.subEventType ?? null,
    ev.doorNo ?? null,
    ev.cardReaderNo ?? null,
    null, // raw_payload: no se conservo el multipart original en el batch, solo lo ya parseado
    new Date().toISOString()
  );
  if (result.changes > 0) insertados++;
  else duplicados++;
}

console.log(`Backfill de ${inFile}: ${insertados} insertados, ${duplicados} ya existian (ignorados)`);
db.close();
