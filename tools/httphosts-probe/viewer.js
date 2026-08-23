/**
 * viewer.js
 * ---------
 * Visor mínimo de `access_events` (Fase 2) vía navegador — pensado para
 * sesión remota (SSH) sin acceso a navegación de archivos local.
 *
 * Cero dependencias (mismo criterio que el resto de tools/httphosts-probe/):
 * solo `http` + `node:sqlite` del propio Node. Una sola página HTML servida
 * en `/`, que pide datos a `/api/events` (JSON) por fetch.
 *
 * No modifica el schema de Fase 2 ni la DB — es solo lectura. La columna
 * "foto" muestra el/los snapshot(s) reales que ingest.js va capturando por
 * evento (columna photo_paths, Fase 3) — "sin foto" para eventos viejos o
 * si la captura falló.
 *
 * Uso:
 *   node viewer.js [puerto]   (default 9200)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.argv[2]) || 9200;
const DB_PATH = path.join(__dirname, 'data', 'events.db');
const SNAPSHOTS_DIR = path.join(__dirname, 'captures', 'dvr-snapshots');
const CLIPS_DIR = path.join(__dirname, '..', 'dvr-video', 'clips');
const EVENT_PHOTOS_DIR = path.join(__dirname, 'captures', 'event-photos');

const db = new DatabaseSync(DB_PATH, { readOnly: true });

// Canal DVR (192.168.100.153) -> nombre de sitio, para la página de calibración.
// Mapeo confirmado 2026-08-22: entrada = canales 1,3,17 | salida = canal 2.
// El 5 ("Salida residentes") es de las antenas RFID, otro sistema, no aplica aquí.
const DVR_CHANNELS = [
  { file: 'ch101.jpg', canal: 1, nombre: 'Entrada Residentes', uso: 'entrada' },
  { file: 'ch201.jpg', canal: 2, nombre: 'Salida visitas', uso: 'salida' },
  { file: 'ch301.jpg', canal: 3, nombre: 'Plumas de ingreso', uso: 'entrada' },
  { file: 'ch401.jpg', canal: 4, nombre: 'Caseta interior', uso: null },
  { file: 'ch501.jpg', canal: 5, nombre: 'Salida residentes (antenas RFID, otro sistema)', uso: null },
  { file: 'ch1701.jpg', canal: 17, nombre: 'Placas (cámara IP proxied, 192.168.100.2)', uso: 'entrada' },
];

function dvrSnapshotsPage() {
  const cards = DVR_CHANNELS.map(c => `
    <div class="card">
      <img src="/dvr-snapshots/${c.file}" alt="canal ${c.canal}">
      <div><strong>Canal ${c.canal}</strong> — ${c.nombre}${c.uso ? ` <span style="opacity:.7">(usar en ${c.uso})</span>` : ''}</div>
    </div>
  `).join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>debt-monitor — canales DVR</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 2rem; }
  h1 { font-size: 1.3rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; }
  .card { border: 1px solid #8883; border-radius: 8px; padding: .5rem; }
  .card img { width: 100%; border-radius: 4px; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>Canales del DVR (192.168.100.153) — mapeo confirmado 2026-08-22</h1>
<p>Entrada = canales 1, 3, 17 (Placas). Salida = canal 2. El 5 es de las antenas RFID, otro sistema.</p>
<div class="grid">${cards}</div>
<p><a href="/">&laquo; Volver a eventos</a></p>
</body>
</html>`;
}

const PAGE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>debt-monitor — eventos de acceso</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 960px; }
  h1 { font-size: 1.3rem; }
  .bar { display: flex; gap: .5rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
  input, select, button { padding: .4rem .6rem; font-size: .95rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #8883; font-size: .9rem; }
  th { position: sticky; top: 0; background: Canvas; }
  .foto-pendiente { opacity: .5; font-style: italic; }
  .thumb { height: 48px; border-radius: 4px; margin-right: 4px; vertical-align: middle; }
  .puerta-entrada { color: #2a7; }
  .puerta-salida { color: #a72; }
  .paginacion { display: flex; gap: .5rem; align-items: center; margin-top: 1rem; }
  #status { color: #888; font-size: .85rem; }
</style>
</head>
<body>
<h1>debt-monitor — eventos de acceso (Fase 2)</h1>
<div class="bar">
  <input id="q" placeholder="Filtrar por casa (ej. 972-05)" />
  <select id="puerta">
    <option value="">Todas las puertas</option>
    <option value="entrada">Entrada</option>
    <option value="salida">Salida</option>
  </select>
  <button id="buscar">Buscar</button>
  <span id="status"></span>
  <a href="/dvr-snapshots" style="margin-left:auto">Ver canales del DVR &raquo;</a>
  <a href="/dvr-clips">Ver clips descargados &raquo;</a>
</div>
<table>
  <thead><tr><th>Casa</th><th>Fecha/hora</th><th>Puerta</th><th>Modo</th><th>Placa</th><th>Foto</th></tr></thead>
  <tbody id="filas"></tbody>
</table>
<div class="paginacion">
  <button id="prev">&laquo; Anterior</button>
  <span id="rango"></span>
  <button id="next">Siguiente &raquo;</button>
</div>
<script>
const LIMIT = 50;
let offset = 0;

async function cargar() {
  const q = document.getElementById('q').value.trim();
  const puerta = document.getElementById('puerta').value;
  const params = new URLSearchParams({ limit: LIMIT, offset });
  if (q) params.set('casa', q);
  if (puerta) params.set('puerta', puerta);

  document.getElementById('status').textContent = 'Cargando...';
  const res = await fetch('/api/events?' + params.toString());
  const { events, total } = await res.json();

  const tbody = document.getElementById('filas');
  tbody.innerHTML = events.map(ev => {
    const fotos = ev.photo_paths && ev.photo_paths.length
      ? ev.photo_paths.map(p => \`<a href="/\${p}" target="_blank"><img src="/\${p}" class="thumb"></a>\`).join('')
      : '<span class="foto-pendiente">sin foto</span>';
    let placa;
    if (ev.plate_text) {
      const pct = ev.plate_confidence * 100;
      const dudosa = pct < 60;
      placa = \`\${ev.plate_text} <span style="opacity:.7\${dudosa ? ';color:#e67e22' : ''}">(\${pct.toFixed(0)}%\${dudosa ? ' ⚠ dudosa' : ''})</span>\`;
    } else {
      placa = \`<span class="foto-pendiente">\${ev.plate_reason || 'sin intentar'}</span>\`;
    }
    return \`
    <tr>
      <td>\${ev.casa_unidad}</td>
      <td>\${ev.timestamp}</td>
      <td class="puerta-\${ev.puerta}">\${ev.puerta}</td>
      <td>\${ev.verify_mode || '-'}</td>
      <td>\${placa}</td>
      <td>\${fotos}</td>
    </tr>
  \`;
  }).join('');

  document.getElementById('status').textContent = total + ' eventos en total';
  document.getElementById('rango').textContent =
    (offset + 1) + '–' + Math.min(offset + LIMIT, total) + ' de ' + total;
  document.getElementById('prev').disabled = offset === 0;
  document.getElementById('next').disabled = offset + LIMIT >= total;
}

document.getElementById('buscar').addEventListener('click', () => { offset = 0; cargar(); });
document.getElementById('q').addEventListener('keydown', e => { if (e.key === 'Enter') { offset = 0; cargar(); } });
document.getElementById('puerta').addEventListener('change', () => { offset = 0; cargar(); });
document.getElementById('prev').addEventListener('click', () => { offset = Math.max(0, offset - LIMIT); cargar(); });
document.getElementById('next').addEventListener('click', () => { offset += LIMIT; cargar(); });

cargar();
</script>
</body>
</html>`;

function dvrClipsPage() {
  let files = [];
  try {
    files = fs.readdirSync(CLIPS_DIR).filter(f => f.endsWith('.mp4')).sort();
  } catch { /* carpeta no existe todavía (nada descargado aún) */ }

  const cards = files.length
    ? files.map(f => `
      <div class="card">
        <video src="/dvr-clips/${f}" controls preload="metadata"></video>
        <div>${f}</div>
      </div>
    `).join('')
    : '<p>Todavía no hay clips descargados (correr <code>tools/dvr-video/fetch-clip.mjs</code>).</p>';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>debt-monitor — clips DVR</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 2rem; }
  h1 { font-size: 1.3rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; }
  .card { border: 1px solid #8883; border-radius: 8px; padding: .5rem; }
  .card video { width: 100%; border-radius: 4px; background: #000; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>Clips de video recuperados del DVR</h1>
<div class="grid">${cards}</div>
<p><a href="/">&laquo; Volver a eventos</a> · <a href="/dvr-snapshots">Ver canales del DVR »</a></p>
</body>
</html>`;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Páginas y listados son dinámicos (reflejan la DB/carpeta en cada request) --
  // sin esto el navegador puede quedarse con una versión vieja cacheada y parecer
  // que "no reacciona" aunque el servidor ya sí tenga los datos actuales.
  res.setHeader('Cache-Control', 'no-store');

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }

  if (url.pathname === '/dvr-snapshots' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dvrSnapshotsPage());
    return;
  }

  if (url.pathname.startsWith('/dvr-snapshots/') && req.method === 'GET') {
    const file = url.pathname.replace('/dvr-snapshots/', '');
    if (!/^[a-zA-Z0-9_.-]+\.jpg$/.test(file)) { sendJson(res, 400, { error: 'nombre inválido' }); return; }
    const filePath = path.join(SNAPSHOTS_DIR, file);
    fs.readFile(filePath, (err, data) => {
      if (err) { sendJson(res, 404, { error: 'no encontrado' }); return; }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(data);
    });
    return;
  }

  if (url.pathname === '/dvr-clips' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dvrClipsPage());
    return;
  }

  if (url.pathname.startsWith('/dvr-clips/') && req.method === 'GET') {
    const file = url.pathname.replace('/dvr-clips/', '');
    if (!/^[a-zA-Z0-9_.-]+\.mp4$/.test(file)) { sendJson(res, 400, { error: 'nombre inválido' }); return; }
    const filePath = path.join(CLIPS_DIR, file);
    fs.readFile(filePath, (err, data) => {
      if (err) { sendJson(res, 404, { error: 'no encontrado' }); return; }
      res.writeHead(200, { 'Content-Type': 'video/mp4' });
      res.end(data);
    });
    return;
  }

  if (url.pathname === '/api/events' && req.method === 'GET') {
    const limit = Math.min(200, Number(url.searchParams.get('limit')) || 50);
    const offset = Number(url.searchParams.get('offset')) || 0;
    const casa = url.searchParams.get('casa');
    const puerta = url.searchParams.get('puerta');

    const where = [];
    const args = [];
    if (casa) { where.push('casa_unidad LIKE ?'); args.push(`%${casa}%`); }
    if (puerta) { where.push('puerta = ?'); args.push(puerta); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) c FROM access_events ${whereSql}`).get(...args).c;
    const events = db.prepare(`
      SELECT casa_unidad, timestamp, puerta, verify_mode, device_name, photo_paths,
             plate_text, plate_confidence, plate_reason
      FROM access_events ${whereSql}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...args, limit, offset).map(ev => ({
      ...ev,
      photo_paths: ev.photo_paths ? JSON.parse(ev.photo_paths) : [],
    }));

    sendJson(res, 200, { events, total });
    return;
  }

  // Fotos reales de Fase 3: snapshot JPEG tomado al momento del evento por
  // ingest.js, guardado en captures/event-photos/. El path que viene en
  // photo_paths (vía /api/events) ya incluye el prefijo "event-photos/".
  if (url.pathname.startsWith('/event-photos/') && req.method === 'GET') {
    const file = url.pathname.replace('/event-photos/', '');
    if (!/^[a-zA-Z0-9_.-]+\.jpg$/.test(file)) { sendJson(res, 400, { error: 'nombre inválido' }); return; }
    const filePath = path.join(EVENT_PHOTOS_DIR, file);
    fs.readFile(filePath, (err, data) => {
      if (err) { sendJson(res, 404, { error: 'no encontrado' }); return; }
      res.writeHead(200, { 'Content-Type': 'image/jpeg' });
      res.end(data);
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`viewer.js escuchando en http://0.0.0.0:${PORT}`);
  console.log(`DB (solo lectura): ${DB_PATH}`);
});

process.on('SIGINT', () => {
  console.log('\nCerrando viewer...');
  db.close();
  process.exit(0);
});
