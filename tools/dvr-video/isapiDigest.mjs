// HTTP Digest Auth (RFC 7616, MD5, qop=auth) sobre el `fetch` nativo de Node.
// ISAPI de Hikvision solo acepta Digest, no Basic (ver docs/hikvision/isapi.txt) --
// Node no trae esto integrado, así que se implementa a mano: primer request sin
// credenciales para que el equipo regrese el challenge (401 + WWW-Authenticate),
// luego se rearma la request con el header Authorization calculado.
//
// No es específico de este proyecto -- es el algoritmo estándar. Reescrito para
// debt-monitor (2026-08-22) en vez de portar el original porque ese vivía en otro
// repo/máquina; misma lógica, sin dependencias externas.

import crypto from 'node:crypto';

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function parseAuthHeader(header) {
  const out = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m;
  while ((m = re.exec(header))) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

export async function digestFetch(baseUrl, path, { method = 'GET', username, password, headers = {}, body } = {}) {
  const url = `${baseUrl}${path}`;

  // 1) request "en blanco" solo para obtener el challenge del equipo.
  const first = await fetch(url, { method, headers, body });
  if (first.status !== 401) return first; // no pidió auth (raro, pero no truena)

  const challenge = first.headers.get('www-authenticate');
  if (!challenge || !/digest/i.test(challenge)) {
    throw new Error(`Se esperaba Digest challenge, llegó: ${challenge}`);
  }
  const { realm, nonce, qop, opaque } = parseAuthHeader(challenge);

  const ncStr = '00000001'; // siempre 1: pedimos nonce nuevo en cada llamada, no lo reusamos.
  const cnonce = crypto.randomBytes(8).toString('hex');

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${path}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const authParts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${path}"`,
    qop ? `qop=${qop}` : null,
    qop ? `nc=${ncStr}` : null,
    qop ? `cnonce="${cnonce}"` : null,
    `response="${response}"`,
    opaque ? `opaque="${opaque}"` : null,
  ].filter(Boolean);

  return fetch(url, {
    method,
    headers: { ...headers, Authorization: `Digest ${authParts.join(', ')}` },
    body,
  });
}
