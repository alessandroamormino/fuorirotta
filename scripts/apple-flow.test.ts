// Gate dell'accesso con Apple (check:apple-flow, test:local). Percorre in-process,
// con auth.handler, la libreria Better Auth reale e il Postgres LOCALE, con gli
// endpoint di Apple (e il token di Google) sostituiti da uno stub di
// globalThis.fetch. Gira SOLO tramite scripts/dev-db.sh e rifiuta qualunque
// database che non sia fuorirotta_dev su localhost:5433.
//
// Sezioni (ognuna stampa "ok  F<n>: ..." o "FAIL: ..." ed esce con 1 al primo errore):
//   F1  sign-in/social con provider apple: URL di Apple, form_post, scope, cookie Lax
//   F2  il POST cross-site di Apple, con e senza cookie, diventa un 302 al GET
//   F3  primo accesso: nome dal campo user, token cifrato, access e id token nulli
//   F4  accesso successivo: stesso utente, nome e e-mail intatti, token sostituito
//   F5  nessun campo user: nome neutro per il relay, parte locale per le altre e-mail
//   F6  collisione di e-mail (anche con maiuscole diverse): account_not_linked, nulla creato
//   F6b come F6 a parti invertite: Google su un account creato da Apple
//   F7  collegamento esplicito dal profilo con e-mail diversa: identita' invariata
//   F8  un account Apple gia' di un altro utente: account_already_linked_to_different_user
//   F9  scollegare l'unico provider: 400 FAILED_TO_UNLINK_LAST_ACCOUNT
//
// Gli helper (startApple, applePost, follow, cookieFrom, mintGoogleUser e il
// registro dello stub) sono funzioni con nome: il piano 03 aggiunge qui le sue
// rotte (revoca e notifiche). Tutte le e-mail di prova iniziano con "apple-flow-".
import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto'

if (!/@localhost:5433\/fuorirotta_dev/.test(process.env.DATABASE_URL ?? '')) {
  console.error('FAIL: DATABASE_URL non e il Postgres locale di sviluppo (usa scripts/dev-db.sh)')
  process.exit(1)
}

const BASE = 'https://fuori-rotta.it'
const WEB_ID = 'it.fuorirotta.web.test'
const BUNDLE_ID = 'it.fuorirotta.app.test'
const TEAM_ID = 'TEAMID1234'
const KEY_ID = 'KEYID12345'
const GOOGLE_ID = 'test-client-id.apps.googleusercontent.com'
const APPLE_ORIGIN = 'https://appleid.apple.com'
const EMAIL_PREFIX = 'apple-flow-'
const IP_PREFIX = '203.0.113.'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
Object.assign(process.env, {
  AUTH_ENABLED: 'true',
  BETTER_AUTH_URL: BASE,
  BETTER_AUTH_SECRET: 'q8Vn2LzTfX0cRk5aYw9JdHs3UeBm7PoG1iNtZ4Ab',
  GOOGLE_CLIENT_ID: GOOGLE_ID,
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  APPLE_AUTH_ENABLED: 'true',
  APPLE_CLIENT_ID: WEB_ID,
  APPLE_APP_BUNDLE_ID: BUNDLE_ID,
  APPLE_TEAM_ID: TEAM_ID,
  APPLE_KEY_ID: KEY_ID,
  APPLE_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64'),
})

// --- Registro dello stub di fetch --------------------------------------------
type AppleGrant = { sub: string; email: string }
type GoogleGrant = { sub: string; email: string; name: string; picture: string }
const appleCodes = new Map<string, AppleGrant>()
const googleCodes = new Map<string, GoogleGrant>()
const issued: string[] = [] // refresh token emessi da Apple, in ordine
const stubErrors: string[] = [] // tutto cio' che lo stub non si aspettava: fa fallire il prossimo controllo
let tokenCalls = 0
let seq = 0

const b64url = (value: object | string) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
const unsignedJwt = (claims: object) => `${b64url({ alg: 'none' })}.${b64url(claims)}.`

function checkClientSecret(secret: string | null, clientId: string | null): void {
  const parts = (secret ?? '').split('.')
  if (parts.length !== 3) return void stubErrors.push('client_secret non e un JWT a tre parti')
  const [head, body, signature] = parts
  const header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8')) as { alg?: string; kid?: string }
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
  const valid = verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey as KeyObject, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))
  const exp = Number(claims.exp)
  const iat = Number(claims.iat)
  if (header.alg !== 'ES256' || header.kid !== KEY_ID) stubErrors.push(`header del client secret errato: ${JSON.stringify(header)}`)
  if (claims.iss !== TEAM_ID || claims.sub !== clientId || claims.aud !== APPLE_ORIGIN) stubErrors.push('claim del client secret errati')
  if (!(exp - iat > 0 && exp - iat <= 15777000)) stubErrors.push('durata del client secret fuori limite')
  if (!valid) stubErrors.push('firma del client secret non valida')
}

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null
  const url = request ? request.url : String(input)
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase()
  const raw = init?.body !== undefined && init.body !== null ? String(init.body) : request ? await request.clone().text() : ''
  const form = new URLSearchParams(raw)
  const json = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  if (method === 'POST' && url === `${APPLE_ORIGIN}/auth/token`) {
    tokenCalls += 1
    checkClientSecret(form.get('client_secret'), form.get('client_id'))
    const grant = appleCodes.get(form.get('code') ?? '')
    if (!grant) return json({ error: 'invalid_grant' })
    const refresh = `RT-${issued.length + 1}`
    issued.push(refresh)
    return json({
      access_token: `AT-${issued.length}`,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refresh,
      id_token: unsignedJwt({ iss: APPLE_ORIGIN, aud: WEB_ID, sub: grant.sub, email: grant.email, email_verified: 'true' }),
    })
  }
  if (method === 'POST' && url === 'https://oauth2.googleapis.com/token') {
    const grant = googleCodes.get(form.get('code') ?? '')
    if (!grant) return json({ error: 'invalid_grant' })
    return json({
      access_token: 'google-access',
      token_type: 'Bearer',
      expires_in: 3600,
      id_token: unsignedJwt({
        iss: 'https://accounts.google.com',
        aud: GOOGLE_ID,
        sub: grant.sub,
        email: grant.email,
        email_verified: true,
        name: grant.name,
        picture: grant.picture,
      }),
    })
  }
  stubErrors.push(`fetch inatteso: ${method} ${url}`)
  return new Response('stub: URL inatteso', { status: 500 })
}) as typeof fetch

// --- Controlli ------------------------------------------------------------------
function check(name: string, condition: boolean, detail = ''): void {
  if (stubErrors.length > 0) {
    console.error(`FAIL: ${name} (stub: ${stubErrors.join(' | ')})`)
    process.exit(1)
  }
  if (!condition) {
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`)
    process.exit(1)
  }
  console.log(`ok  ${name}`)
}

// --- Helper della richiesta (ogni richiesta ha un X-Real-IP suo: 5 sign-in al minuto) ---
let ipCounter = 0
const nextIp = () => `${IP_PREFIX}${(ipCounter += 1)}`
type Handler = (request: Request) => Promise<Response>
let handler: Handler

const loc = (response: Response) => response.headers.get('location') ?? ''

/** "nome=valore" del cookie `name` (con o senza prefisso) tra i Set-Cookie, '' se manca. */
function cookieFrom(setCookies: string[], name: string): string {
  const found = setCookies.find((line) => new RegExp(`^(?:__Secure-)?fuorirotta\\.${name}=`).test(line))
  return found ? found.split(';')[0] : ''
}

type Started = { url: URL; state: string; stateCookie: string; setCookies: string[]; status: number }

/** Avvia l'accesso (o, con path link-social, il collegamento) con Apple. */
async function startApple(
  callbackURL: string,
  errorCallbackURL: string,
  ip: string,
  sessionCookie?: string,
  path = '/api/auth/sign-in/social',
  provider = 'apple',
): Promise<Started> {
  const headers: Record<string, string> = { origin: BASE, 'content-type': 'application/json', 'x-real-ip': ip }
  if (sessionCookie) headers.cookie = sessionCookie
  const response = await handler(
    new Request(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify({ provider, callbackURL, errorCallbackURL }) }),
  )
  const body = (await response.json().catch(() => ({}))) as { url?: string }
  const url = new URL(body.url ?? 'about:blank')
  const setCookies = response.headers.getSetCookie()
  return { url, state: url.searchParams.get('state') ?? '', stateCookie: cookieFrom(setCookies, 'state'), setCookies, status: response.status }
}

/** Il POST cross-site di Apple al callback (form_post), come lo fa il browser dopo il consenso. */
function applePost(code: string, state: string, userJson?: string, cookie?: string, ip: string = nextIp()): Promise<Response> {
  const form = new URLSearchParams({ code, state, id_token: 'ignorato' })
  if (userJson) form.set('user', userJson)
  const headers: Record<string, string> = { origin: APPLE_ORIGIN, 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip }
  if (cookie) headers.cookie = cookie
  return handler(new Request(`${BASE}/api/auth/callback/apple`, { method: 'POST', headers, body: form.toString() }))
}

/** Il GET same-site verso cui la libreria rimanda il POST. */
function follow(location: string, cookie: string, ip: string = nextIp()): Promise<Response> {
  return handler(new Request(new URL(location, BASE), { headers: { cookie, 'x-real-ip': ip } }))
}

type Flow = { post: Response; last: Response; location: string; session: string; started: Started }

/** Un giro completo: avvio, POST di Apple, GET con i cookie del browser. */
async function appleFlow(
  grant: AppleGrant,
  opts: { userJson?: string; callbackURL?: string; errorCallbackURL?: string; sessionCookie?: string; link?: boolean } = {},
): Promise<Flow> {
  const code = `apple-code-${(seq += 1)}`
  appleCodes.set(code, grant)
  const started = await startApple(
    opts.callbackURL ?? '/account',
    opts.errorCallbackURL ?? '/accedi?via=apple',
    nextIp(),
    opts.sessionCookie,
    opts.link ? '/api/auth/link-social' : '/api/auth/sign-in/social',
  )
  const post = await applePost(code, started.state, opts.userJson)
  const browserCookies = [started.stateCookie, opts.sessionCookie].filter(Boolean).join('; ')
  const last = await follow(loc(post), browserCookies)
  return { post, last, location: loc(last), session: cookieFrom(last.headers.getSetCookie(), 'session_token'), started }
}

/** Accesso con Google (stub del token) fino alla redirezione finale. */
async function googleFlow(grant: GoogleGrant, callbackURL: string, errorCallbackURL: string): Promise<{ location: string }> {
  const code = `google-code-${(seq += 1)}`
  googleCodes.set(code, grant)
  const started = await startApple(callbackURL, errorCallbackURL, nextIp(), undefined, '/api/auth/sign-in/social', 'google')
  const response = await follow(`/api/auth/callback/google?code=${code}&state=${started.state}`, started.stateCookie)
  return { location: loc(response) }
}

async function main(): Promise<void> {
  const { getAuth } = await import('../lib/auth')
  const { prisma } = await import('../lib/prisma')
  const { makeSignature } = await import('better-auth/crypto')
  const { decryptOAuthToken } = await import('better-auth/oauth2')
  const auth = getAuth()
  if (!auth) {
    console.error('FAIL: auth non attivo con la configurazione di prova')
    process.exit(1)
  }
  handler = (request) => auth.handler(request)
  const ctx = await auth.$context
  // I tipi della libreria stringono il contesto alle nostre opzioni: per la decifratura basta il cast.
  const decrypt = (token: string) => decryptOAuthToken(token, ctx as unknown as Parameters<typeof decryptOAuthToken>[1])

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: EMAIL_PREFIX, mode: 'insensitive' } } })
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: IP_PREFIX } } })
  }

  /** Utente Google + account + sessione (cookie firmato come fa il browser). */
  async function mintGoogleUser(email: string, name: string, image: string) {
    const user = await ctx.internalAdapter.createUser({ email, name, emailVerified: true, image }, { method: 'oauth', oauth: { providerId: 'google' } })
    await ctx.internalAdapter.createAccount({ userId: user.id, providerId: 'google', accountId: `apple-flow-g-${user.id}` })
    const session = await ctx.internalAdapter.createSession(user.id)
    const signed = `${session.token}.${await makeSignature(session.token, ctx.secret)}`
    return { user, cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}` }
  }

  const appleRow = (sub: string) => prisma.account.findFirst({ where: { providerId: 'apple', accountId: sub } })
  const userByEmail = (email: string) => prisma.user.findMany({ where: { email: { equals: email, mode: 'insensitive' } } })

  await cleanup()
  try {
    // --- F1 ------------------------------------------------------------------
    const f1 = await startApple('/account', '/accedi?via=apple', nextIp())
    check('F1: sign-in/social con provider apple risponde 200 con un url', f1.status === 200 && f1.url.host === 'appleid.apple.com', `${f1.status} ${f1.url.href}`)
    check(
      'F1: client_id = Services ID, form_post, scope con name ed email, redirect_uri del callback',
      f1.url.searchParams.get('client_id') === WEB_ID &&
        f1.url.searchParams.get('response_mode') === 'form_post' &&
        /\bname\b/.test(f1.url.searchParams.get('scope') ?? '') &&
        /\bemail\b/.test(f1.url.searchParams.get('scope') ?? '') &&
        f1.url.searchParams.get('redirect_uri') === `${BASE}/api/auth/callback/apple`,
      f1.url.search,
    )
    const stateLine = f1.setCookies.find((line) => /\.state=/.test(line)) ?? ''
    check('F1: il cookie di stato e SameSite=Lax', /samesite=lax/i.test(stateLine), stateLine)

    // --- F2 / F3 -------------------------------------------------------------
    const mario: AppleGrant = { sub: 'apple-flow-sub-mario', email: 'apple-flow-mario-apple@fixture.invalid' }
    const userJson = JSON.stringify({ name: { firstName: 'Mario', lastName: 'Rossi' } })
    const code3 = `apple-code-${(seq += 1)}`
    appleCodes.set(code3, mario)
    const s3 = await startApple('/account', '/accedi?via=apple', nextIp())
    const noCookie = await applePost(code3, s3.state, userJson)
    const next = new URL(loc(noCookie), BASE)
    check(
      'F2: il POST di Apple senza cookie risponde 302 al callback same-site con code e state',
      noCookie.status === 302 && `${next.origin}${next.pathname}` === `${BASE}/api/auth/callback/apple` && next.searchParams.get('code') === code3 && next.searchParams.get('state') === s3.state,
      `${noCookie.status} ${loc(noCookie)}`,
    )
    const withCookie = await applePost(code3, s3.state, userJson, s3.stateCookie)
    check('F2: lo stesso POST con un Cookie risponde 302, non 403', withCookie.status === 302, String(withCookie.status))

    const f3 = await follow(loc(noCookie), s3.stateCookie)
    check('F3: il GET con il cookie di stato porta al callbackURL e apre la sessione', f3.status === 302 && new URL(loc(f3), BASE).pathname === '/account' && cookieFrom(f3.headers.getSetCookie(), 'session_token') !== '', `${f3.status} ${loc(f3)}`)
    const marioSession = cookieFrom(f3.headers.getSetCookie(), 'session_token')
    check('F3: lo stub ha accettato il client secret ES256', tokenCalls >= 1)
    const row3 = await appleRow(mario.sub)
    const user3 = row3 ? await prisma.user.findUnique({ where: { id: row3.userId } }) : null
    check('F3: utente "Mario Rossi", e-mail verificata, senza foto', user3?.name === 'Mario Rossi' && user3.emailVerified === true && user3.image === null, JSON.stringify(user3))
    const stored = row3?.refreshToken ?? ''
    check(
      'F3: riga apple con access e id token nulli e refresh token cifrato che si decifra',
      !!row3 && row3.accessToken === null && row3.idToken === null && stored !== '' && stored !== issued[0] && (await decrypt(stored)) === issued[0],
      JSON.stringify({ ...row3, refreshToken: stored ? '<cifrato>' : stored }),
    )
    check('F3: una sola riga apple, con account_id = sub', (await prisma.account.count({ where: { userId: row3?.userId, providerId: 'apple' } })) === 1)

    // --- F4 ------------------------------------------------------------------
    const f4 = await appleFlow(mario, { callbackURL: '/account' })
    const row4 = await appleRow(mario.sub)
    const user4 = row4 ? await prisma.user.findUnique({ where: { id: row4.userId } }) : null
    check('F4: l accesso successivo apre una sessione', new URL(f4.location, BASE).pathname === '/account' && f4.session !== '', f4.location)
    check('F4: stesso utente, nome ed e-mail intatti', row4?.userId === row3?.userId && user4?.name === 'Mario Rossi' && user4.email === mario.email, JSON.stringify(user4))
    check(
      'F4: ancora una riga apple, token sostituito',
      (await prisma.account.count({ where: { userId: row3?.userId, providerId: 'apple' } })) === 1 &&
        !!row4?.refreshToken &&
        (await decrypt(row4.refreshToken)) === issued[issued.length - 1] &&
        issued.length === 2,
    )

    // --- F5 ------------------------------------------------------------------
    const relay = await appleFlow({ sub: 'apple-flow-sub-relay', email: `${EMAIL_PREFIX}x1@PrivateRelay.AppleID.com` })
    const relayRow = await appleRow('apple-flow-sub-relay')
    const relayUser = relayRow ? await prisma.user.findUnique({ where: { id: relayRow.userId } }) : null
    check('F5: relay senza nome -> "Utente Fuorirotta"', relay.session !== '' && relayUser?.name === 'Utente Fuorirotta', JSON.stringify(relayUser))
    await appleFlow({ sub: 'apple-flow-sub-anna', email: `${EMAIL_PREFIX}anna@fixture.invalid` })
    const annaRow = await appleRow('apple-flow-sub-anna')
    const annaUser = annaRow ? await prisma.user.findUnique({ where: { id: annaRow.userId } }) : null
    check('F5: e-mail normale senza nome -> parte locale', annaUser?.name === 'apple-flow-anna', JSON.stringify(annaUser))

    // --- F6 / F6b ------------------------------------------------------------
    const image = 'https://lh3.googleusercontent.com/a/apple-flow-photo'
    await mintGoogleUser(`${EMAIL_PREFIX}mario@fixture.invalid`, 'Mario Google', image)
    const f6 = await appleFlow(
      { sub: 'apple-flow-sub-collision', email: 'Apple-Flow-Mario@Fixture.invalid' },
      { callbackURL: '/', errorCallbackURL: '/accedi?via=apple' },
    )
    check(
      'F6: e-mail gia di un account Google (anche con maiuscole) -> /accedi?via=apple&error=account_not_linked',
      f6.location.includes('/accedi') && f6.location.includes('via=apple') && f6.location.includes('error=account_not_linked') && f6.session === '',
      f6.location,
    )
    check(
      'F6: nessun utente nuovo e nessuna riga apple per quel sub',
      (await userByEmail(`${EMAIL_PREFIX}mario@fixture.invalid`)).length === 1 && (await appleRow('apple-flow-sub-collision')) === null,
    )

    const luca: AppleGrant = { sub: 'apple-flow-sub-luca', email: `${EMAIL_PREFIX}luca@fixture.invalid` }
    await appleFlow(luca)
    const f6b = await googleFlow(
      { sub: 'apple-flow-google-luca', email: luca.email, name: 'Luca Google', picture: image },
      '/',
      '/?via=google',
    )
    const lucaUserId = (await appleRow(luca.sub))?.userId
    check('F6b: Google su un account creato da Apple -> error=account_not_linked', f6b.location.includes('error=account_not_linked'), f6b.location)
    check('F6b: nessuna riga google creata per quell utente', (await prisma.account.count({ where: { userId: lucaUserId, providerId: 'google' } })) === 0)

    // --- F7 ------------------------------------------------------------------
    const gina = await mintGoogleUser(`${EMAIL_PREFIX}g@fixture.invalid`, 'Gina Prova', image)
    const before = await prisma.user.findUniqueOrThrow({ where: { id: gina.user.id } })
    const ginaApple: AppleGrant = { sub: 'apple-flow-sub-gina', email: `${EMAIL_PREFIX}gina@privaterelay.appleid.com` }
    const f7 = await appleFlow(ginaApple, {
      callbackURL: '/account?linked=apple',
      errorCallbackURL: '/account?link=apple',
      sessionCookie: gina.cookie,
      link: true,
    })
    check('F7: link-social risponde con un url di Apple', f7.started.status === 200 && f7.started.url.host === 'appleid.apple.com', String(f7.started.status))
    check('F7: il collegamento con un relay diverso porta a /account?linked=apple', f7.location.endsWith('/account?linked=apple'), f7.location)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: gina.user.id } })
    const providers = (await prisma.account.findMany({ where: { userId: gina.user.id } })).map((a) => a.providerId).sort()
    check('F7: l utente ha una riga google e una apple', providers.join(',') === 'apple,google', providers.join(','))
    check('F7: e-mail, nome e foto identici a prima', after.email === before.email && after.name === before.name && after.image === before.image && after.image === image)

    // --- F8 ------------------------------------------------------------------
    const other = await mintGoogleUser(`${EMAIL_PREFIX}h@fixture.invalid`, 'Altro Utente', image)
    const f8 = await appleFlow(ginaApple, {
      callbackURL: '/account?linked=apple',
      errorCallbackURL: '/account?link=apple',
      sessionCookie: other.cookie,
      link: true,
    })
    check(
      'F8: lo stesso account Apple su un altro utente -> account_already_linked_to_different_user',
      f8.location.includes('/account?link=apple') && f8.location.includes('error=account_already_linked_to_different_user'),
      f8.location,
    )
    check('F8: la riga apple resta di Gina', (await appleRow(ginaApple.sub))?.userId === gina.user.id)

    // --- F9 ------------------------------------------------------------------
    const f9 = await handler(
      new Request(`${BASE}/api/auth/unlink-account`, {
        method: 'POST',
        headers: { origin: BASE, 'content-type': 'application/json', 'x-real-ip': nextIp(), cookie: marioSession },
        body: JSON.stringify({ providerId: 'apple', accountId: mario.sub }),
      }),
    )
    const f9body = (await f9.json().catch(() => ({}))) as { code?: string }
    check('F9: scollegare l unico provider -> 400 FAILED_TO_UNLINK_LAST_ACCOUNT', f9.status === 400 && f9body.code === 'FAILED_TO_UNLINK_LAST_ACCOUNT', `${f9.status} ${JSON.stringify(f9body)}`)
    check('F9: la riga apple e ancora li', (await appleRow(mario.sub)) !== null)
  } finally {
    await cleanup()
    await prisma.$disconnect()
    globalThis.fetch = realFetch
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
