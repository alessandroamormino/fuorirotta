// Contratto del client APNs (check:apns, test:ci). Nessun database: gira anche su GitHub (Linux, Node 20).
//
// Si parla con un VERO server HTTP/2 locale (scripts/apns-stub.ts), non con un finto di node:http2. Casi:
//   A1  un avviso arriva allo stub, firmato con un JWT che lo stub verifica con la meta' pubblica -> 'sent' (tracer)
//   A2  header e corpo esatti, apns-id UUID minuscolo, corpo <= 4096 byte, 413 in locale senza richiesta
//   A3  classify() riga per riga
//   A4  DeviceTokenNotForTopic e' morto solo se nello stesso lotto c'e' un 200
//   A5  un esito 'config' ferma il lotto: gli altri 'skipped', mai inviati
//   A6  tre invii = un JWT; a +41 minuti ne nasce uno nuovo con iat piu' alto
//   A7  sandbox e produzione vanno ai loro origin; un ambiente sconosciuto e' 'rejected' senza richiesta
//   A8  BadDeviceToken (con sessione buttata giu') seguito da un dispositivo sano: il sano riceve il suo 200
//   A9  GOAWAY, nessuna risposta (timeout), connessione rifiutata -> 'retry', mai 'dead', il lotto continua
//   A10 apnsMissingConfig() dice solo NOMI; chiave corrotta, RSA, P-384 rifiutate; sendBatch senza config non fa richieste
//   A11 ne' token di dispositivo, ne' JWT, ne' chiave in report, stdout o stderr
//   A12 l'ambiente letto da lib/push/apns.ts e' esattamente di quattro variabili
//
// Esce con 1 al primo controllo fallito. Stampa "ok  A<n>: ..." per ognuno.
import { randomBytes } from 'node:crypto'
import { exportPKCS8, generateKeyPair, jwtVerify, type CryptoKey } from 'jose'
import { startApnsStub, type CapturedRequest, type StubAnswer } from './apns-stub'

const TEAM = 'TEAMID1234'
const KID = 'KEYID12345'
const TOPIC = 'it.fuorirotta.app.test'

// Cattura di stdout/stderr per A11 (si inoltra comunque a chi legge il terminale).
const captured: string[] = []
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    captured.push(String(chunk))
    return original(chunk, ...rest)
  }) as typeof stream.write
}

function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) {
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`)
    process.exit(1)
  }
  console.log(`ok  ${name}`)
}

const pkcs8B64 = async (key: CryptoKey) => Buffer.from(await exportPKCS8(key)).toString('base64')
const newToken = () => randomBytes(32).toString('hex')

async function main(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const keyB64 = await pkcs8B64(privateKey)
  Object.assign(process.env, { APNS_KEY_ID: KID, APPLE_TEAM_ID: TEAM, APPLE_APP_BUNDLE_ID: TOPIC, APNS_PRIVATE_KEY_B64: keyB64 })
  type Apns = typeof import('../lib/push/apns')
  // Node 20 su Linux: un modulo compilato da tsx puo' arrivare come { default: modulo }
  const loaded = (await import('../lib/push/apns')) as Apns & { default?: Apns }
  const { sendBatch } = loaded.default ?? loaded
  const message = { title: 'Prova', body: 'Una sagra vicino a te' }

  // Uno stub che risponde per token da una mappa; i token non in mappa ricevono 200.
  async function stub(script: Record<string, StubAnswer> = {}) {
    return startApnsStub((t) => script[t] ?? { status: 200 })
  }
  const seenJwts: string[] = []
  const bearer = (r: CapturedRequest) => String(r.headers.authorization ?? '').replace(/^bearer /, '')

  // A1 (tracer)
  {
    const s = await stub()
    const t = newToken()
    const nowBefore = Math.floor(Date.now() / 1000)
    const r = await sendBatch([{ id: 1, deviceToken: t, environment: 'sandbox' }], message, { origins: { sandbox: s.origin, production: s.origin } })
    const req = s.requests[0]
    const jwt = bearer(req)
    seenJwts.push(jwt)
    const verified = await jwtVerify(jwt, publicKey, { algorithms: ['ES256'] }).catch(() => null)
    await s.close()
    check(
      'A1: un avviso arriva allo stub, il JWT si verifica con la meta\' pubblica, torna "sent"',
      r.byDevice[0].outcome === 'sent' &&
        r.byDevice[0].status === 200 &&
        r.deadIds.length === 0 &&
        req.method === 'POST' &&
        req.path === `/3/device/${t}` &&
        verified !== null &&
        JSON.stringify(Object.keys(verified.protectedHeader).sort()) === '["alg","kid"]' &&
        verified.protectedHeader.kid === KID &&
        JSON.stringify(Object.keys(verified.payload).sort()) === '["iat","iss"]' &&
        verified.payload.iss === TEAM &&
        Math.abs((verified.payload.iat ?? 0) - nowBefore) <= 5,
    )
  }
}

main().catch((e) => {
  console.error(`FAIL: errore non gestito (${e instanceof Error ? e.message : String(e)})`)
  process.exit(1)
})
