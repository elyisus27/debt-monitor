/**
 * watch-events.js
 * ----------------
 * Vigila captures/ EN VIVO y emite UNA linea por cada cruce real (mismo
 * criterio de filtrado que parse-captures.js: eventType=AccessControllerEvent
 * + name/employeeNoString presentes). Ignora ruido silenciosamente.
 *
 * Pensado para correr junto a listener.js y conectarse a algo que reaccione
 * por evento (ej. un Monitor) sin recibir cada POST crudo, solo lo util.
 *
 * Uso: node watch-events.js [captures-dir]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || path.join(__dirname, 'captures');
const seen = new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.raw')));

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

console.log(`watch-events.js vigilando ${dir} (${seen.size} .raw preexistentes ignorados, solo reporta nuevos)`);

setInterval(() => {
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.raw'));
  } catch {
    return;
  }
  for (const f of files) {
    if (seen.has(f)) continue;
    seen.add(f);
    let buf;
    try {
      buf = fs.readFileSync(path.join(dir, f));
    } catch {
      continue;
    }
    const json = extractJsonPart(buf);
    if (!json || json.eventType !== 'AccessControllerEvent') continue;
    const ace = json.AccessControllerEvent || {};
    if (!ace.name || !ace.employeeNoString) continue; // ruido, se ignora
    const puerta = inferPuerta(ace.deviceName, json.ipAddress);
    console.log(
      `CRUCE ${json.dateTime} casa=${ace.name.trim()} puerta=${puerta} modo=${ace.currentVerifyMode || '?'} archivo=${f}`
    );
  }
}, 2000);
