/**
 * parse-captures.js
 * ------------------
 * Parser batch de Fase 2: toma los .raw crudos capturados por listener.js
 * (via httpHosts) y los convierte al modelo AccessEvent minimo, filtrando
 * ruido (todo lo que no sea un cruce real con identidad: puertas
 * abrir/cerrar sueltas, videoloss, excepciones de red/voltaje, etc.).
 *
 * Criterio de filtrado (ver developersDocs/docs/hallazgos-hikvision.md):
 * NO se filtra por subEventType fijo (el fabricante documenta mal sus
 * propios codigos - ver el gap de `capabilities`). Se filtra por
 * eventType=AccessControllerEvent + presencia de name/employeeNoString,
 * que es la señal real de "alguien se identifico".
 *
 * Uso:
 *   node parse-captures.js <directorio-con-.raw> [salida.json]
 *
 * Solo lee del directorio de origen, no lo modifica.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const srcDir = process.argv[2];
const outFile = process.argv[3];

if (!srcDir) {
  console.error('Uso: node parse-captures.js <dir-con-.raw> [salida.json]');
  process.exit(1);
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

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.raw'));

const events = [];
const stats = {
  totalArchivos: files.length,
  sinParsear: 0,
  noAccessController: 0,
  ruidoSinIdentidad: 0,
  cruceReal: 0,
  porSubEventType: {},
  porPuerta: {},
  casasUnicas: new Set(),
  rangoFechas: { min: null, max: null },
};

for (const f of files) {
  const buf = fs.readFileSync(path.join(srcDir, f));
  const json = extractJsonPart(buf);
  if (!json) {
    stats.sinParsear++;
    continue;
  }
  if (json.eventType !== 'AccessControllerEvent') {
    stats.noAccessController++;
    continue;
  }
  const ace = json.AccessControllerEvent || {};
  const key = `${ace.majorEventType}/${ace.subEventType}`;
  stats.porSubEventType[key] = (stats.porSubEventType[key] || 0) + 1;

  const tieneIdentidad = Boolean(ace.name && ace.employeeNoString);
  if (!tieneIdentidad) {
    stats.ruidoSinIdentidad++;
    continue;
  }

  const puerta = inferPuerta(ace.deviceName, json.ipAddress);
  stats.porPuerta[puerta] = (stats.porPuerta[puerta] || 0) + 1;
  stats.casasUnicas.add(ace.name.trim());
  stats.cruceReal++;

  if (json.dateTime) {
    if (!stats.rangoFechas.min || json.dateTime < stats.rangoFechas.min) stats.rangoFechas.min = json.dateTime;
    if (!stats.rangoFechas.max || json.dateTime > stats.rangoFechas.max) stats.rangoFechas.max = json.dateTime;
  }

  events.push({
    casaUnidad: ace.name.trim(),
    employeeNo: ace.employeeNoString,
    timestamp: json.dateTime,
    puerta,
    deviceName: ace.deviceName,
    verifyMode: ace.currentVerifyMode || null,
    subEventType: ace.subEventType,
    doorNo: ace.doorNo ?? null,
    cardReaderNo: ace.cardReaderNo ?? null,
    serialNo: ace.serialNo ?? null,
    sourceFile: f,
  });
}

events.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

const statsOut = { ...stats, casasUnicas: stats.casasUnicas.size };

console.log('--- Resumen ---');
console.log(JSON.stringify(statsOut, null, 2));

if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(events, null, 2));
  console.log(`\n${events.length} eventos reales (con identidad) escritos en ${outFile}`);
}
