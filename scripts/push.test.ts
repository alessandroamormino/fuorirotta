// Gate della potatura dei dispositivi push (check:push, test:local). Parla con un VERO server HTTP/2 locale
// (scripts/apns-stub.ts) e col Postgres LOCALE: gira SOLO tramite scripts/dev-db.sh e rifiuta qualunque
// database che non sia fuorirotta_dev su localhost:5433. Mai un server di Apple, mai una chiave vera.
//
// Sezioni (ognuna stampa "ok  PR<n>: ..." o "FAIL: ..." ed esce con 1 al primo errore):
//   PR1 (tracer) due dispositivi, Apple dice Unregistered al secondo: sparisce solo quello
//   PR2 410 ExpiredToken e 400 BadDeviceToken cancellano esattamente la loro riga
//   PR3 BadTopic, 403, 429, 413, 5xx, corpo non JSON, nessuna risposta, GOAWAY, connessione rifiutata: nulla cancellato
//   PR4 DeviceTokenNotForTopic: da solo non cancella; con un 200 nello stesso lotto si
//   PR5 un 410 piu' vecchio di last_seen_at (l'app si e' ri-registrata) lascia la riga; uno piu' nuovo la toglie
//   PR6 gli altri dispositivi dello stesso utente e quelli di un altro utente restano
//   PR7 due esecuzioni di fila: la seconda raggiunge solo le righe rimaste e non cancella nulla
//   PR8 ne' token, ne' JWT, ne' chiave in report, stdout o stderr
//   PR9 senza APNS_PRIVATE_KEY_B64 sendToUser rifiuta con il nome, senza richieste e senza cancellazioni
//
// Tutte le righe di prova hanno id o e-mail che iniziano con "push-gate-" e si cancellano all'inizio e alla fine.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { exportPKCS8, generateKeyPair } from 'jose'
import { startApnsStub, type StubAnswer } from './apns-stub'

if (!/@localhost:5433\/fuorirotta_dev/.test(process.env.DATABASE_URL ?? '')) {
  console.error('FAIL: DATABASE_URL non e il Postgres locale di sviluppo (usa scripts/dev-db.sh)')
  process.exit(1)
}

const PREFIX = 'push-gate-'
const message = { title: 'Prova', body: 'Prova' }

// Cattura di stdout/stderr per PR8 (si inoltra comunque a chi legge il terminale).
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

async function main(): Promise<void> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  const keyB64 = Buffer.from(await exportPKCS8(privateKey)).toString('base64')
  const env = { APNS_KEY_ID: 'KEYID12345', APPLE_TEAM_ID: 'TEAMID1234', APPLE_APP_BUNDLE_ID: 'it.fuorirotta.app.test', APNS_PRIVATE_KEY_B64: keyB64 }

  type Send = typeof import('../lib/push/send')
  type Db = typeof import('../lib/prisma')
  const sendMod = (await import('../lib/push/send')) as Send & { default?: Send }
  const dbMod = (await import('../lib/prisma')) as Db & { default?: Db }
  const { sendToUser } = sendMod.default ?? sendMod
  const { prisma } = dbMod.default ?? dbMod

  const allTokens: string[] = []
  const newToken = () => {
    const t = 'cd' + randomBytes(31).toString('hex')
    allTokens.push(t)
    return t
  }
  const both = (s: { origin: string }) => ({ sandbox: s.origin, production: s.origin })
  const cleanup = () => prisma.user.deleteMany({ where: { id: { startsWith: PREFIX } } })

  // Un utente di prova con una sessione e N dispositivi (token nuovi); restituisce id e righe.
  async function fixture(tag: string, n: number, lastSeenAt?: Date) {
    const userId = `${PREFIX}${tag}`
    await prisma.user.create({ data: { id: userId, name: tag, email: `${userId}@example.test` } })
    await prisma.session.create({ data: { id: `${PREFIX}s-${tag}`, userId, token: `${PREFIX}t-${tag}`, expiresAt: new Date(Date.now() + 3600_000) } })
    const tokens = Array.from({ length: n }, newToken)
    for (const deviceToken of tokens) {
      await prisma.pushDevice.create({ data: { userId, sessionId: `${PREFIX}s-${tag}`, deviceToken, environment: 'sandbox', ...(lastSeenAt ? { lastSeenAt } : {}) } })
    }
    return { userId, tokens }
  }
  const remaining = async (userId: string) => (await prisma.pushDevice.findMany({ where: { userId }, select: { deviceToken: true } })).map((r) => r.deviceToken)
  const stub = (script: Record<string, StubAnswer>) => startApnsStub((t) => script[t] ?? { status: 200 })

  // Esegue sendToUser contro uno stub appena avviato, ne annota report e JWT visti (per PR8) e lo chiude.
  const reports: unknown[] = []
  const seenJwts: string[] = []
  async function run(userId: string, script: Record<string, StubAnswer>, opts: { msg?: typeof message; timeoutMs?: number } = {}) {
    const s = await stub(script)
    try {
      const r = await sendToUser(userId, opts.msg ?? message, { env, origins: both(s), timeoutMs: opts.timeoutMs ?? 2000 })
      reports.push(r)
      return { r, hits: s.requests.length }
    } finally {
      for (const q of s.requests) seenJwts.push(String(q.headers.authorization ?? '').replace(/^bearer /, ''))
      await s.close()
    }
  }
  const dead410 = (ts: number): StubAnswer => ({ status: 410, body: JSON.stringify({ reason: 'Unregistered', timestamp: ts }) })
  const reason = (status: number, r: string): StubAnswer => ({ status, body: JSON.stringify({ reason: r }) })

  await cleanup()
  try {
    // PR1 (tracer)
    {
      const { userId, tokens } = await fixture('pr1', 2)
      const [t1, t2] = tokens
      const s = await stub({ [t2]: { status: 410, body: JSON.stringify({ reason: 'Unregistered', timestamp: Date.now() }) } })
      const r = await sendToUser(userId, message, { env, origins: both(s) })
      await s.close()
      const left = await remaining(userId)
      check('PR1: due dispositivi, Unregistered al secondo: sparisce solo quello', r.sent === 1 && r.pruned === 1 && left.length === 1 && left[0] === t1, JSON.stringify({ ...r, byDevice: r.byDevice.length }))
    }

    // PR2
    {
      const { userId, tokens } = await fixture('pr2', 3)
      const [ok, expired, bad] = tokens
      const { r } = await run(userId, { [expired]: reason(410, 'ExpiredToken'), [bad]: reason(400, 'BadDeviceToken') })
      const left = await remaining(userId)
      check('PR2: 410 ExpiredToken e 400 BadDeviceToken cancellano esattamente le loro righe', r.pruned === 2 && left.length === 1 && left[0] === ok)
    }

    // PR3: ogni risposta che NON e' un "morto" esplicito, ciascuna sul suo utente, non cancella nulla
    {
      const cases: Array<[string, StubAnswer | 'long' | 'refused']> = [
        ['400 BadTopic', reason(400, 'BadTopic')],
        ['403 InvalidProviderToken', reason(403, 'InvalidProviderToken')],
        ['403 ExpiredProviderToken', reason(403, 'ExpiredProviderToken')],
        ['429 TooManyProviderTokenUpdates', reason(429, 'TooManyProviderTokenUpdates')],
        ['429 TooManyRequests', reason(429, 'TooManyRequests')],
        ['413 (messaggio da 5000 byte)', 'long'],
        ['500', reason(500, 'InternalServerError')],
        ['503', reason(503, 'ServiceUnavailable')],
        ['corpo non JSON', { status: 503, body: '<html>bad gateway</html>' }],
        ['nessuna risposta', { hang: true }],
        ['GOAWAY', { goaway: true }],
        ['connessione rifiutata', 'refused'],
      ]
      const failures: string[] = []
      for (const [i, [label, answer]] of cases.entries()) {
        const { userId, tokens } = await fixture(`pr3-${i}`, 1)
        let r
        if (answer === 'refused') {
          const port = await new Promise<number>((resolve) => {
            const srv = createServer()
            srv.listen(0, '127.0.0.1', () => {
              const p = (srv.address() as { port: number }).port
              srv.close(() => resolve(p))
            })
          })
          const closed = { origin: `http://127.0.0.1:${port}` }
          r = await sendToUser(userId, message, { env, origins: both(closed), timeoutMs: 300 })
          reports.push(r)
        } else {
          const script = answer === 'long' ? {} : { [tokens[0]]: answer }
          const msg = answer === 'long' ? { title: 'Prova', body: 'x'.repeat(5000) } : message
          ;({ r } = await run(userId, script, { msg, timeoutMs: 300 }))
        }
        if (r.pruned !== 0 || (await remaining(userId)).length !== 1) failures.push(label)
      }
      check('PR3: 12 risposte che non sono un "morto" esplicito non cancellano nulla', failures.length === 0, failures.join(', '))
    }

    // PR4
    {
      const alone = await fixture('pr4a', 1)
      const a = await run(alone.userId, { [alone.tokens[0]]: reason(400, 'DeviceTokenNotForTopic') })
      const withOk = await fixture('pr4b', 2)
      const [wrong, good] = withOk.tokens
      const b = await run(withOk.userId, { [wrong]: reason(400, 'DeviceTokenNotForTopic') })
      const left = await remaining(withOk.userId)
      check(
        'PR4: DeviceTokenNotForTopic da solo non cancella; con un 200 nello stesso lotto si',
        a.r.pruned === 0 && (await remaining(alone.userId)).length === 1 && b.r.pruned === 1 && left.length === 1 && left[0] === good,
      )
    }

    // PR5: la guardia sul timestamp del 410
    {
      const seen = new Date(Date.now() - 3600_000)
      const { userId, tokens } = await fixture('pr5', 2, seen)
      const [reRegistered, stale] = tokens
      const { r } = await run(userId, { [reRegistered]: dead410(seen.getTime() - 60_000), [stale]: dead410(seen.getTime() + 60_000) })
      const left = await remaining(userId)
      check('PR5: 410 piu\' vecchio di last_seen_at lascia la riga, uno piu\' nuovo la toglie', r.pruned === 1 && left.length === 1 && left[0] === reRegistered)
    }

    // PR6
    {
      const x = await fixture('pr6x', 3)
      const y = await fixture('pr6y', 2)
      const [okTok, retryTok, deadTok] = x.tokens
      const before = await prisma.pushDevice.count({ where: { userId: { startsWith: PREFIX } } })
      // anche lo stub sa rispondere "morto" ai token dell'altro utente: non devono nemmeno essere interpellati
      const script: Record<string, StubAnswer> = { [retryTok]: reason(503, 'ServiceUnavailable'), [deadTok]: dead410(Date.now()) }
      for (const t of y.tokens) script[t] = dead410(Date.now())
      const { r, hits } = await run(x.userId, script)
      const after = await prisma.pushDevice.count({ where: { userId: { startsWith: PREFIX } } })
      const left = (await remaining(x.userId)).sort()
      check(
        'PR6: restano i dispositivi con 200 o retry e quelli di un altro utente',
        r.pruned === 1 && hits === 3 && before - after === 1 && left.join() === [okTok, retryTok].sort().join() && (await remaining(y.userId)).length === 2,
      )
    }

    // PR7
    {
      const { userId, tokens } = await fixture('pr7', 2)
      const [ok, gone] = tokens
      const script = { [gone]: dead410(Date.now()) }
      const first = await run(userId, script)
      const second = await run(userId, script)
      const left = await remaining(userId)
      check(
        'PR7: la seconda esecuzione raggiunge solo le righe rimaste e non cancella nulla',
        first.r.pruned === 1 && first.hits === 2 && second.r.pruned === 0 && second.hits === 1 && left.length === 1 && left[0] === ok,
      )
    }

    // PR9 (prima di PR8, che guarda tutto cio' che e' stato scritto)
    {
      const { userId } = await fixture('pr9', 2)
      const s = await stub({})
      let message9 = ''
      try {
        await sendToUser(userId, message, { env: { ...env, APNS_PRIVATE_KEY_B64: undefined }, origins: both(s) })
      } catch (e) {
        message9 = e instanceof Error ? e.message : String(e)
      }
      const hits = s.requests.length
      await s.close()
      check(
        'PR9: senza APNS_PRIVATE_KEY_B64 sendToUser rifiuta con il nome, senza richieste e senza cancellazioni',
        message9.includes('APNS_PRIVATE_KEY_B64') && !message9.includes(keyB64) && hits === 0 && (await remaining(userId)).length === 2,
        message9,
      )
    }

    // PR8
    {
      const haystack = captured.join('') + JSON.stringify(reports)
      const secrets = [...allTokens, ...seenJwts, keyB64]
      const leaked = secrets.filter((x) => x.length > 8 && haystack.includes(x))
      check('PR8: ne\' token, ne\' JWT, ne\' chiave in report, stdout o stderr', leaked.length === 0 && seenJwts.length > 10 && reports.length > 10, `${leaked.length} trovati`)
    }
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('FAIL: eccezione', e instanceof Error ? e.message : e)
  process.exit(1)
})
