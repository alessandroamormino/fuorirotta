// Helper dei gate dell'accesso (scripts/auth-flow.test.sh). Gira SOLO tramite
// scripts/dev-db.sh, con gli stessi AUTH_ENABLED / BETTER_AUTH_* / GOOGLE_* del
// dev server di prova, e rifiuta qualunque database che non sia il Postgres
// locale. Tutti gli utenti di prova hanno e-mail @fixture.invalid.
//
// Sottocomandi:
//   mint <email> <nome> [giorniDiEta]   crea utente + account google + sessione e
//                                       stampa "<userId> <cookieFirmato> <tokenNudo>"
//   create-google-user <nome>           crea utente + account google COME il callback
//                                       (hook compresi), con token e foto finti, e
//                                       stampa cosa e' rimasto nel database
//   rate <ip> | rate --no-ip            UN POST a /api/auth/sign-in/social in QUESTO
//                                       processo (auth.handler), con X-Real-IP <ip>
//                                       o senza; stampa lo stato HTTP
//   cleanup                             cancella gli utenti @fixture.invalid
//                                       (la cascata porta via sessioni e account)
import { makeSignature } from 'better-auth/crypto'
import { getAuth } from '../lib/auth'
import { prisma } from '../lib/prisma'

const FIXTURE_DOMAIN = '@fixture.invalid'

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function requireAuth() {
  const auth = getAuth()
  if (!auth) fail("auth non attivo: servono AUTH_ENABLED=1 e le variabili BETTER_AUTH_* / GOOGLE_*")
  return auth
}

async function mint(email: string, name: string, ageDays: number): Promise<void> {
  if (!email.endsWith(FIXTURE_DOMAIN)) fail(`l'e-mail di prova deve finire con ${FIXTURE_DOMAIN}`)
  const ctx = await requireAuth().$context
  // Stessa strada del callback di Google: l'adapter interno, quindi anche gli hook.
  const user = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: true },
    { method: 'oauth', oauth: { providerId: 'google' } },
  )
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    providerId: 'google',
    accountId: `fixture-${user.id}`,
  })
  const session = await ctx.internalAdapter.createSession(user.id)
  if (ageDays > 0) {
    const back = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
    await prisma.session.update({
      where: { token: session.token },
      data: { createdAt: back, updatedAt: back },
    })
  }
  // Il cookie e' "<valore>.<firma>" con la firma HMAC della libreria; lo
  // stampiamo come lo imposta il browser (URL-encoded).
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`
  console.log(`${user.id} ${encodeURIComponent(signed)} ${session.token}`)
}

async function createGoogleUser(name: string): Promise<void> {
  const ctx = await requireAuth().$context
  const email = `google-${Date.now()}${FIXTURE_DOMAIN}`
  // Come il callback: un profilo con foto, un account con token veri di Google.
  const user = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: true, image: 'https://lh3.googleusercontent.com/a/fixture' },
    { method: 'oauth', oauth: { providerId: 'google' } },
  )
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    providerId: 'google',
    accountId: `fixture-${user.id}`,
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    idToken: 'fake-id-token',
  })
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  const account = await prisma.account.findFirstOrThrow({ where: { userId: user.id } })
  const codePoints = Array.from(stored.name)
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(stored.name)
  console.log(
    `codepoints=${codePoints.length} lone_surrogates=${lone} image=${stored.image} ` +
      `accessToken=${account.accessToken} refreshToken=${account.refreshToken} idToken=${account.idToken}`,
  )
}

async function rate(ip: string | undefined): Promise<void> {
  const auth = requireAuth()
  const base = process.env.BETTER_AUTH_URL as string
  const headers: Record<string, string> = { origin: new URL(base).origin, 'content-type': 'application/json' }
  if (ip) headers['x-real-ip'] = ip
  const response = await auth.handler(
    new Request(`${base}/api/auth/sign-in/social`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ provider: 'google', callbackURL: '/', errorCallbackURL: '/' }),
    }),
  )
  console.log(response.status)
}

async function cleanup(): Promise<void> {
  const { count } = await prisma.user.deleteMany({ where: { email: { endsWith: FIXTURE_DOMAIN } } })
  console.log(`utenti di prova cancellati: ${count}`)
}

async function main(): Promise<void> {
  // Rete di sicurezza oltre a dev-db.sh: mai un database che non sia quello locale.
  if (!/@localhost:5433\/fuorirotta_dev/.test(process.env.DATABASE_URL ?? '')) {
    fail('DATABASE_URL non e il Postgres locale di sviluppo (usa scripts/dev-db.sh)')
  }
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case 'mint':
      if (args.length < 2) fail('uso: mint <email> <nome> [giorniDiEta]')
      await mint(args[0], args[1], Number(args[2] ?? 0))
      break
    case 'create-google-user':
      if (args.length < 1) fail('uso: create-google-user <nome>')
      await createGoogleUser(args[0])
      break
    case 'rate':
      if (args[0] === '--no-ip') await rate(undefined)
      else if (args.length >= 1 && args[1] !== '--no-ip') await rate(args[0])
      else fail('uso: rate <ip> | rate --no-ip')
      break
    case 'cleanup':
      await cleanup()
      break
    default:
      fail(`sottocomando sconosciuto: ${command ?? '(nessuno)'}`)
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
