import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

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
const VISTARA_API_BASE = (process.env.VISTARA_API_BASE ?? '').replace(/\/+$/, '')
const TENANT_SLUG = process.env.VISTARA_TENANT_SLUG ?? ''
const DEVICE_KEY = process.env.VISTARA_DEVICE_KEY ?? ''
// Este poll ya NO es el camino normal -- es la red de seguridad para cuando el
// push (abajo) no llega (túnel caído). Por eso el default subió de 2s a 20s: casi
// nunca debería encontrar nada, así que espaciarlo no cuesta latencia real y sí
// ahorra la mayoría de las consultas que antes mantenían despiertos a Neon/Cloud Run.
const POLL_MS = Math.max(1, Number(process.env.POLL_SECONDS ?? 20)) * 1000
const HTTP_TIMEOUT_MS = 10_000

// --- Servidor de push (camino rápido) ------------------------------------------
// Vistara le pega directo a esto, vía un túnel Cloudflare (cloudflared) que corre
// aparte en esta misma PC -- este proceso solo escucha en loopback, nunca en la
// interfaz de red de la LAN. cloudflared es quien decide qué tráfico de internet
// llega aquí (con Cloudflare Access de por medio); este servidor solo valida el
// token compartido, sin abrir ningún puerto hacia la LAN ni hacia internet por su
// cuenta. PUSH_TOKEN vacío = servidor de push desactivado (queda solo el poll,
// comportamiento anterior a este cambio).
const PUSH_PORT = Number(process.env.PUSH_PORT ?? 8787)
const PUSH_TOKEN = process.env.PUSH_TOKEN ?? ''

const TOTEM_GPIO_URL = process.env.TOTEM_GPIO_URL ?? ''
const TOTEM_GPIO_TOKEN = process.env.TOTEM_GPIO_TOKEN ?? ''
const TOTEM_TIMEOUT_MS = Number(process.env.TOTEM_TIMEOUT_MS ?? 5000)
// Anti-rebote: dos aperturas legítimas seguidas no tienen sentido y una ráfaga sí
// es sospechosa. La pluma tarda varios segundos en su ciclo.
const MIN_INTERVAL_MS = Number(process.env.BARRIER_MIN_INTERVAL_MS ?? 4000)
const MAX_BACKOFF_MS = 60_000

for (const [name, val] of Object.entries({
  VISTARA_API_BASE,
  VISTARA_TENANT_SLUG: TENANT_SLUG,
  VISTARA_DEVICE_KEY: DEVICE_KEY,
  TOTEM_GPIO_URL,
})) {
  if (!val) {
    console.error(`barrier-gateway: falta ${name} -- no arranco sin eso`)
    process.exit(1)
  }
}

let lastOpenOkAt = 0
let backoffMs = 0

// --- Helpers -----------------------------------------------------------------
function log(outcome: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), outcome, ...extra }))
}

const vistaraHeaders: Record<string, string> = {
  'X-Tenant-Slug': TENANT_SLUG,
  'X-Device-Key': DEVICE_KEY,
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

interface BarrierCommand {
  id: string
  reason: string | null
}

async function pollCommands(): Promise<BarrierCommand[]> {
  const r = await fetch(`${VISTARA_API_BASE}/barrier/poll`, {
    headers: vistaraHeaders,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  if (!r.ok) throw new Error(`poll HTTP ${r.status}`)
  const body = (await r.json()) as { commands?: BarrierCommand[] }
  return Array.isArray(body.commands) ? body.commands : []
}

// Ack best-effort: le dice a Vistara si la pluma abrió, para el feedback de la web.
// Que falle el ack no cambia nada del lado físico -- solo se registra.
async function ack(id: string, opened: boolean): Promise<void> {
  try {
    await fetch(`${VISTARA_API_BASE}/barrier/commands/${id}/ack`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...vistaraHeaders },
      body: JSON.stringify({ opened }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (e) {
    log('ack_error', { id, error: e instanceof Error ? e.message : String(e) })
  }
}

async function handleCommand(cmd: BarrierCommand): Promise<void> {
  const now = Date.now()
  if (now - lastOpenOkAt < MIN_INTERVAL_MS) {
    log('rechazado_rebote', { id: cmd.id, reason: cmd.reason })
    await ack(cmd.id, false)
    return
  }
  const result = await pulseTotem()
  if (!result.ok) {
    log('totem_error', { id: cmd.id, reason: cmd.reason, error: result.error })
    await ack(cmd.id, false)
    return
  }
  lastOpenOkAt = now
  log('abierto', { id: cmd.id, reason: cmd.reason })
  await ack(cmd.id, true)
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

// Mismo anti-rebote y mismo pulso que el camino de poll (`handleCommand`) --
// comparten `lastOpenOkAt` a propósito: si el push ya abrió, un poll que
// alcance a ver el mismo comando todavía PENDING (ventana angosta mientras
// Vistara espera la respuesta del push) se rechaza como rebote en vez de
// pulsar el tótem una segunda vez.
async function handlePushRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST' || req.url !== '/push') {
    res.writeHead(404).end()
    return
  }
  if (!PUSH_TOKEN || req.headers['x-push-token'] !== PUSH_TOKEN) {
    res.writeHead(401).end()
    return
  }

  let payload: { id?: unknown; reason?: unknown }
  try {
    const raw = await readBody(req)
    payload = JSON.parse(raw || '{}') as typeof payload
  } catch {
    sendJson(res, 400, { error: 'bad_json' })
    return
  }
  const id = typeof payload.id === 'string' ? payload.id : null
  const reason = typeof payload.reason === 'string' ? payload.reason : null
  if (!id) {
    sendJson(res, 400, { error: 'missing_id' })
    return
  }

  const now = Date.now()
  if (now - lastOpenOkAt < MIN_INTERVAL_MS) {
    log('push_rechazado_rebote', { id, reason })
    sendJson(res, 200, { opened: false })
    return
  }

  const result = await pulseTotem()
  if (!result.ok) {
    log('push_totem_error', { id, reason, error: result.error })
    sendJson(res, 200, { opened: false })
    return
  }

  lastOpenOkAt = now
  log('push_abierto', { id, reason })
  sendJson(res, 200, { opened: true })
}

function startPushServer(): void {
  if (!PUSH_TOKEN) {
    log('push_desactivado', { reason: 'PUSH_TOKEN no configurado -- solo poll de respaldo' })
    return
  }
  const server = createServer((req, res) => {
    handlePushRequest(req, res).catch((e) => {
      log('push_error', { error: e instanceof Error ? e.message : String(e) })
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  server.on('error', (e) => {
    log('push_server_error', { error: e instanceof Error ? e.message : String(e) })
  })
  // Solo loopback -- cloudflared corre aparte en esta misma PC y es quien decide
  // qué llega aquí desde el túnel; este puerto nunca se anuncia en la LAN.
  server.listen(PUSH_PORT, '127.0.0.1', () => {
    log('push_listening', { port: PUSH_PORT })
  })
}

async function tick(): Promise<void> {
  try {
    const commands = await pollCommands()
    backoffMs = 0
    for (const cmd of commands) await handleCommand(cmd)
  } catch (e) {
    backoffMs = Math.min(backoffMs === 0 ? POLL_MS * 2 : backoffMs * 2, MAX_BACKOFF_MS)
    log('poll_error', { error: e instanceof Error ? e.message : String(e), retryInMs: backoffMs })
  }
}

async function main(): Promise<void> {
  startPushServer()
  console.log(
    `barrier-gateway -> push (:${PUSH_PORT}) + poll de respaldo cada ${POLL_MS}ms -> ${VISTARA_API_BASE} -> ${TOTEM_GPIO_URL}`,
  )
  for (;;) {
    await tick()
    await new Promise((r) => setTimeout(r, backoffMs || POLL_MS))
  }
}

void main()
