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

    // <!-- PR2-PR9 -->
  } finally {
    await cleanup()
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('FAIL: eccezione', e instanceof Error ? e.message : e)
  process.exit(1)
})
