import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// --- .env mínimo (sin dependencias) --------------------------------------------
// Mismo patrón que lpr-caseta/src/totem_gpio.py: no pisa variables ya presentes
// en el entorno (NSSM las puede inyectar directo).
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
const PORT = Number(process.env.PORT ?? 9400)
const BIND_HOST = process.env.BIND_HOST ?? '127.0.0.1'
const SHARED_SECRET = process.env.BARRIER_SHARED_SECRET ?? ''
const TOTEM_GPIO_URL = process.env.TOTEM_GPIO_URL ?? ''
const TOTEM_GPIO_TOKEN = process.env.TOTEM_GPIO_TOKEN ?? ''
const TOTEM_TIMEOUT_MS = Number(process.env.TOTEM_TIMEOUT_MS ?? 5000)
// Anti-rebote: dos aperturas legítimas seguidas no tienen sentido y una
// ráfaga sí es sospechosa. La pluma tarda varios segundos en su ciclo.
const MIN_INTERVAL_MS = Number(process.env.BARRIER_MIN_INTERVAL_MS ?? 4000)

if (!SHARED_SECRET) {
  console.error('barrier-gateway: falta BARRIER_SHARED_SECRET -- no arranco sin secreto')
  process.exit(1)
}
if (!TOTEM_GPIO_URL) {
  console.error('barrier-gateway: falta TOTEM_GPIO_URL -- no sé a dónde mandar el pulso')
  process.exit(1)
}

const SECRET_BUF = Buffer.from(SHARED_SECRET)
let lastOpenOkAt = 0

// --- Helpers -----------------------------------------------------------------
function log(outcome: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), outcome, ...extra }))
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) })
  res.end(payload)
}

function secretOk(header: string | undefined): boolean {
  if (!header) return false
  const given = Buffer.from(header)
  if (given.length !== SECRET_BUF.length) return false
  return timingSafeEqual(given, SECRET_BUF)
}

async function readBody(req: IncomingMessage, limitBytes = 4096): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limitBytes) throw new Error('body demasiado grande')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function pulseTotem(): Promise<{ ok: true } | { ok: false; error: string }> {
  const headers: Record<string, string> = {}
  if (TOTEM_GPIO_TOKEN) headers['X-Gpio-Token'] = TOTEM_GPIO_TOKEN
  try {
    const r = await fetch(TOTEM_GPIO_URL, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(TOTEM_TIMEOUT_MS),
    })
    if (!r.ok) return { ok: false, error: `tótem respondió HTTP ${r.status}` }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// --- Servidor ---------------------------------------------------------------
const server = createServer(async (req, res) => {
  const { method, url } = req
  const ip = req.socket.remoteAddress ?? '?'

  if (method === 'GET' && url === '/healthz') {
    return json(res, 200, { ok: true, service: 'barrier-gateway' })
  }

  if (method !== 'POST' || url !== '/abrir') {
    return json(res, 404, { error: 'not found' })
  }

  if (!secretOk(req.headers['x-barrier-secret'] as string | undefined)) {
    log('rechazado_secreto', { ip })
    return json(res, 401, { error: 'unauthorized' })
  }

  let reason: string | undefined
  let actorUserId: string | undefined
  try {
    const body = await readBody(req)
    if (body.trim()) {
      const parsed = JSON.parse(body) as { reason?: unknown; actorUserId?: unknown }
      if (typeof parsed.reason === 'string') reason = parsed.reason
      if (typeof parsed.actorUserId === 'string') actorUserId = parsed.actorUserId
    }
  } catch {
    return json(res, 400, { error: 'body inválido' })
  }

  const now = Date.now()
  if (now - lastOpenOkAt < MIN_INTERVAL_MS) {
    log('rechazado_rebote', { ip, actorUserId, reason })
    return json(res, 429, { opened: false, error: 'apertura reciente, espera unos segundos' })
  }

  const result = await pulseTotem()
  if (!result.ok) {
    log('totem_error', { ip, actorUserId, reason, error: result.error })
    return json(res, 502, { opened: false, error: result.error })
  }

  lastOpenOkAt = now
  log('abierto', { ip, actorUserId, reason })
  return json(res, 200, { opened: true })
})

server.listen(PORT, BIND_HOST, () => {
  console.log(`barrier-gateway escuchando en http://${BIND_HOST}:${PORT} -> ${TOTEM_GPIO_URL}`)
})
