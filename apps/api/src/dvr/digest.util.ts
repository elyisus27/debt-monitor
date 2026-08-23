// HTTP Digest Auth (RFC 7616, MD5, qop=auth) — port a TypeScript de
// tools/dvr-video/isapiDigest.mjs, mismo algoritmo, sin dependencias.
import { createHash, randomBytes } from 'node:crypto';

function md5(str: string): string {
  return createHash('md5').update(str).digest('hex');
}

function parseAuthHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header))) {
    out[m[1]] = m[2] !== undefined ? m[2] : m[3];
  }
  return out;
}

export interface DigestFetchOptions {
  method?: string;
  username: string;
  password: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

export async function digestFetch(
  baseUrl: string,
  path: string,
  opts: DigestFetchOptions,
): Promise<Response> {
  const { method = 'GET', username, password, headers = {}, body } = opts;
  const url = `${baseUrl}${path}`;

  const first = await fetch(url, { method, headers, body });
  if (first.status !== 401) return first;

  const challenge = first.headers.get('www-authenticate');
  if (!challenge || !/digest/i.test(challenge)) {
    throw new Error(`Se esperaba Digest challenge, llegó: ${challenge}`);
  }
  const { realm, nonce, qop, opaque } = parseAuthHeader(challenge);

  const ncStr = '00000001';
  const cnonce = randomBytes(8).toString('hex');

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
