// Helper dei gate dell'accesso (scripts/auth-flow.test.sh). Gira SOLO tramite
// scripts/dev-db.sh, con gli stessi AUTH_ENABLED / BETTER_AUTH_* / GOOGLE_* del
// dev server di prova, e rifiuta qualunque database che non sia il Postgres
// locale. Tutti gli utenti di prova hanno e-mail @fixture.invalid.
//
// Sottocomandi:
//   mint <email> <nome> [giorniDiEta]   crea utente + account google + sessione e
//                                       stampa "<userId> <cookieFirmato> <tokenNudo>"
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
