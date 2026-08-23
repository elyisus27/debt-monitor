// Helpers ISAPI ContentMgmt (search + download) para buscar/descargar video grabado.
//
// Portado 2026-08-22 desde un proyecto hermano (mismo dominio Hikvision, otro caso de
// uso: antenas RFID en vez de teclado NIP) — la lógica de abajo no es específica de ese
// caso, es tribal knowledge real del DVR de este sitio. Todo lo aprendido por prueba real
// contra el DVR (192.168.100.153, firmware V4.70.101, confirmado 2026-07-22 y otra vez
// 2026-08-22) vive aquí:
//
//   - El DVR NO convierte zona horaria pese a la "Z" en sus timestamps -- toma los
//     dígitos de hora local tal cual (el reloj del sitio coincide con la hora real, sin
//     offset). Por eso parseNaiveLocal usa Date.UTC, nunca `new Date(str)` normal (eso
//     aplicaría la zona horaria del proceso donde corre el script y desplazaría los
//     valores). Ver hallazgos-hikvision.md para el porqué esto importa (reloj del
//     teclado vs. reloj del DVR no necesariamente sincronizados).
//   - El formato que funciona para "download by time" es starttime SIN "Z" con espacio
//     ("YYYY-MM-DD HH:MM:SS"), endtime igual pero CON "Z" (isapi.txt, sección de
//     ContentMgmt/download). El formato compacto alternativo ("20170314T103201Z") del
//     manual da "Device Error" en este firmware.
//   - Para no descargar el segmento de grabación completo (puede durar horas), el
//     playbackURI de descarga se arma a mano con SOLO starttime/endtime, sin name/size
//     (incluir name/size fuerza modo "archivo completo").

import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { digestFetch } from './isapiDigest.mjs';

export function parseNaiveLocal(str) {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

export function toSearchIso(date) {
  return date.toISOString().replace(/\.\d+Z$/, 'Z');
}

export function toRtspTime(date, { withZ }) {
  const spaced = date.toISOString().replace(/\.\d+Z$/, '').replace('T', ' ');
  return withZ ? `${spaced}Z` : spaced;
}

function searchBody(channelId, startTime, endTime) {
  return `<?xml version="1.0" encoding="utf-8"?>
<CMSearchDescription>
<searchID>${crypto.randomUUID().toUpperCase()}</searchID>
<trackIDList>
<trackID>${channelId}</trackID>
</trackIDList>
<timeSpanList>
<timeSpan>
<startTime>${toSearchIso(startTime)}</startTime>
<endTime>${toSearchIso(endTime)}</endTime>
</timeSpan>
</timeSpanList>
<maxResults>16</maxResults>
<searchResultPostion>0</searchResultPostion>
<metadataList>
<metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor>
</metadataList>
</CMSearchDescription>`;
}

export function countMatches(xml) {
  const m = xml.match(/<numOfMatches>(\d+)<\/numOfMatches>/);
  return m ? Number(m[1]) : 0;
}

function downloadRequestBody(playbackURI) {
  const escaped = playbackURI.replace(/&/g, '&amp;');
  return `<?xml version="1.0" encoding="utf-8"?>
<downloadRequest>
<playbackURI>${escaped}</playbackURI>
</downloadRequest>`;
}

export async function searchChannel({ baseUrl, user, pass, channelId, startTime, endTime }) {
  const res = await digestFetch(baseUrl, '/ISAPI/ContentMgmt/search', {
    method: 'POST',
    username: user,
    password: pass,
    headers: { 'Content-Type': 'application/xml' },
    body: searchBody(channelId, startTime, endTime),
  });
  const text = await res.text();
  return { channelId, status: res.status, text };
}

export async function downloadClip({ baseUrl, rtspHost, user, pass, channelId, startTime, endTime, outPath }) {
  const playbackURI = `rtsp://${rtspHost}/Streaming/tracks/${channelId}/?starttime=${toRtspTime(startTime, { withZ: false })}&endtime=${toRtspTime(endTime, { withZ: true })}`;
  const res = await digestFetch(baseUrl, '/ISAPI/ContentMgmt/download', {
    method: 'POST',
    username: user,
    password: pass,
    headers: { 'Content-Type': 'application/xml' },
    body: downloadRequestBody(playbackURI),
  });
  if (res.status !== 200) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buffer);
  return buffer.length;
}
