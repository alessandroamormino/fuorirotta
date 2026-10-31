import http2, { type ClientHttp2Session } from 'node:http2'
import { createPrivateKey, randomUUID } from 'node:crypto'
import { SignJWT, importPKCS8 } from 'jose'
import { APNS_ENVIRONMENTS, type ApnsEnvironment } from '../api-contract'

// Notifiche push (Fase 26, API-03). Client APNs DIRETTO, senza pacchetti nuovi (D-14): node:http2 per il
// trasporto e jose (gia' dipendenza diretta) per il token di provider. Helper SOLO server, senza Prisma e
// senza Next: cosi' check:apns gira nel test:ci di GitHub, senza database. Il database lo tocca
// lib/push/send.ts (piano 06), che usa sendBatch() e cancella i dispositivi morti.
//
// Regole:
// - Autenticazione a token (D-17): un JWT ES256 firmato con la chiave .p8. Apple vuole che lo si rinnovi non
//   piu' di una volta ogni 20 minuti e non meno di una ogni 60 (429 TooManyProviderTokenUpdates /
//   403 ExpiredProviderToken): lo si firma al massimo ogni 40 minuti, a meta' della fascia, cosi' ne' lo
//   scarto d'orologio ne' una richiesta lenta lo portano a uno dei due bordi.
// - Gli origin di Apple sono un ARGOMENTO di funzione e basta (serve al gate per puntare a un server
//   locale): nessuna variabile d'ambiente puo' deviare le notifiche altrove. L'ambiente legge SOLO
//   APNS_KEY_ID, APNS_PRIVATE_KEY_B64, APPLE_TEAM_ID e APPLE_APP_BUNDLE_ID (il topic). Nessun ripiego sulla
//   chiave di Accedi con Apple (APPLE_KEY_ID): chiavi separate, revoca separata.
// - Qui si parla di NOMI di variabili, mai di valori: ne' errori, ne' report, ne' log contengono la chiave,
//   il JWT o un token di dispositivo (A10, A11).
// - Un dispositivo si dichiara morto SOLO per risposte esplicite di Apple (classify). Chiave sbagliata,
//   bundle id sbagliato, throttling o un'interruzione di Apple non devono mai svuotare push_devices.

export const APNS_ORIGIN: Record<ApnsEnvironment, string> = {
  sandbox: 'https://api.sandbox.push.apple.com',
  production: 'https://api.push.apple.com',
}

const JWT_MAX_AGE_S = 40 * 60
const REQUEST_TIMEOUT_MS = 10_000
const MAX_PAYLOAD_BYTES = 4096

type Env = NodeJS.ProcessEnv

function decodeKey(env: Env): string {
  return Buffer.from(env.APNS_PRIVATE_KEY_B64 ?? '', 'base64').toString('utf8')
}

/** Nomi (mai valori) delle variabili assenti o non valide; [] = push configurato (assenti = push spento, D-17). */
export async function apnsMissingConfig(env: Env = process.env): Promise<string[]> {
  const missing: string[] = []
  if (!env.APNS_KEY_ID) missing.push('APNS_KEY_ID')
  if (!env.APNS_PRIVATE_KEY_B64) missing.push('APNS_PRIVATE_KEY_B64')
  if (!env.APPLE_TEAM_ID) missing.push('APPLE_TEAM_ID')
  if (!env.APPLE_APP_BUNDLE_ID) missing.push('APPLE_APP_BUNDLE_ID')
  if (env.APNS_PRIVATE_KEY_B64) {
    try {
      const pem = decodeKey(env)
      await importPKCS8(pem, 'ES256')
      // APNs accetta solo ES256, cioe' P-256: una chiave P-384 o RSA va rifiutata ora, non da Apple dopo.
      if (createPrivateKey(pem).asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('curva')
    } catch {
      missing.push('APNS_PRIVATE_KEY_B64')
    }
  }
  return missing
}

let cached: { fingerprint: string; jwt: string; iat: number } | null = null

/** JWT ES256 per APNs, in cache per (chiave, team) e ri-firmato quando ha 40 minuti. */
export async function providerToken(env: Env = process.env, now: number = Math.floor(Date.now() / 1000)): Promise<string> {
  const fingerprint = `${env.APNS_KEY_ID}|${env.APPLE_TEAM_ID}|${env.APNS_PRIVATE_KEY_B64}`
  if (cached && cached.fingerprint === fingerprint && now - cached.iat < JWT_MAX_AGE_S) return cached.jwt
  // ponytail: una sola coppia di chiavi per sandbox e produzione; se il portale impone chiavi per ambiente,
  // qui basta un override APNS_KEY_ID_SANDBOX / APNS_PRIVATE_KEY_B64_SANDBOX (piano 26-08).
  const key = await importPKCS8(decodeKey(env), 'ES256')
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APNS_KEY_ID ?? '' })
    .setIssuer(env.APPLE_TEAM_ID ?? '')
    .setIssuedAt(now)
    .sign(key)
  cached = { fingerprint, jwt, iat: now }
  return jwt
}

export type ApnsOutcome = 'sent' | 'dead' | 'not-for-topic' | 'config' | 'retry' | 'rejected' | 'skipped'

/**
 * La risposta di Apple in un esito. Solo l'elenco esplicito cancella: tutto cio' che non conosciamo e'
 * 'rejected' (fail safe). Nessuna risposta (GOAWAY, socket, timeout, rifiuto) e' 'retry', mai 'dead'.
 */
export function classify(status: number | undefined, reason: string | undefined): Exclude<ApnsOutcome, 'skipped'> {
  if (status === undefined) return 'retry'
  if (status === 200) return 'sent'
  if (status === 410) return 'dead'
  if (status === 400) {
    if (reason === 'BadDeviceToken') return 'dead'
    if (reason === 'DeviceTokenNotForTopic') return 'not-for-topic'
    if (reason === 'BadTopic' || reason === 'TopicDisallowed' || reason === 'MissingTopic') return 'config'
    if (reason === 'IdleTimeout') return 'retry'
    return 'rejected'
  }
  if (status === 403) return 'config'
  if (status === 429 || status === 500 || status === 503) return 'retry'
  return 'rejected'
}

export type PushTarget = { id: number; deviceToken: string; environment: string }
export type PushMessage = { title: string; body: string }
export type DeviceReport = { id: number; outcome: ApnsOutcome; status?: number; reason?: string; apnsId: string; timestamp?: number }

type Answer = { apnsId: string; status?: number; reason?: string; timestamp?: number }

function sendOne(
  session: ClientHttp2Session,
  deviceToken: string,
  jwt: string,
  topic: string,
  message: PushMessage,
  timeoutMs: number,
): Promise<Answer> {
  const apnsId = randomUUID()
  const body = JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: 'default' } })
  if (Buffer.byteLength(body) > MAX_PAYLOAD_BYTES) return Promise.resolve({ apnsId, status: 413, reason: 'PayloadTooLarge' })
  return new Promise<Answer>((resolve) => {
    let done = false
    const finish = (a: Answer) => {
      if (done) return
      done = true
      resolve(a)
    }
    let req: http2.ClientHttp2Stream
    try {
      req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        authorization: `bearer ${jwt}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': '0',
        'apns-id': apnsId,
      })
    } catch {
      // sessione gia' chiusa o distrutta: nessuna risposta
      finish({ apnsId })
      return
    }
    let status: number | undefined
    let text = ''
    req.setTimeout(timeoutMs, () => {
      req.close(http2.constants.NGHTTP2_CANCEL)
      finish({ apnsId })
    })
    req.on('response', (headers) => {
      status = Number(headers[':status'])
    })
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      text += chunk
    })
    req.on('error', () => finish({ apnsId }))
    req.on('close', () => {
      // APNs non manda content-type: il corpo si legge come JSON se c'e'
      let json: { reason?: string; timestamp?: number } = {}
      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        json = {}
      }
      finish(status === undefined ? { apnsId } : { apnsId, status, reason: json.reason, timestamp: json.timestamp })
    })
    req.end(body)
  })
}

/**
 * Invia lo stesso avviso a una lista di dispositivi, uno alla volta, e dice per ciascuno com'e' andata.
 * Lancia (senza richieste) se la configurazione e' incompleta. Un esito 'config' ferma il lotto: gli altri
 * restano 'skipped' e non vengono inviati. deadIds = i 'dead' piu' i 'not-for-topic' solo se nello stesso
 * lotto almeno un dispositivo ha ricevuto 200 (un APPLE_APP_BUNDLE_ID sbagliato non svuota la tabella).
 */
export async function sendBatch(
  targets: PushTarget[],
  message: PushMessage,
  opts: { env?: Env; origins?: Record<ApnsEnvironment, string>; now?: number; timeoutMs?: number } = {},
): Promise<{ byDevice: DeviceReport[]; deadIds: number[]; stopped: boolean }> {
  const env = opts.env ?? process.env
  const missing = await apnsMissingConfig(env)
  if (missing.length > 0) throw new Error(`configurazione APNs incompleta: ${missing.join(', ')}`)

  const origins = opts.origins ?? APNS_ORIGIN
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS
  const jwt = await providerToken(env, opts.now)
  const topic = env.APPLE_APP_BUNDLE_ID ?? ''

  const sessions = new Map<ApnsEnvironment, { session: ClientHttp2Session; goaway: boolean }>()
  const sessionFor = (environment: ApnsEnvironment): ClientHttp2Session => {
    const held = sessions.get(environment)
    if (held && !held.goaway && !held.session.closed && !held.session.destroyed) return held.session
    const session = http2.connect(origins[environment])
    const entry = { session, goaway: false }
    // senza listener un errore di socket e' un'eccezione non gestita: arriva alla richiesta come "nessuna risposta"
    session.on('error', () => {})
    session.on('goaway', () => {
      entry.goaway = true
    })
    sessions.set(environment, entry)
    return session
  }

  // ponytail: un flusso alla volta per ambiente; la fase 28 puo' aggiungere un piccolo limite di concorrenza
  // (Apple dice di non assumere un numero di stream).
  const byDevice: DeviceReport[] = []
  let stopped = false
  try {
    for (const target of targets) {
      if (stopped) {
        byDevice.push({ id: target.id, outcome: 'skipped', apnsId: '' })
        continue
      }
      const environment = (APNS_ENVIRONMENTS as readonly string[]).includes(target.environment)
        ? (target.environment as ApnsEnvironment)
        : null
      if (!environment) {
        byDevice.push({ id: target.id, outcome: 'rejected', apnsId: '' })
        continue
      }
      const answer = await sendOne(sessionFor(environment), target.deviceToken, jwt, topic, message, timeoutMs)
      const outcome = classify(answer.status, answer.reason)
      if (outcome === 'config') stopped = true
      byDevice.push({
        id: target.id,
        outcome,
        status: answer.status,
        reason: answer.reason,
        apnsId: answer.apnsId,
        timestamp: answer.timestamp,
      })
    }
  } finally {
    for (const { session } of sessions.values()) session.destroy()
  }

  const anySent = byDevice.some((d) => d.outcome === 'sent')
  const deadIds = byDevice
    .filter((d) => d.outcome === 'dead' || (d.outcome === 'not-for-topic' && anySent))
    .map((d) => d.id)
  return { byDevice, deadIds, stopped }
}
