import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

// --- .env mínimo (sin dependencias) --------------------------------------------
// Mismo patrón que apps/barrier-gateway/src/main.ts: no pisa variables ya
// presentes en el entorno (NSSM las puede inyectar directo).
function loadDotenv(): void {
  try {
    const raw = readFileSync(resolve(__dirname, '..', '.env'), 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const i = t.indexOf('=')
      const key = t.slice(0, i).trim()
      const val = t.slice(i + 1).trim().replace(/^["']|["']$/g, '')
      if (key && !(key in process.env)) process.env[key] = val
    }
  } catch {
    // sin .env -- todo viene del entorno
  }
}
loadDotenv()

// --- Config -------------------------------------------------------------------
// Único proceso que recibe tráfico de internet (vía cloudflared) para el tema
// de fotos -- ver README.md. Nunca toca el DVR ni la base de datos por su
// cuenta: cada request válido se relaya a apps/api en localhost, que es quien
// hace el trabajo real (captura, storage, cola de sync a Vistara). Igual que
// barrier-gateway con el tótem: proceso pequeño y auditable, la lógica de
// negocio vive en otro lado.
const API_BASE_URL = (process.env.API_BASE_URL ?? '').replace(/\/+$/, '')
const PUSH_PORT = Number(process.env.PUSH_PORT ?? 8788)
// Un solo token para las dos rutas (capturar + leer foto) -- ver nota en
// vistara/apps/api/.env.example sobre por qué no hace falta separarlos aquí.
// Vacío = servidor completo desactivado (no hay nada útil que hacer sin él).
const PHOTOS_TOKEN = process.env.PHOTOS_TOKEN ?? ''
const HTTP_TIMEOUT_MS = 10_000

for (const [name, val] of Object.entries({ API_BASE_URL })) {
  if (!val) {
    console.error(`photos-gateway: falta ${name} -- no arranco sin eso`)
    process.exit(1)
  }
}

function log(outcome: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), outcome, ...extra }))
}

function checkToken(req: IncomingMessage): boolean {
  return Boolean(PHOTOS_TOKEN) && req.headers['x-photo-token'] === PHOTOS_TOKEN
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 10_000) req.destroy() // sin malicia esperada, pero por si acaso
    })
    req.on('end', () => resolvePromise(body))
    req.on('error', rejectPromise)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

// POST /capture -- Vistara pide "toma las 3 fotos de esta visita" tras un
// registro de guardia. Relay simple a apps/api, que responde rápido (202,
// fire-and-forget de su lado) y hace la captura real en segundo plano.
async function handleCapture(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkToken(req)) {
    log('capture_401', { recibido: req.headers['x-photo-token'] ? '(presente)' : '(ausente)' })
    res.writeHead(401).end()
    return
  }

  let raw: string
  try {
    raw = await readBody(req)
  } catch {
    sendJson(res, 400, { error: 'bad_body' })
    return
  }

  let upstream: Response
  try {
    upstream = await fetch(`${API_BASE_URL}/api/guard-photos/capture-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw || '{}',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (e) {
    log('capture_api_error', { error: e instanceof Error ? e.message : String(e) })
    sendJson(res, 502, { error: 'api_unreachable' })
    return
  }

  const bodyText = await upstream.text().catch(() => '')
  log(upstream.ok ? 'capture_relayed' : 'capture_rejected', { httpStatus: upstream.status })
  res.writeHead(upstream.status, { 'content-type': 'application/json' })
  res.end(bodyText)
}

// GET /photo/:kind/:file -- Vistara pide el JPEG ya capturado (teclado o
// guardia). Mismo relay: apps/api valida el nombre de archivo y lo sirve.
async function handlePhoto(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (!checkToken(req)) {
    log('photo_401', { path })
    res.writeHead(401).end()
    return
  }

  let upstream: Response
  try {
    upstream = await fetch(`${API_BASE_URL}/api/vistara-photos${path.slice('/photo'.length)}`, {
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (e) {
    log('photo_api_error', { path, error: e instanceof Error ? e.message : String(e) })
    res.writeHead(502).end()
    return
  }

  if (!upstream.ok || !upstream.body) {
    log('photo_not_found', { path, httpStatus: upstream.status })
    res.writeHead(upstream.status).end()
    return
  }

  log('photo_served', { path })
  res.writeHead(200, { 'content-type': upstream.headers.get('content-type') ?? 'image/jpeg' })
  const buffer = Buffer.from(await upstream.arrayBuffer())
  res.end(buffer)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '').split('?')[0]
  if (req.method === 'POST' && path === '/capture') return handleCapture(req, res)
  if (req.method === 'GET' && path.startsWith('/photo/')) return handlePhoto(req, res, path)
  log('not_found', { method: req.method, path })
  res.writeHead(404).end()
}

function main(): void {
  if (!PHOTOS_TOKEN) {
    log('desactivado', { reason: 'PHOTOS_TOKEN no configurado -- este proceso no hace nada sin él' })
    return
  }
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      log('error', { error: e instanceof Error ? e.message : String(e) })
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  server.on('error', (e) => {
    log('server_error', { error: e instanceof Error ? e.message : String(e) })
  })
  // Solo loopback -- cloudflared corre aparte en esta misma PC y es quien
  // decide qué llega aquí desde el túnel; este puerto nunca se anuncia en la LAN.
  server.listen(PUSH_PORT, '127.0.0.1', () => {
    log('listening', { port: PUSH_PORT, apiBaseUrl: API_BASE_URL })
  })
}

main()
