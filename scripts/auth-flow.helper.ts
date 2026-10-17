// Helper dei gate dell'accesso (scripts/auth-flow.test.sh). Gira SOLO tramite
// scripts/dev-db.sh, con gli stessi AUTH_ENABLED / BETTER_AUTH_* / GOOGLE_* del
// dev server di prova, e rifiuta qualunque database che non sia il Postgres
// locale. Tutti gli utenti di prova hanno e-mail @fixture.invalid.
//
// Sottocomandi:
//   mint <email> <nome> [giorniDiEta] [userAgent] [--fake-tokens]
//                                       crea utente + account google + sessione e
//                                       stampa "<userId> <cookieFirmato> <tokenNudo>".
//                                       Con --fake-tokens l'account nasce con access,
//                                       refresh e id token finti (l'hook deve azzerarli)
//   session <userId> [giorniDiEta] [userAgent]
//                                       aggiunge una sessione a un utente di prova e
//                                       stampa "<sessionId> <cookieFirmato> <tokenNudo>"
//   create-google-user <nome>           crea utente + account google COME il callback
//                                       (hook compresi), con token e foto finti, e
//                                       stampa cosa e' rimasto nel database
//   rate <ip> | rate --no-ip            UN POST a /api/auth/sign-in/social in QUESTO
//                                       processo (auth.handler), con X-Real-IP <ip>
//                                       o senza; stampa lo stato HTTP
//   image-rules                         prova le regole della foto (D-20): create e
//                                       aggiornamento all'accesso, stampa una riga
//   registry-tables                     stampa le tabelle di USER_DATA_REGISTRY, una per riga
//   cleanup                             cancella gli utenti @fixture.invalid
//                                       (la cascata porta via sessioni e account)
import { makeSignature } from 'better-auth/crypto'
import { getAuth } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { USER_DATA_REGISTRY } from '../lib/userData/registry'

const FIXTURE_DOMAIN = '@fixture.invalid'
const FIXTURE_IMAGE = 'https://lh3.googleusercontent.com/a/fixture-photo=s96-c'

function fail(message: string): never {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

function requireAuth() {
  const auth = getAuth()
  if (!auth) fail("auth non attivo: servono AUTH_ENABLED=true e le variabili BETTER_AUTH_* / GOOGLE_*")
  return auth
}

// Aggiunge una sessione a un utente: user agent e anzianita' a piacere, poi il
// cookie come lo imposta il browser (URL-encoded "<valore>.<firma>" HMAC).
async function addSession(userId: string, ageDays: number, userAgent: string | undefined): Promise<string> {
  const ctx = await requireAuth().$context
  const session = await ctx.internalAdapter.createSession(userId)
  const back = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000)
  const data: { createdAt?: Date; updatedAt?: Date; userAgent?: string } = {}
  if (ageDays > 0) Object.assign(data, { createdAt: back, updatedAt: back })
  if (userAgent) data.userAgent = userAgent
  if (Object.keys(data).length > 0) await prisma.session.update({ where: { token: session.token }, data })
  const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`
  return `${session.id} ${encodeURIComponent(signed)} ${session.token}`
}

async function mint(
  email: string,
  name: string,
  ageDays: number,
  userAgent: string | undefined,
  fakeTokens: boolean,
): Promise<void> {
  if (!email.endsWith(FIXTURE_DOMAIN)) fail(`l'e-mail di prova deve finire con ${FIXTURE_DOMAIN}`)
  const ctx = await requireAuth().$context
  // Stessa strada del callback di Google: l'adapter interno, quindi anche gli hook.
  const user = await ctx.internalAdapter.createUser(
    { email, name, emailVerified: true, image: FIXTURE_IMAGE },
    { method: 'oauth', oauth: { providerId: 'google' } },
  )
  await ctx.internalAdapter.createAccount({
    userId: user.id,
    providerId: 'google',
    accountId: `fixture-${user.id}`,
    ...(fakeTokens
      ? { accessToken: 'fake-access-token', refreshToken: 'fake-refresh-token', idToken: 'fake-id-token' }
      : {}),
  })
  const [, cookie, token] = (await addSession(user.id, ageDays, userAgent)).split(' ')
  console.log(`${user.id} ${cookie} ${token}`)
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

// Regole della foto (D-20). Create: solo https e *.googleusercontent.com.
// Accesso successivo: la libreria passa nome, foto ed e-mail insieme
// (overrideUserInfoOnSignIn), l'hook deve tenere solo la foto.
async function imageRules(): Promise<void> {
  const ctx = await requireAuth().$context
  const oauth = { method: 'oauth', oauth: { providerId: 'google' } } as const
  const stamp = Date.now()
  const created = async (tag: string, image: string) => {
    const user = await ctx.internalAdapter.createUser(
      { email: `img-${tag}-${stamp}${FIXTURE_DOMAIN}`, name: `Img ${tag}`, emailVerified: true, image },
      oauth,
    )
    return user
  }
  const read = async (id: string) => prisma.user.findUniqueOrThrow({ where: { id } })
  const out: string[] = []
  for (const [tag, url] of [
    ['http', 'http://lh3.googleusercontent.com/a/x'],
    ['foreign', 'https://example.com/a/x.png'],
    ['suffix', 'https://evilgoogleusercontent.com/a/x'],
    ['creds', 'https://lh3.googleusercontent.com@example.com/a/x'],
    ['junk', 'not a url'],
  ] as const) {
    out.push(`${tag}=${(await read((await created(tag, url)).id)).image}`)
  }
  const user = await created('good', FIXTURE_IMAGE)
  out.push(`good=${(await read(user.id)).image}`)
  // Accesso successivo con foto nuova, altro nome e altra e-mail: cambia solo la foto.
  const fresh = 'https://lh3.googleusercontent.com/a/fresh-photo=s96-c'
  await ctx.internalAdapter.updateUser(user.id, { name: 'Nome Di Google', image: fresh, email: `altra-${stamp}${FIXTURE_DOMAIN}`, emailVerified: false })
  const row = await read(user.id)
  out.push(`override_image=${row.image === fresh} override_name=${row.name} override_email=${row.email === `img-good-${stamp}${FIXTURE_DOMAIN}`} override_verified=${row.emailVerified}`)
  // Google non manda piu' la foto: null, non quella vecchia.
  await ctx.internalAdapter.updateUser(user.id, { name: 'Nome Di Google', image: undefined, email: row.email, emailVerified: true })
  out.push(`override_none=${(await read(user.id)).image}`)
  // Scrittura diretta (POST /api/auth/update-user): foto estranea scartata, nome valido passa.
  await ctx.internalAdapter.updateUser(user.id, { image: 'https://example.com/a/x.png' })
  out.push(`direct_foreign=${(await read(user.id)).image}`)
  await ctx.internalAdapter.updateUser(user.id, { name: '  Zeno  ' })
  out.push(`direct_name=${(await read(user.id)).name}`)
  console.log(out.join(' '))
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
    case 'mint': {
      const positional = args.filter((a) => a !== '--fake-tokens')
      if (positional.length < 2) fail('uso: mint <email> <nome> [giorniDiEta] [userAgent] [--fake-tokens]')
      await mint(positional[0], positional[1], Number(positional[2] ?? 0), positional[3], args.includes('--fake-tokens'))
      break
    }
    case 'session':
      if (args.length < 1) fail('uso: session <userId> [giorniDiEta] [userAgent]')
      console.log(await addSession(args[0], Number(args[1] ?? 0), args[2]))
      break
    case 'create-google-user':
      if (args.length < 1) fail('uso: create-google-user <nome>')
      await createGoogleUser(args[0])
      break
    case 'image-rules':
      await imageRules()
      break
    case 'rate':
      if (args[0] === '--no-ip') await rate(undefined)
      else if (args.length >= 1 && args[1] !== '--no-ip') await rate(args[0])
      else fail('uso: rate <ip> | rate --no-ip')
      break
    case 'registry-tables':
      for (const entry of USER_DATA_REGISTRY) console.log(entry.table)
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
