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
//   R1  scollegare Apple chiama /auth/revoke una volta con il token in chiaro e toglie la riga
//   R2  eliminare un account con Apple: una revoca, zero righe in auth_user e in ogni tabella del registro
//   R3  eliminare un account solo Google: nessuna revoca, zero righe
//   R4  Apple giu' (500 a ogni client id, poi errore di rete): l'eliminazione riesce, il log non ha token
//   R5  interruttore spento ma chiavi presenti: la revoca c'e' e prova prima il Services ID, poi il bundle ID
//   E1  exchangeAppleCode con il bundle ID (la strada della Fase 27)
//   N1  account-deleted (events come stringa JSON): utente e registro a zero
//   N1b account-delete (l'ortografia di D-15): idem
//   N1c account-delete e account-deleted per Google+Apple: si scollega soltanto, utente, Google e dati restano
//   N2  consent-revoked con Google: via la riga Apple e le sessioni, utente e Google restano
//   N3  consent-revoked per chi ha solo Apple: via l'utente
//   N4  idempotenza: replay, sub ignoto, email-disabled, tipo ignoto
//   N5  account-deleted per un utente gia' eliminato con delete-user
//   N6  rifiuti (altra chiave, aud, iss, corpo, 413, 404 senza configurazione Apple) senza toccare le righe; payload= in forma di form
//   N7  interruttore spento ma Apple configurato: la notifica si applica comunque
//   V1  id token nativo (bundle ID) sullo stesso utente del web; un'altra audience e' rifiutata
//
// Gli helper (startApple, applePost, follow, cookieFrom, mintGoogleUser e il
// registro dello stub) sono funzioni con nome: il piano 03 aggiunge qui le sue
// rotte (revoca e notifiche). Tutte le e-mail di prova iniziano con "apple-flow-".
import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

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
type RevokeCall = { clientId: string | null; token: string | null; hint: string | null }
type RevokeMode = 'ok' | 'refuse' | 'error' | 'throw'
const revokeCalls: RevokeCall[] = [] // chiamate a /auth/revoke, in ordine
let revokeMode: (clientId: string | null) => RevokeMode = () => 'ok'
let appleKeys: object = { keys: [] } // risposta di GET /auth/keys (le chiavi pubbliche di prova)
const tokenForms: URLSearchParams[] = [] // corpo di ogni chiamata a /auth/token
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
    tokenForms.push(form)
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
  if (method === 'GET' && url === `${APPLE_ORIGIN}/auth/keys`) return json(appleKeys)
  if (method === 'POST' && url === `${APPLE_ORIGIN}/auth/revoke`) {
    revokeCalls.push({ clientId: form.get('client_id'), token: form.get('token'), hint: form.get('token_type_hint') })
    checkClientSecret(form.get('client_secret'), form.get('client_id'))
    const mode = revokeMode(form.get('client_id'))
    if (mode === 'throw') throw new TypeError('stub: rete assente')
    if (mode === 'refuse') return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 })
    if (mode === 'error') return new Response('stub: errore', { status: 500 })
    return new Response(null, { status: 200 })
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

  const { USER_DATA_REGISTRY } = await import('../lib/userData/registry')
  const { exchangeAppleCode } = await import('../lib/appleAuth')

  /** POST JSON a una rotta di Better Auth con sessione e Origin, come il browser. */
  const postJson = (path: string, body: object, cookie: string) =>
    handler(
      new Request(`${BASE}${path}`, {
        method: 'POST',
        headers: { origin: BASE, 'content-type': 'application/json', 'x-real-ip': nextIp(), cookie },
        body: JSON.stringify(body),
      }),
    )

  /** Righe che restano per un utente: auth_user piu' ogni tabella del registro (i nomi vengono dal registro, non dall'esterno). */
  async function rowsLeft(userId: string): Promise<number> {
    const counts = await Promise.all([
      prisma.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM auth_user WHERE id = $1', userId),
      ...USER_DATA_REGISTRY.map((entry) =>
        prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${entry.table} WHERE user_id = $1`, userId),
      ),
    ])
    return counts.reduce((sum, rows) => sum + rows[0].n, 0)
  }

  /** Una riga in saved_events: cosi' "zero righe" dopo l'eliminazione dice qualcosa anche per il registro. */
  const seedSaved = (userId: string) =>
    prisma.$executeRawUnsafe(
      "INSERT INTO saved_events (user_id, title, date_start, canonical_category, source, source_id) VALUES ($1, 'apple-flow', now(), 'Altro', 'apple-flow', $2)",
      userId,
      `apple-flow-${userId}`,
    )

  /** Utente nato con Apple, con sessione e un evento salvato; restituisce anche il refresh token in chiaro. */
  async function mintAppleUser(tag: string) {
    const grant: AppleGrant = { sub: `apple-flow-sub-${tag}`, email: `${EMAIL_PREFIX}${tag}@fixture.invalid` }
    const flow = await appleFlow(grant)
    const row = await appleRow(grant.sub)
    if (!row || flow.session === '') {
      console.error(`FAIL: ${tag}: utente Apple non creato`)
      process.exit(1)
    }
    await seedSaved(row.userId)
    return { grant, userId: row.userId, cookie: flow.session, refreshToken: issued[issued.length - 1] }
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

    // --- R1: scollegare Apple da chi ha anche Google -----------------------------
    const rGoogle = await mintGoogleUser(`${EMAIL_PREFIX}r1@fixture.invalid`, 'Erre Uno', image)
    const r1Grant: AppleGrant = { sub: 'apple-flow-sub-r1', email: `${EMAIL_PREFIX}r1@privaterelay.appleid.com` }
    await appleFlow(r1Grant, { callbackURL: '/account?linked=apple', errorCallbackURL: '/account?link=apple', sessionCookie: rGoogle.cookie, link: true })
    const r1Token = issued[issued.length - 1]
    revokeCalls.length = 0
    // unlink-account vuole l'id della RIGA di auth_account (non il sub di Apple).
    const r1Row = await appleRow(r1Grant.sub)
    const r1 = await postJson('/api/auth/unlink-account', { providerId: 'apple', accountId: r1Row?.id ?? 'assente' }, rGoogle.cookie)
    check('R1: unlink-account di Apple risponde 200', r1.status === 200, `${r1.status} ${await r1.clone().text()}`)
    check(
      'R1: una sola revoca, con il Services ID, il refresh token in chiaro e token_type_hint',
      revokeCalls.length === 1 && revokeCalls[0].clientId === WEB_ID && revokeCalls[0].token === r1Token && revokeCalls[0].hint === 'refresh_token',
      JSON.stringify(revokeCalls),
    )
    check(
      'R1: la riga apple e sparita, quella google e l utente restano',
      (await appleRow(r1Grant.sub)) === null &&
        (await prisma.account.count({ where: { userId: rGoogle.user.id, providerId: 'google' } })) === 1 &&
        (await prisma.user.count({ where: { id: rGoogle.user.id } })) === 1,
    )

    // --- R2: eliminare un account con Apple ---------------------------------------
    const r2 = await mintAppleUser('r2')
    revokeCalls.length = 0
    check('R2: prima dell eliminazione ci sono righe (utente, sessione, account, evento salvato)', (await rowsLeft(r2.userId)) >= 4)
    const r2Delete = await postJson('/api/auth/delete-user', {}, r2.cookie)
    check('R2: delete-user risponde 200', r2Delete.status === 200, String(r2Delete.status))
    check('R2: una sola revoca, con il token di quell utente', revokeCalls.length === 1 && revokeCalls[0].token === r2.refreshToken && revokeCalls[0].clientId === WEB_ID, JSON.stringify(revokeCalls))
    check('R2: zero righe in auth_user e in ogni tabella del registro', (await rowsLeft(r2.userId)) === 0)

    // --- R3: eliminare un account solo Google --------------------------------------
    const r3 = await mintGoogleUser(`${EMAIL_PREFIX}r3@fixture.invalid`, 'Erre Tre', image)
    await seedSaved(r3.user.id)
    revokeCalls.length = 0
    const r3Delete = await postJson('/api/auth/delete-user', {}, r3.cookie)
    check('R3: delete-user risponde 200 senza chiamare Apple', r3Delete.status === 200 && revokeCalls.length === 0, `${r3Delete.status} ${JSON.stringify(revokeCalls)}`)
    check('R3: zero righe in auth_user e in ogni tabella del registro', (await rowsLeft(r3.user.id)) === 0)

    // --- R4: Apple giu' ---------------------------------------------------------------
    const realError = console.error
    const logged: string[] = []
    console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '))
    const r4a = await mintAppleUser('r4a')
    const r4b = await mintAppleUser('r4b')
    revokeCalls.length = 0
    const r4Status: number[] = []
    try {
      revokeMode = () => 'error'
      r4Status.push((await postJson('/api/auth/delete-user', {}, r4a.cookie)).status)
      const errorCalls = revokeCalls.length
      revokeMode = () => 'throw'
      r4Status.push((await postJson('/api/auth/delete-user', {}, r4b.cookie)).status)
      check('R4: con Apple che risponde 500 ogni client id viene provato', errorCalls === 2, String(errorCalls))
    } finally {
      revokeMode = () => 'ok'
      console.error = realError
    }
    check('R4: entrambe le eliminazioni rispondono 200', r4Status.join(',') === '200,200', r4Status.join(','))
    check('R4: zero righe per entrambi gli utenti', (await rowsLeft(r4a.userId)) === 0 && (await rowsLeft(r4b.userId)) === 0)
    const authLines = logged.filter((line) => line.includes('[Auth]'))
    check(
      'R4: il log ha righe [Auth] e nessuna contiene il refresh token o un JWT',
      authLines.length >= 2 && !logged.some((line) => line.includes(r4a.refreshToken) || line.includes(r4b.refreshToken) || line.includes('eyJ')),
      logged.join(' | '),
    )

    // --- R5: interruttore spento, chiavi presenti, try-all ------------------------------
    const r5 = await mintAppleUser('r5')
    revokeCalls.length = 0
    process.env.APPLE_AUTH_ENABLED = 'false'
    revokeMode = (clientId) => (clientId === WEB_ID ? 'refuse' : 'ok')
    let r5Status = 0
    try {
      r5Status = (await postJson('/api/auth/delete-user', {}, r5.cookie)).status
    } finally {
      process.env.APPLE_AUTH_ENABLED = 'true'
      revokeMode = () => 'ok'
    }
    check('R5: con l interruttore spento la revoca c e: Services ID rifiutato, poi bundle ID', r5Status === 200 && revokeCalls.map((call) => call.clientId).join(',') === `${WEB_ID},${BUNDLE_ID}`, `${r5Status} ${JSON.stringify(revokeCalls)}`)
    check('R5: zero righe', (await rowsLeft(r5.userId)) === 0)

    // --- E1: scambio del codice con il bundle ID (Fase 27) --------------------------------
    appleCodes.set('native-code', { sub: 'apple-flow-sub-native', email: `${EMAIL_PREFIX}native@fixture.invalid` })
    tokenForms.length = 0
    const exchanged = await exchangeAppleCode('native-code', BUNDLE_ID)
    const sent = tokenForms[0]
    check(
      'E1: exchangeAppleCode manda grant_type, code e client_id = bundle ID con un client secret valido, e restituisce il refresh token',
      tokenForms.length === 1 &&
        sent.get('grant_type') === 'authorization_code' &&
        sent.get('code') === 'native-code' &&
        sent.get('client_id') === BUNDLE_ID &&
        exchanged.refreshToken === issued[issued.length - 1] &&
        exchanged.idToken !== null,
      JSON.stringify(exchanged),
    )

    // --- Notifiche S2S e id token nativo ------------------------------------------------
    const KID = 'test-kid'
    const rsa = await generateKeyPair('RS256')
    const otherRsa = await generateKeyPair('RS256')
    appleKeys = { keys: [{ ...(await exportJWK(rsa.publicKey)), kid: KID, alg: 'RS256', use: 'sig' }] }
    const { POST: notificationsPost } = await import('../app/api/apple/notifications/route')

    type Claims = { iss?: string; aud?: string; key?: typeof rsa.privateKey; asObject?: boolean }
    /** JWS di Apple di prova: events e' una stringa JSON (come manda Apple) o, con asObject, un oggetto. */
    async function signNotification(type: string, sub: string, claims: Claims = {}): Promise<string> {
      const event = { type, sub, event_time: Date.now() }
      return new SignJWT({ events: claims.asObject ? event : JSON.stringify(event) })
        .setProtectedHeader({ alg: 'RS256', kid: KID })
        .setIssuer(claims.iss ?? APPLE_ORIGIN)
        .setAudience(claims.aud ?? WEB_ID)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(claims.key ?? rsa.privateKey)
    }
    const notify = (body: string, contentType = 'application/json') =>
      notificationsPost(new Request(`${BASE}/api/apple/notifications`, { method: 'POST', headers: { 'content-type': contentType, 'x-real-ip': nextIp() }, body }))
    const notifyJws = (jws: string) => notify(JSON.stringify({ payload: jws }))

    // N1
    const n1 = await mintAppleUser('n1')
    check('N1: prima della notifica ci sono righe', (await rowsLeft(n1.userId)) >= 4)
    const n1Jws = await signNotification('account-deleted', n1.grant.sub)
    const n1Reply = await notifyJws(n1Jws)
    check('N1: account-deleted risponde 200, no-store, e lascia zero righe in auth_user e nel registro', n1Reply.status === 200 && n1Reply.headers.get('cache-control') === 'private, no-store' && (await rowsLeft(n1.userId)) === 0, String(n1Reply.status))

    // N1b
    const n1b = await mintAppleUser('n1b')
    const n1bReply = await notifyJws(await signNotification('account-delete', n1b.grant.sub))
    check('N1b: account-delete (D-15) risponde 200 e lascia zero righe', n1bReply.status === 200 && (await rowsLeft(n1b.userId)) === 0, String(n1bReply.status))

    // N2
    const n2Google = await mintGoogleUser(`${EMAIL_PREFIX}n2@fixture.invalid`, 'Enne Due', image)
    const n2Grant: AppleGrant = { sub: 'apple-flow-sub-n2', email: `${EMAIL_PREFIX}n2@privaterelay.appleid.com` }
    await appleFlow(n2Grant, { callbackURL: '/account?linked=apple', errorCallbackURL: '/account?link=apple', sessionCookie: n2Google.cookie, link: true })
    await ctx.internalAdapter.createSession(n2Google.user.id)
    const n2Sessions = await prisma.session.count({ where: { userId: n2Google.user.id } })
    const n2Reply = await notifyJws(await signNotification('consent-revoked', n2Grant.sub, { asObject: true }))
    check(
      'N2: consent-revoked (events come oggetto) per Google+Apple: via la riga Apple e tutte le sessioni, restano utente e Google',
      n2Reply.status === 200 &&
        n2Sessions >= 2 &&
        (await appleRow(n2Grant.sub)) === null &&
        (await prisma.session.count({ where: { userId: n2Google.user.id } })) === 0 &&
        (await prisma.account.count({ where: { userId: n2Google.user.id, providerId: 'google' } })) === 1 &&
        (await prisma.user.count({ where: { id: n2Google.user.id } })) === 1,
      String(n2Reply.status),
    )

    // N3
    const n3 = await mintAppleUser('n3')
    const n3Reply = await notifyJws(await signNotification('consent-revoked', n3.grant.sub))
    check('N3: consent-revoked per chi ha solo Apple elimina l account', n3Reply.status === 200 && (await rowsLeft(n3.userId)) === 0, String(n3Reply.status))

    // N1c: eliminare l'ID Apple con Google collegato scollega soltanto (/privacy, "se era l'unico modo per entrare")
    const { applyAppleEvent } = await import('../lib/appleAuth')
    for (const type of ['account-delete', 'account-deleted']) {
      const google = await mintGoogleUser(`${EMAIL_PREFIX}n1c-${type}@fixture.invalid`, 'Enne Uno Ci', image)
      const grant: AppleGrant = { sub: `apple-flow-sub-n1c-${type}`, email: `${EMAIL_PREFIX}n1c-${type}@privaterelay.appleid.com` }
      await appleFlow(grant, { callbackURL: '/account?linked=apple', errorCallbackURL: '/account?link=apple', sessionCookie: google.cookie, link: true })
      await seedSaved(google.user.id)
      const linked = (await appleRow(grant.sub)) !== null
      const outcome = await applyAppleEvent({ type, sub: grant.sub })
      check(
        `N1c: ${type} per Google+Apple scollega soltanto: via la riga Apple e le sessioni, restano utente, Google e dati`,
        linked &&
          outcome === 'unlinked' &&
          (await appleRow(grant.sub)) === null &&
          (await prisma.session.count({ where: { userId: google.user.id } })) === 0 &&
          (await prisma.account.count({ where: { userId: google.user.id, providerId: 'google' } })) === 1 &&
          (await prisma.user.count({ where: { id: google.user.id } })) === 1 &&
          (await prisma.savedEvent.count({ where: { userId: google.user.id } })) === 1,
        outcome,
      )
    }

    // N4
    const n4 = await mintAppleUser('n4')
    const n4Before = await rowsLeft(n4.userId)
    const replay = await notifyJws(n1Jws)
    const unknown = await notifyJws(await signNotification('account-deleted', 'apple-flow-sub-sconosciuto'))
    const disabled = await notifyJws(await signNotification('email-disabled', n4.grant.sub))
    const enabled = await notifyJws(await signNotification('email-enabled', n4.grant.sub))
    const odd = await notifyJws(await signNotification('something-else', n4.grant.sub))
    check(
      'N4: replay, sub ignoto, email-disabled/enabled e tipo ignoto rispondono 200 e non cambiano nulla',
      [replay, unknown, disabled, enabled, odd].every((r) => r.status === 200) && (await rowsLeft(n4.userId)) === n4Before && (await rowsLeft(n1.userId)) === 0,
      [replay, unknown, disabled, enabled, odd].map((r) => r.status).join(','),
    )

    // N5
    const n5 = await mintAppleUser('n5')
    const n5Delete = await postJson('/api/auth/delete-user', {}, n5.cookie)
    const n5Reply = await notifyJws(await signNotification('account-deleted', n5.grant.sub))
    check('N5: account-deleted per un utente gia eliminato con delete-user risponde 200', n5Delete.status === 200 && n5Reply.status === 200 && (await rowsLeft(n5.userId)) === 0, `${n5Delete.status} ${n5Reply.status}`)

    // N6: ogni rifiuto lascia intatte le righe della vittima
    const n6 = await mintAppleUser('n6')
    const n6Before = await rowsLeft(n6.userId)
    const realN6Error = console.error
    const n6Logged: string[] = []
    console.error = (...args: unknown[]) => void n6Logged.push(args.map(String).join(' '))
    const refusals: Record<string, number> = {}
    try {
      refusals.chiave = (await notifyJws(await signNotification('account-deleted', n6.grant.sub, { key: otherRsa.privateKey }))).status
      refusals.aud = (await notifyJws(await signNotification('account-deleted', n6.grant.sub, { aud: 'other.client' }))).status
      refusals.iss = (await notifyJws(await signNotification('account-deleted', n6.grant.sub, { iss: 'https://evil.example' }))).status
      refusals.json = (await notify('not json')).status
      refusals.grande = (await notify('x'.repeat(20000))).status
      const valid = await signNotification('account-deleted', n6.grant.sub)
      const keyId = process.env.APPLE_KEY_ID
      delete process.env.APPLE_KEY_ID
      try {
        refusals.nonConfigurato = (await notifyJws(valid)).status
      } finally {
        process.env.APPLE_KEY_ID = keyId
      }
    } finally {
      console.error = realN6Error
    }
    check(
      'N6: altra chiave, aud, iss -> 401; corpo non valido -> 400; 20000 byte -> 413; Apple non configurato -> 404',
      refusals.chiave === 401 && refusals.aud === 401 && refusals.iss === 401 && refusals.json === 400 && refusals.grande === 413 && refusals.nonConfigurato === 404,
      JSON.stringify(refusals),
    )
    check('N6: nessun rifiuto ha toccato le righe, e il log non ha JWT', (await rowsLeft(n6.userId)) === n6Before && !n6Logged.some((line) => line.includes('eyJ')), n6Logged.join(' | '))
    const formReply = await notify(new URLSearchParams({ payload: await signNotification('account-deleted', n6.grant.sub) }).toString(), 'application/x-www-form-urlencoded')
    check('N6: payload= in forma di form viene accettato e applicato', formReply.status === 200 && (await rowsLeft(n6.userId)) === 0, String(formReply.status))

    // N7: a interruttore spento, con le chiavi presenti, la notifica si applica lo stesso (come la revoca)
    const n7 = await mintAppleUser('n7')
    process.env.APPLE_AUTH_ENABLED = 'false'
    let n7Status = 0
    try {
      n7Status = (await notifyJws(await signNotification('account-deleted', n7.grant.sub))).status
    } finally {
      process.env.APPLE_AUTH_ENABLED = 'true'
    }
    check('N7: interruttore spento ma Apple configurato: account-deleted risponde 200 e lascia zero righe', n7Status === 200 && (await rowsLeft(n7.userId)) === 0, String(n7Status))

    // V1: id token nativo (bundle ID) sullo stesso utente del web
    const v1 = await mintAppleUser('v1')
    async function nativeSignIn(aud: string): Promise<Response> {
      const idToken = await new SignJWT({ email: v1.grant.email, email_verified: 'true', nonce: 'n1' })
        .setProtectedHeader({ alg: 'RS256', kid: KID })
        .setIssuer(APPLE_ORIGIN)
        .setAudience(aud)
        .setSubject(v1.grant.sub)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
        .sign(rsa.privateKey)
      return handler(
        new Request(`${BASE}/api/auth/sign-in/social`, {
          method: 'POST',
          headers: { origin: BASE, 'content-type': 'application/json', 'x-real-ip': nextIp() },
          body: JSON.stringify({ provider: 'apple', idToken: { token: idToken, nonce: 'n1' } }),
        }),
      )
    }
    const nativeOk = await nativeSignIn(BUNDLE_ID)
    const nativeBody = (await nativeOk.json().catch(() => ({}))) as { user?: { id?: string } }
    check('V1: id token con aud = bundle ID e sub del web apre una sessione dello stesso utente', nativeOk.status === 200 && nativeBody.user?.id === v1.userId, `${nativeOk.status} ${JSON.stringify(nativeBody)}`)
    const sessionsBefore = await prisma.session.count({ where: { userId: v1.userId } })
    const nativeBad = await nativeSignIn('other.client')
    check('V1: la stessa identita con un altra audience e rifiutata e non crea sessioni', nativeBad.status !== 200 && (await prisma.session.count({ where: { userId: v1.userId } })) === sessionsBefore, String(nativeBad.status))
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
