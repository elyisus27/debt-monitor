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

// apps/api en esta misma PC (LAN-local, nunca sale de 127.0.0.1) -- usado por
// las rutas de fotos de abajo (/capture-photos, /photo/:kind/:file). Este
// proceso sigue sin tocar el DVR ni la base de datos directamente, solo relaya.
const API_BASE_URL = (process.env.API_BASE_URL ?? 'http://127.0.0.1:9100').replace(/\/+$/, '')
const RELAY_TIMEOUT_MS = 10_000
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
  // Apertura programada (castigo del carril de morosos): no abrir antes de esta hora.
  // null/ausente = abrir ya. Vistara (Cloud Run) no puede esperar después de responder,
  // así que la espera la hace este worker en la LAN.
  notBefore?: string | null
}

// Tope de espera para una apertura programada: si Vistara manda una hora absurda
// (reloj desfasado, bug), no dejar un timer colgado por minutos.
const MAX_SCHEDULE_MS = 120_000
const scheduled = new Set<string>()

// Ms que faltan para notBefore (0 si ya pasó o no hay). null si excede el tope.
function msUntil(notBefore: string | null | undefined): number | null {
  if (!notBefore) return 0
  const t = Date.parse(notBefore)
  if (Number.isNaN(t)) return 0
  const ms = t - Date.now()
  if (ms <= 0) return 0
  return ms > MAX_SCHEDULE_MS ? null : ms
}

// Programa handleCommand para notBefore. Idempotente por id (push y poll pueden ver
// el mismo comando).
function schedule(cmd: BarrierCommand, ms: number): void {
  if (scheduled.has(cmd.id)) return
  scheduled.add(cmd.id)
  log('programado', { id: cmd.id, reason: cmd.reason, enMs: ms })
  setTimeout(() => {
    scheduled.delete(cmd.id)
    handleCommand({ ...cmd, notBefore: null }).catch((e) =>
      log('programado_error', { id: cmd.id, error: e instanceof Error ? e.message : String(e) }),
    )
  }, ms)
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
  const wait = msUntil(cmd.notBefore)
  if (wait === null) {
    log('rechazado_hora_invalida', { id: cmd.id, notBefore: cmd.notBefore })
    await ack(cmd.id, false)
    return
  }
  if (wait > 0) {
    schedule(cmd, wait)
    return
  }
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

function checkPushToken(req: IncomingMessage): boolean {
  return Boolean(PUSH_TOKEN) && req.headers['x-push-token'] === PUSH_TOKEN
}

// Mismo anti-rebote y mismo pulso que el camino de poll (`handleCommand`) --
// comparten `lastOpenOkAt` a propósito: si el push ya abrió, un poll que
// alcance a ver el mismo comando todavía PENDING (ventana angosta mientras
// Vistara espera la respuesta del push) se rechaza como rebote en vez de
// pulsar el tótem una segunda vez.
async function handlePushRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkPushToken(req)) {
    log('push_401', {
      motivo: !PUSH_TOKEN ? 'sin_push_token_local' : 'token_no_coincide',
      recibido: typeof req.headers['x-push-token'] === 'string' ? '(presente)' : '(ausente)',
    })
    res.writeHead(401).end()
    return
  }

  let payload: { id?: unknown; reason?: unknown; notBefore?: unknown }
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

  // Apertura programada: se contesta ya ({scheduled:true}) y se abre a la hora; el
  // resultado real le llega a Vistara por el ack de handleCommand.
  const notBefore = typeof payload.notBefore === 'string' ? payload.notBefore : null
  const wait = msUntil(notBefore)
  if (wait === null) {
    log('push_rechazado_hora_invalida', { id, notBefore })
    sendJson(res, 200, { opened: false })
    return
  }
  if (wait > 0) {
    schedule({ id, reason, notBefore }, wait)
    sendJson(res, 200, { opened: false, scheduled: true })
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

// --- Fotos de visitas (2026-09-17) ---------------------------------------------
// Se agregaron aquí, no como proceso/túnel/token aparte: el usuario prefiere
// crecer este único gateway ya expuesto y ya protegido (mismo PUSH_TOKEN,
// mismo hostname `barrier-push`) en vez de multiplicar procesos/tokens/hostnames
// por cada capacidad nueva que necesite salir de la LAN -- re-evaluar el nombre
// de este archivo/proceso más adelante, cuando el alcance real ya esté claro
// (hoy ya no es solo "la pluma"). Este archivo nunca toca el DVR ni la DB
// directamente -- solo relaya en LAN hacia apps/api, igual que ya hacía con el
// tótem GPIO. Contrato completo: vistara/CLAUDE.md § "FOTOS DE VISITAS".
async function handleCapturePhotos(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!checkPushToken(req)) {
    log('capture_401', { recibido: req.headers['x-push-token'] ? '(presente)' : '(ausente)' })
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
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
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
// guardia, ver PhotoServeController del lado de apps/api).
async function handlePhoto(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  if (!checkPushToken(req)) {
    log('photo_401', { path })
    res.writeHead(401).end()
    return
  }

  let upstream: Response
  try {
    upstream = await fetch(`${API_BASE_URL}/api/vistara-photos${path.slice('/photo'.length)}`, {
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
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
  res.end(Buffer.from(await upstream.arrayBuffer()))
}

function startPushServer(): void {
  if (!PUSH_TOKEN) {
    log('push_desactivado', { reason: 'PUSH_TOKEN no configurado -- solo poll de respaldo' })
    return
  }
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    const dispatch =
      req.method === 'POST' && path === '/push' ? handlePushRequest(req, res) :
      req.method === 'POST' && path === '/capture-photos' ? handleCapturePhotos(req, res) :
      req.method === 'GET' && path.startsWith('/photo/') ? handlePhoto(req, res, path) :
      null

    if (!dispatch) {
      log('push_404', { method: req.method, url: req.url })
      res.writeHead(404).end()
      return
    }
    dispatch.catch((e) => {
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
