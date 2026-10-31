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
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { exportPKCS8, generateKeyPair, jwtVerify, decodeJwt, type CryptoKey } from 'jose'
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
const allTokens: string[] = []
const newToken = () => {
  const t = randomBytes(32).toString('hex')
  allTokens.push(t)
  return t
}

async function main(): Promise<void> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  const keyB64 = await pkcs8B64(privateKey)
  Object.assign(process.env, { APNS_KEY_ID: KID, APPLE_TEAM_ID: TEAM, APPLE_APP_BUNDLE_ID: TOPIC, APNS_PRIVATE_KEY_B64: keyB64 })
  type Apns = typeof import('../lib/push/apns')
  // Node 20 su Linux: un modulo compilato da tsx puo' arrivare come { default: modulo }
  const loaded = (await import('../lib/push/apns')) as Apns & { default?: Apns }
  const { sendBatch, classify, apnsMissingConfig } = loaded.default ?? loaded
  const message = { title: 'Prova', body: 'Una sagra vicino a te' }

  // Uno stub che risponde per token da una mappa; i token non in mappa ricevono 200.
  async function stub(script: Record<string, StubAnswer> = {}) {
    return startApnsStub((t) => script[t] ?? { status: 200 })
  }
  const seenJwts: string[] = []
  const bearer = (r: CapturedRequest) => {
    const jwt = String(r.headers.authorization ?? '').replace(/^bearer /, '')
    seenJwts.push(jwt)
    return jwt
  }

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
  const both = (s: { origin: string }) => ({ sandbox: s.origin, production: s.origin })
  function dev(id: number, deviceToken: string, environment = 'sandbox') {
    return { id, deviceToken, environment }
  }

  // A2: header e corpo esatti
  {
    const s = await stub()
    const t = newToken()
    const r = await sendBatch([dev(1, t)], message, { origins: both(s) })
    const req = s.requests[0]
    const body = JSON.parse(req.body)
    const nowS = Date.now() / 1000
    const iat = decodeJwt(bearer(req)).iat ?? 0
    const big = await sendBatch([dev(2, newToken())], { title: 'x', body: 'y'.repeat(5000) }, { origins: both(s) })
    await s.close()
    check(
      "A2: header e corpo esatti, apns-id UUID minuscolo, corpo <= 4096, 5000 byte = 413 'rejected' senza richiesta",
      r.byDevice[0].outcome === 'sent' &&
        req.headers['apns-topic'] === TOPIC &&
        req.headers['apns-push-type'] === 'alert' &&
        req.headers['apns-priority'] === '10' &&
        req.headers['apns-expiration'] === '0' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(req.headers['apns-id'])) &&
        req.headers['apns-id'] === r.byDevice[0].apnsId &&
        String(req.headers.authorization).startsWith('bearer ') &&
        Buffer.byteLength(req.body) <= 4096 &&
        JSON.stringify(body) === JSON.stringify({ aps: { alert: { title: message.title, body: message.body }, sound: 'default' } }) &&
        Math.abs(iat - nowS) <= 5 &&
        big.byDevice[0].outcome === 'rejected' &&
        big.byDevice[0].status === 413 &&
        s.requests.length === 1,
    )
  }

  // A3: classify riga per riga
  {
    const table: [number | undefined, string | undefined, string][] = [
      [200, undefined, 'sent'],
      [410, 'Unregistered', 'dead'],
      [410, 'ExpiredToken', 'dead'],
      [410, undefined, 'dead'],
      [400, 'BadDeviceToken', 'dead'],
      [400, 'DeviceTokenNotForTopic', 'not-for-topic'],
      [400, 'BadTopic', 'config'],
      [400, 'TopicDisallowed', 'config'],
      [400, 'MissingTopic', 'config'],
      [403, 'InvalidProviderToken', 'config'],
      [403, 'ExpiredProviderToken', 'config'],
      [403, 'MissingProviderToken', 'config'],
      [403, 'BadEnvironmentKeyIdInToken', 'config'],
      [403, 'UnrelatedKeyIdInToken', 'config'],
      [403, 'Forbidden', 'config'],
      [403, undefined, 'config'],
      [429, 'TooManyProviderTokenUpdates', 'retry'],
      [429, 'TooManyRequests', 'retry'],
      [500, 'InternalServerError', 'retry'],
      [503, 'ServiceUnavailable', 'retry'],
      [503, 'Shutdown', 'retry'],
      [400, 'IdleTimeout', 'retry'],
      [undefined, undefined, 'retry'],
      [413, 'PayloadTooLarge', 'rejected'],
      [400, 'BadPriority', 'rejected'],
      [400, 'BadExpirationDate', 'rejected'],
      [400, 'BadMessageId', 'rejected'],
      [400, 'BadCollapseId', 'rejected'],
      [400, 'DuplicateHeaders', 'rejected'],
      [400, 'InvalidPushType', 'rejected'],
      [400, 'PayloadEmpty', 'rejected'],
      [400, 'MissingDeviceToken', 'rejected'],
      [400, undefined, 'rejected'],
      [404, 'BadPath', 'rejected'],
      [405, 'MethodNotAllowed', 'rejected'],
      [418, 'Teapot', 'rejected'],
    ]
    const wrong = table.filter(([st, re, want]) => classify(st, re) !== want).map(([st, re]) => `${st} ${re}`)
    check(`A3: classify() corretto per tutte le ${table.length} righe della tabella`, wrong.length === 0, wrong.join(', '))
  }

  // A4: DeviceTokenNotForTopic morto solo con un 200 nello stesso lotto
  {
    const nft = newToken()
    const s = await stub({ [nft]: { status: 400, body: '{"reason":"DeviceTokenNotForTopic"}' } })
    const withOk = await sendBatch([dev(1, nft), dev(2, newToken())], message, { origins: both(s) })
    const alone = await sendBatch([dev(1, nft)], message, { origins: both(s) })
    await s.close()
    check(
      'A4: not-for-topic e\' morto solo con un 200 nel lotto, da solo non cancella nulla',
      withOk.byDevice[0].outcome === 'not-for-topic' &&
        withOk.byDevice[1].outcome === 'sent' &&
        JSON.stringify(withOk.deadIds) === '[1]' &&
        alone.byDevice[0].outcome === 'not-for-topic' &&
        alone.deadIds.length === 0,
    )
  }

  // A5: 'config' ferma il lotto
  {
    const results: boolean[] = []
    for (const [status, reason] of [
      [403, 'InvalidProviderToken'],
      [400, 'BadTopic'],
    ] as const) {
      const bad = newToken()
      const s = await stub({ [bad]: { status, body: JSON.stringify({ reason }) } })
      const r = await sendBatch([dev(1, newToken()), dev(2, bad), dev(3, newToken()), dev(4, newToken())], message, { origins: both(s) })
      await s.close()
      results.push(
        r.byDevice.map((d) => d.outcome).join() === 'sent,config,skipped,skipped' && s.requests.length === 2 && r.stopped && r.deadIds.length === 0,
      )
    }
    check("A5: un esito 'config' (403, BadTopic) ferma il lotto: due richieste, gli altri 'skipped'", results.every(Boolean))
  }

  // A6: cache del JWT
  {
    const s = await stub()
    const now = Math.floor(Date.now() / 1000)
    for (let i = 0; i < 3; i++) await sendBatch([dev(i, newToken())], message, { origins: both(s), now })
    await sendBatch([dev(9, newToken())], message, { origins: both(s), now: now + 41 * 60 })
    await s.close()
    const jwts = s.requests.map(bearer)
    check(
      'A6: tre invii = un JWT; a +41 minuti ne nasce uno nuovo con iat piu\' alto',
      jwts[0] === jwts[1] && jwts[1] === jwts[2] && jwts[3] !== jwts[2] && (decodeJwt(jwts[3]).iat ?? 0) > (decodeJwt(jwts[2]).iat ?? 0),
    )
  }

  // A7: un origin per ambiente
  {
    const sb = await stub()
    const pr = await stub()
    const r = await sendBatch(
      [dev(1, newToken(), 'sandbox'), dev(2, newToken(), 'production'), dev(3, newToken(), 'sandbox'), dev(4, newToken(), 'staging')],
      message,
      { origins: { sandbox: sb.origin, production: pr.origin } },
    )
    await sb.close()
    await pr.close()
    check(
      "A7: sandbox e produzione ai loro origin (2 e 1 colpi), 'staging' = 'rejected' senza richiesta",
      sb.requests.length === 2 && pr.requests.length === 1 && r.byDevice.map((d) => d.outcome).join() === 'sent,sent,sent,rejected',
    )
  }

  // A8: BadDeviceToken butta giu' la sessione, il dispositivo dopo riceve comunque il suo 200
  {
    const bad = newToken()
    const s = await stub({ [bad]: { status: 400, body: '{"reason":"BadDeviceToken"}', destroyAfter: true } })
    const r = await sendBatch([dev(1, bad), dev(2, newToken()), dev(3, newToken())], message, { origins: both(s) })
    await s.close()
    check(
      'A8: BadDeviceToken poi due dispositivi sani: dead, sent, sent (sessione riaperta)',
      r.byDevice.map((d) => d.outcome).join() === 'dead,sent,sent' && JSON.stringify(r.deadIds) === '[1]',
    )
  }

  // A9: rotture di connessione = retry, mai dead
  {
    const gone = newToken()
    const hang = newToken()
    const s = await stub({ [gone]: { goaway: true }, [hang]: { hang: true } })
    const r = await sendBatch([dev(1, newToken()), dev(2, gone), dev(3, newToken()), dev(4, hang), dev(5, newToken())], message, {
      origins: both(s),
      timeoutMs: 300,
    })
    await s.close()
    // porta aperta e richiusa = connessione rifiutata
    const port = await new Promise<number>((resolve) => {
      const srv = createServer()
      srv.listen(0, '127.0.0.1', () => {
        const p = (srv.address() as { port: number }).port
        srv.close(() => resolve(p))
      })
    })
    const refused = await sendBatch([dev(6, newToken()), dev(7, newToken())], message, {
      origins: both({ origin: `http://127.0.0.1:${port}` }),
      timeoutMs: 300,
    })
    check(
      "A9: GOAWAY, nessuna risposta e connessione rifiutata sono 'retry', il lotto continua, nulla di dead",
      r.byDevice.map((d) => d.outcome).join() === 'sent,retry,sent,retry,sent' &&
        r.deadIds.length === 0 &&
        refused.byDevice.every((d) => d.outcome === 'retry') &&
        refused.deadIds.length === 0,
    )
  }

  // A10: configurazione
  {
    const base = { APNS_KEY_ID: KID, APPLE_TEAM_ID: TEAM, APPLE_APP_BUNDLE_ID: TOPIC }
    const four = ['APNS_KEY_ID', 'APNS_PRIVATE_KEY_B64', 'APPLE_TEAM_ID', 'APPLE_APP_BUNDLE_ID']
    const names = async (key: string | undefined) => (await apnsMissingConfig({ ...base, APNS_PRIVATE_KEY_B64: key })).join()
    const rsa = await generateKeyPair('RS256', { extractable: true })
    const p384 = await generateKeyPair('ES384', { extractable: true })
    const none = await apnsMissingConfig({})
    const s = await stub()
    const rejection = await sendBatch([dev(1, newToken())], message, { env: { ...base }, origins: both(s) }).then(
      () => '',
      (e: Error) => e.message,
    )
    await s.close()
    const outs = [await names(undefined), await names(Buffer.from('non e una chiave').toString('base64')), await names('!!!'), await names(await pkcs8B64(rsa.privateKey)), await names(await pkcs8B64(p384.privateKey))]
    check(
      'A10: apnsMissingConfig dice solo nomi (4 se vuota; chiave corrotta, RSA, P-384 rifiutate); senza config sendBatch lancia e non fa richieste',
      JSON.stringify([...none].sort()) === JSON.stringify([...four].sort()) &&
        outs.join('|') === ['APNS_PRIVATE_KEY_B64', 'APNS_PRIVATE_KEY_B64', 'APNS_PRIVATE_KEY_B64', 'APNS_PRIVATE_KEY_B64', 'APNS_PRIVATE_KEY_B64'].join('|') &&
        (await names(keyB64)) === '' &&
        rejection.includes('APNS_PRIVATE_KEY_B64') &&
        !rejection.includes(KID) &&
        s.requests.length === 0,
    )
  }

  // A11: nessun segreto in uscita (si controlla tutto cio' che A1-A10 hanno scritto e restituito)
  {
    const tokens = allTokens
    const s = await stub()
    const t = newToken()
    const r = await sendBatch([dev(1, t), dev(2, newToken())], message, { origins: both(s) })
    const jwts = s.requests.map(bearer)
    await s.close()
    const haystack = captured.join('') + JSON.stringify(r)
    const secrets = [...tokens, t, ...jwts, ...seenJwts, keyB64]
    const leaked = secrets.filter((x) => x.length > 8 && haystack.includes(x))
    check('A11: ne\' token di dispositivo, ne\' JWT, ne\' chiave in report, stdout o stderr', leaked.length === 0 && jwts.length === 2, `${leaked.length} trovati`)
  }

  // A12: l'ambiente letto e' esattamente di quattro variabili
  {
    const src = readFileSync(join(__dirname, '..', 'lib', 'push', 'apns.ts'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    const read = new Set([...src.matchAll(/\b(?:process\.)?env\.([A-Z0-9_]+)/g)].map((m) => m[1]))
    const dynamic = /\benv\[/.test(src)
    check(
      "A12: lib/push/apns.ts legge dall'ambiente esattamente le quattro variabili, nessun accesso dinamico",
      [...read].sort().join() === ['APNS_KEY_ID', 'APNS_PRIVATE_KEY_B64', 'APPLE_APP_BUNDLE_ID', 'APPLE_TEAM_ID'].sort().join() && !dynamic,
      [...read].join(),
    )
  }
}

main().catch((e) => {
  console.error(`FAIL: errore non gestito (${e instanceof Error ? e.message : String(e)})`)
  process.exit(1)
})
