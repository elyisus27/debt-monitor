// Busca y descarga clips de video ISAPI para UN evento puntual, probando varios canales
// candidatos a la vez. Pensado para calibración rápida (confirmar canal/ventana) antes de
// correr un batch contra la lista completa de cruces guardados en access_events.
//
// Canales confirmados en este sitio (ver developersDocs/docs/hallazgos-hikvision.md):
//   entrada -> 101 (Entrada Residentes), 301 (Plumas de ingreso), 1701 (Placas)
//   salida  -> 201 (Salida visitas)
//
// Credenciales SIEMPRE por variable de entorno -- nunca en el código ni en comentarios
// (ni siquiera como ejemplo con la clave real; usar un placeholder).
//
// Uso:
//   ISAPI_HOST=192.168.100.153 ISAPI_USER=admin ISAPI_PASS=<clave> \
//   node fetch-clip.mjs --time "2026-08-22T11:57:37" --channels 101,301,1701 --before 0 --after 15
//
// --time es la hora TAL CUAL aparece en access_events.timestamp (hora local del sitio,
// sin convertir zona horaria -- ver isapiVideo.mjs para el porqué).
// Si esto devuelve 0 resultados en TODOS los canales (incluyendo uno que sabes que sí
// grabó), sospecha primero de timezone: correr antes
//   curl --digest -u admin:<usuario> "http://192.168.100.153/ISAPI/System/time"

import { mkdir } from 'node:fs/promises';
import { parseNaiveLocal, toSearchIso, searchChannel, countMatches, downloadClip } from './isapiVideo.mjs';

const HOST = process.env.ISAPI_HOST;
const PORT = process.env.ISAPI_PORT || '80';
const USER = process.env.ISAPI_USER;
const PASS = process.env.ISAPI_PASS;
const RTSP_HOST = process.env.ISAPI_RTSP_HOST || HOST;

if (!HOST || !USER || !PASS) {
  console.error('Faltan ISAPI_HOST / ISAPI_USER / ISAPI_PASS (variables de entorno)');
  process.exit(1);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { before: '0', after: '15', outDir: 'clips' };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, '');
    if (key) opts[key] = args[i + 1];
  }
  if (!opts.time) {
    console.error('Falta --time "YYYY-MM-DDTHH:MM:SS" (hora local, tal cual access_events.timestamp)');
    process.exit(1);
  }
  if (!opts.channels) {
    console.error('Falta --channels (ej. 101,301,1701 para entrada; 201 para salida)');
    process.exit(1);
  }
  return opts;
}

const opts = parseArgs();
const centerTime = parseNaiveLocal(opts.time);
if (!centerTime || Number.isNaN(centerTime.getTime())) {
  console.error(`--time inválido: ${opts.time} (formato esperado: YYYY-MM-DDTHH:MM:SS)`);
  process.exit(1);
}
const startTime = new Date(centerTime.getTime() - Number(opts.before) * 1000);
const endTime = new Date(centerTime.getTime() + Number(opts.after) * 1000);
const channels = String(opts.channels).split(',').map((c) => c.trim());

const BASE_URL = `http://${HOST}:${PORT}`;

async function run() {
  await mkdir(opts.outDir, { recursive: true });
  console.log(`Ventana: ${toSearchIso(startTime)} .. ${toSearchIso(endTime)} | canales: [${channels.join(', ')}]`);

  for (const channelId of channels) {
    const { status, text } = await searchChannel({ baseUrl: BASE_URL, user: USER, pass: PASS, channelId, startTime, endTime });
    console.log(`\n=== Canal ${channelId} -- search HTTP ${status} ===`);
    if (status !== 200) {
      console.log(text.slice(0, 500));
      continue;
    }
    const numMatches = countMatches(text);
    if (numMatches === 0) {
      console.log('Sin grabación en esta ventana para este canal.');
      continue;
    }
    console.log(`${numMatches} segmento(s) de grabación cubren la ventana. Descargando clip acotado...`);
    const fileName = `ch${channelId}_${opts.time.replace(/[:]/g, '-')}.mp4`;
    const outPath = `${opts.outDir}/${fileName}`;
    try {
      const bytes = await downloadClip({ baseUrl: BASE_URL, rtspHost: RTSP_HOST, user: USER, pass: PASS, channelId, startTime, endTime, outPath });
      console.log(`  -> ${outPath} (${bytes} bytes)`);
    } catch (err) {
      console.log(`  -> ERROR descargando: ${err.message}`);
    }
  }
}

run();
