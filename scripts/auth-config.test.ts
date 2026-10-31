// Contratto di configurazione dell'accesso (check:auth-config, test:ci).
//
// Better Auth ha dei default pericolosi per questo progetto (freshAge di un
// giorno, nome non validato, token bearer "nudi", token di Google salvati,
// regola di sign-in propria). Li abbiamo cambiati uno per uno in lib/auth.ts;
// qui li fissiamo, cosi' un aggiornamento della libreria o una modifica
// distratta non li disfa in silenzio. Nessun database: `$context` si risolve
// offline (21-RESEARCH ipotesi A6) e gli hook sono funzioni pure.
//
// Esce con 1 al primo controllo fallito. Stampa "ok  <caso>" per ognuno.
import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')

// Variabili PRIMA dell'import dinamico di lib/auth. Il segreto e' di 40
// caratteri non banali: uno ripetitivo farebbe scrivere alla libreria un
// avviso di bassa entropia.
const SECRET = 'q8Vn2LzTfX0cRk5aYw9JdHs3UeBm7PoG1iNtZ4Ab'
Object.assign(process.env, {
  AUTH_ENABLED: 'true',
  BETTER_AUTH_URL: 'https://fuori-rotta.it',
  BETTER_AUTH_SECRET: SECRET,
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  DATABASE_URL: 'postgresql://fuorirotta:fuorirotta@localhost:5433/fuorirotta_dev',
  // Apple (Fase 25): stessi identificativi di prova di apple-flow, chiave P-256 generata qui.
  APPLE_AUTH_ENABLED: 'true',
  APPLE_CLIENT_ID: 'it.fuorirotta.web.test',
  APPLE_APP_BUNDLE_ID: 'it.fuorirotta.app.test',
  APPLE_TEAM_ID: 'TEAMID1234',
  APPLE_KEY_ID: 'KEYID12345',
  APPLE_PRIVATE_KEY_B64: Buffer.from(
    generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  ).toString('base64'),
})

function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) {
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`)
    process.exit(1)
  }
  console.log(`ok  ${name}`)
}

type HookResult = { data: Record<string, unknown> } | void | undefined
type Hook = (data: Record<string, unknown>) => Promise<HookResult> | HookResult

// Le opzioni risolte, viste in modo largo: i tipi della libreria le stringono
// a cio' che abbiamo scritto e non lasciano chiedere "e' assente?".
type ResolvedOptions = {
  session?: { cookieCache?: { enabled?: boolean } }
  account?: {
    accountLinking?: { enabled?: boolean; disableImplicitLinking?: boolean; allowDifferentEmails?: boolean; trustedProviders?: unknown }
    encryptOAuthTokens?: boolean
  }
  trustedOrigins?: string[]
  advanced?: { ipAddress?: { ipAddressHeaders?: string[] } }
  plugins?: { id: string; options?: { requireSignature?: boolean } }[]
  telemetry?: { enabled?: boolean }
  socialProviders?: {
    google?: { includeGrantedScopes?: boolean; overrideUserInfoOnSignIn?: boolean; mapProfileToUser?: unknown }
    apple?: {
      clientId?: string | string[]
      audience?: string[]
      appBundleIdentifier?: string
      overrideUserInfoOnSignIn?: boolean
      clientSecret?: string
    }
  }
  user?: { deleteUser?: { enabled?: boolean; sendDeleteAccountVerification?: unknown } }
  databaseHooks: {
    user: { create: { before: Hook }; update: { before: Hook } }
    account: { create: { before: Hook }; update: { before: Hook }; delete: { before: Hook } }
  }
}

async function main(): Promise<void> {
  const { authEnabled, appleEnabled, getAuth } = await import('../lib/auth')
  const display = await import('../lib/displayName')

  // --- Nome visualizzato: punti di codice, dopo NFC e trim (D-09) -------------
  check('displayName: trim', display.normalizeDisplayName('  Anna  ') === 'Anna')
  check('displayName: vuoto e spazi non validi', !display.isValidDisplayName('') && !display.isValidDisplayName('   '))
  check('displayName: un valore non stringa non e valido', !display.isValidDisplayName(42) && !display.isValidDisplayName(null) && !display.isValidDisplayName(undefined))
  check('displayName: 50 emoji valide, 51 punti di codice no', display.isValidDisplayName('😀'.repeat(50)) && !display.isValidDisplayName('a'.repeat(51)))
  check('displayName: NUL, controllo e override bidi non validi', !display.isValidDisplayName('a\u0000b') && !display.isValidDisplayName('a\u0007') && !display.isValidDisplayName('a\u202Eb') && display.isValidDisplayName('\u{1F468}\u200D\u{1F469}'))
  check('displayName: dal provider i caratteri vietati si tolgono', display.displayNameFromProvider('Ma\u0000rio\u202E', 'a@b.it') === 'Mario')
  check('displayName: e + U+0301 diventa un solo punto di codice', Array.from(display.normalizeDisplayName('é')).length === 1)
  const long = display.displayNameFromProvider('x'.repeat(120), 'a@b.it')
  check('displayName: un nome da 120 caratteri viene tagliato a 50 punti di codice', Array.from(long).length === 50, `lunghezza ${Array.from(long).length}`)
  const straddle = display.displayNameFromProvider(`${'a'.repeat(49)}😀${'b'.repeat(70)}`, 'a@b.it')
  check(
    'displayName: una coppia surrogata a cavallo del 50 non viene spezzata',
    Array.from(straddle).length === 50 && straddle.endsWith('😀') && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(straddle),
  )
  check('displayName: nome assente -> parte locale dell\'e-mail', display.displayNameFromProvider(undefined, 'mario.rossi@example.it') === 'mario.rossi')
  check('displayName: nome vuoto -> parte locale dell\'e-mail', display.displayNameFromProvider('   ', 'zoe@y.it') === 'zoe')
  check('displayName: relay di Apple senza nome -> "Utente Fuorirotta"', display.displayNameFromProvider('', 'abc123@privaterelay.appleid.com') === 'Utente Fuorirotta')
  check('displayName: il relay si riconosce senza badare a maiuscole e spazi', display.displayNameFromProvider(undefined, ' x@PrivateRelay.AppleID.com ') === 'Utente Fuorirotta')
  check('displayName: relay con nome "Anna" -> Anna', display.displayNameFromProvider('Anna', 'x@privaterelay.appleid.com') === 'Anna')
  check(
    'isAppleRelayEmail: vero per il relay in maiuscole, falso per un dominio che lo contiene, per gmail, per un numero e per null',
    display.isAppleRelayEmail(' x@PrivateRelay.AppleID.com ') &&
      !display.isAppleRelayEmail('x@privaterelay.appleid.com.evil.it') &&
      !display.isAppleRelayEmail('x@gmail.com') &&
      !display.isAppleRelayEmail(42) &&
      !display.isAppleRelayEmail(null),
  )
  check('displayName: iniziale in maiuscolo del nome', display.displayInitial('éva', 'x@y.it') === 'É')
  check('displayName: iniziale dall\'e-mail se il nome e vuoto', display.displayInitial('', 'zoe@y.it') === 'Z')

  // --- authEnabled(): rifiuta la configurazione incompleta e non svela i valori -
  const logged: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  const saved = { ...process.env }
  try {
    check('authEnabled: attivo con la configurazione completa', authEnabled() === true)

    // Solo "true" accende, come APP_DEBUG: "1", "false" e vuoto sono spenti.
    for (const off of ['false', '1', '']) {
      process.env.AUTH_ENABLED = off
      check(`authEnabled: AUTH_ENABLED='${off}' -> spento e senza log`, authEnabled() === false && logged.length === 0)
    }
    process.env.AUTH_ENABLED = 'true'

    process.env.BETTER_AUTH_SECRET = SECRET.slice(0, 31)
    check('authEnabled: segreto da 31 caratteri -> spento', authEnabled() === false)
    check(
      'authEnabled: il log nomina BETTER_AUTH_SECRET e non il suo valore',
      logged.length === 1 && logged[0].includes('BETTER_AUTH_SECRET') && !logged[0].includes(SECRET.slice(0, 31)),
      logged.join(' | '),
    )
    authEnabled()
    check('authEnabled: lo stesso insieme di variabili mancanti si logga una volta sola', logged.length === 1)
    process.env.BETTER_AUTH_SECRET = SECRET

    process.env.GOOGLE_CLIENT_SECRET = ''
    check('authEnabled: GOOGLE_CLIENT_SECRET vuoto -> spento', authEnabled() === false)
    check(
      'authEnabled: un secondo insieme di mancanti si logga a parte, col nome',
      logged.length === 2 && logged[1].includes('GOOGLE_CLIENT_SECRET'),
      logged.join(' | '),
    )
    process.env.GOOGLE_CLIENT_SECRET = saved.GOOGLE_CLIENT_SECRET

    // BETTER_AUTH_URL: solo https, o http su localhost; il log non svela il valore.
    process.env.BETTER_AUTH_URL = 'fuori-rotta.it'
    check('authEnabled: BETTER_AUTH_URL senza schema -> spento', authEnabled() === false)
    check(
      'authEnabled: il log nomina BETTER_AUTH_URL e non il suo valore',
      logged.length === 3 && logged[2].includes('BETTER_AUTH_URL') && !logged[2].includes('fuori-rotta.it'),
      logged.join(' | '),
    )
    process.env.BETTER_AUTH_URL = 'http://fuori-rotta.it'
    check('authEnabled: BETTER_AUTH_URL http su un dominio vero -> spento', authEnabled() === false)
    process.env.BETTER_AUTH_URL = 'http://localhost:3000'
    check('authEnabled: BETTER_AUTH_URL http://localhost -> attivo', authEnabled() === true)
  } finally {
    console.error = originalError
    Object.assign(process.env, saved)
  }
  check('authEnabled: ripristinato, torna attivo', authEnabled() === true)

  // --- appleEnabled(): interruttore proprio, nomi nel log e mai i valori (D-04) --
  // Prima del primo getAuth(): l'istanza si costruisce una volta sola.
  const appleNames = Object.keys(process.env).filter((name) => name.startsWith('APPLE_'))
  const appleSaved = Object.fromEntries(appleNames.map((name) => [name, process.env[name]]))
  const appleLogged: string[] = []
  console.error = (...args: unknown[]) => { appleLogged.push(args.map(String).join(' ')) }
  try {
    check('appleEnabled: attivo con la configurazione completa', appleEnabled() === true && appleLogged.length === 0)
    process.env.APPLE_AUTH_ENABLED = 'false'
    check("appleEnabled: APPLE_AUTH_ENABLED='false' -> spento e senza log", appleEnabled() === false && appleLogged.length === 0)
    delete process.env.APPLE_AUTH_ENABLED
    check('appleEnabled: interruttore non impostato -> spento e senza log', appleEnabled() === false && appleLogged.length === 0)
    process.env.APPLE_AUTH_ENABLED = 'true'
    process.env.APPLE_KEY_ID = ''
    check('appleEnabled: APPLE_KEY_ID vuoto -> spento', appleEnabled() === false)
    const leaks = [appleSaved.APPLE_CLIENT_ID, appleSaved.APPLE_TEAM_ID, appleSaved.APPLE_KEY_ID, appleSaved.APPLE_PRIVATE_KEY_B64].filter((v): v is string => !!v)
    check(
      'appleEnabled: il log nomina APPLE_KEY_ID e nessun valore di prova',
      appleLogged.length === 1 && appleLogged[0].includes('APPLE_KEY_ID') && leaks.every((value) => !appleLogged[0].includes(value)),
      appleLogged.join(' | '),
    )
    appleEnabled()
    check('appleEnabled: lo stesso insieme di mancanti si logga una volta sola', appleLogged.length === 1)
    process.env.APPLE_KEY_ID = appleSaved.APPLE_KEY_ID
    process.env.APPLE_PRIVATE_KEY_B64 = Buffer.from('non e una chiave').toString('base64')
    check('appleEnabled: una chiave che non e EC P-256 -> spento', appleEnabled() === false)
    check(
      'appleEnabled: il log nomina APPLE_PRIVATE_KEY_B64',
      appleLogged.length === 2 && appleLogged[1].includes('APPLE_PRIVATE_KEY_B64') && !appleLogged[1].includes(String(process.env.APPLE_PRIVATE_KEY_B64)),
      appleLogged.join(' | '),
    )
    process.env.APPLE_PRIVATE_KEY_B64 = appleSaved.APPLE_PRIVATE_KEY_B64
    process.env.AUTH_ENABLED = 'false'
    check('appleEnabled: AUTH_ENABLED spento -> Apple spento', appleEnabled() === false)
  } finally {
    console.error = originalError
    for (const name of appleNames) {
      if (appleSaved[name] === undefined) delete process.env[name]
      else process.env[name] = appleSaved[name]
    }
    process.env.AUTH_ENABLED = 'true'
  }
  check('appleEnabled: ripristinato, torna attivo', appleEnabled() === true)

  // --- Il contesto risolto: i default pericolosi, cambiati e fissati --------
  const auth = getAuth()
  check('getAuth: istanza con la configurazione completa', auth !== null)
  const ctx = await auth!.$context
  const options = ctx.options as unknown as ResolvedOptions

  const session = ctx.authCookies.sessionToken
  check('cookie: nome __Secure-fuorirotta.session_token con baseURL https', session.name === '__Secure-fuorirotta.session_token', session.name)
  check(
    'cookie: secure, httpOnly, SameSite=Lax, path /, senza domain (host-only)',
    session.attributes.secure === true &&
      session.attributes.httpOnly === true &&
      String(session.attributes.sameSite).toLowerCase() === 'lax' &&
      session.attributes.path === '/' &&
      !('domain' in session.attributes && session.attributes.domain),
  )
  check('session: expiresIn 5184000 (60 giorni)', ctx.sessionConfig.expiresIn === 5184000)
  check('session: updateAge 86400 (rinnovo giornaliero)', ctx.sessionConfig.updateAge === 86400)
  check('session: freshAge 0 (elenco sessioni ed eliminazione dopo un giorno)', ctx.sessionConfig.freshAge === 0)
  check(
    'session: nessuna cookie cache (revoca immediata)',
    !options.session?.cookieCache?.enabled && ctx.sessionConfig.cookieCacheSigner === undefined && ctx.sessionConfig.cookieRefreshCache === false,
  )
  check('linking: trustedProviders vuoto', Array.isArray(ctx.trustedProviders) && ctx.trustedProviders.length === 0)
  check('linking: disableImplicitLinking true', options.account?.accountLinking?.disableImplicitLinking === true)
  check('linking: accountLinking attivo (serve al collegamento esplicito dal profilo)', options.account?.accountLinking?.enabled === true)
  check('linking: allowDifferentEmails (il relay di Apple ha un\'e-mail diversa), solo per il collegamento esplicito', options.account?.accountLinking?.allowDifferentEmails === true)
  check('token: encryptOAuthTokens attivo (il refresh token di Apple e cifrato a riposo)', options.account?.encryptOAuthTokens === true)
  check('linking: nessun trustedProviders nelle opzioni', options.account?.accountLinking?.trustedProviders === undefined)
  check('rate limit: attivo, storage database', ctx.rateLimit.enabled === true && ctx.rateLimit.storage === 'database')
  const rule = ctx.rateLimit.customRules?.['/sign-in/social']
  check('rate limit: regola /sign-in/social 5 ogni 60 s', typeof rule === 'object' && rule !== null && rule.window === 60 && rule.max === 5, JSON.stringify(rule))
  const headers = options.advanced?.ipAddress?.ipAddressHeaders
  check('ip: ipAddressHeaders esattamente ["x-real-ip"]', JSON.stringify(headers) === '["x-real-ip"]', JSON.stringify(headers))
  const plugins = options.plugins ?? []
  const bearerPlugin = plugins.find((p) => p.id === 'bearer')
  check('bearer: presente con requireSignature', bearerPlugin?.options?.requireSignature === true)
  check('plugin: nessun next-cookies', !plugins.some((p) => p.id === 'next-cookies'))
  check('telemetria spenta', options.telemetry?.enabled === false)
  check('google: includeGrantedScopes false', options.socialProviders?.google?.includeGrantedScopes === false)
  const apple = options.socialProviders?.apple
  check('apple: trustedOrigins contiene https://appleid.apple.com', (options.trustedOrigins ?? []).includes('https://appleid.apple.com') || ctx.trustedOrigins.includes('https://appleid.apple.com'))
  const primary = Array.isArray(apple?.clientId) ? apple.clientId[0] : apple?.clientId
  check('apple: clientId primario = Services ID', primary === 'it.fuorirotta.web.test', JSON.stringify(apple?.clientId))
  check(
    'apple: audience = [Services ID, bundle ID], senza appBundleIdentifier (che la sostituirebbe)',
    JSON.stringify(apple?.audience) === '["it.fuorirotta.web.test","it.fuorirotta.app.test"]' && apple?.appBundleIdentifier === undefined,
    JSON.stringify(apple?.audience),
  )
  check('apple: nessun overrideUserInfoOnSignIn (la foto di Google non si tocca)', apple?.overrideUserInfoOnSignIn !== true)
  const secretA = apple?.clientSecret ?? ''
  const secretB = apple?.clientSecret ?? ''
  const secretHeader = secretA.split('.').length === 3 ? (JSON.parse(Buffer.from(secretA.split('.')[0], 'base64url').toString('utf8')) as { alg?: string; kid?: string }) : {}
  check(
    'apple: clientSecret letto due volte e lo stesso JWT a tre parti, ES256 con il kid di prova',
    secretA !== '' && secretA === secretB && secretHeader.alg === 'ES256' && secretHeader.kid === 'KEYID12345',
    JSON.stringify(secretHeader),
  )
  check('eliminazione: deleteUser attivo senza callback di verifica', options.user?.deleteUser?.enabled === true && options.user.deleteUser.sendDeleteAccountVerification === undefined)
  // Rinfrescherebbero il token di Apple senza providerId (noTokens lo azzera) e
  // /refresh-token lo restituirebbe in chiaro. disabledPaths risponde prima del
  // rate limit: nessun database. Senza la chiusura rispondono 401 o 400.
  for (const [method, path] of [['POST', '/refresh-token'], ['POST', '/get-access-token'], ['GET', '/account-info'], ['POST', '/./refresh-token']] as const) {
    const res = await auth!.handler(
      new Request(`https://fuori-rotta.it/api/auth${path}`, {
        method,
        headers: { origin: 'https://fuori-rotta.it', 'content-type': 'application/json' },
        body: method === 'POST' ? '{"accountId":"x"}' : undefined,
      }),
    )
    check(`endpoint chiuso: ${method} /api/auth${path} -> 404`, res.status === 404, String(res.status))
  }

  // --- Hook del database: nome valido, nessun token, foto solo di Google -------------
  const hooks = options.databaseHooks
  const created = await hooks.user.create.before({ name: '  '.concat('y'.repeat(120)), email: 'n@b.it', image: 'https://lh3.googleusercontent.com/x' })
  check(
    'hook user.create: nome a 50 punti di codice e foto di Google tenuta',
    !!created && Array.from(String(created.data.name)).length === 50 && created.data.image === 'https://lh3.googleusercontent.com/x',
  )
  for (const bad of ['http://lh3.googleusercontent.com/x', 'https://example.com/x.png', 'https://evilgoogleusercontent.com/x', 'https://lh3.googleusercontent.com@example.com/x', 'nope', undefined]) {
    const out = await hooks.user.create.before({ name: 'Anna', email: 'n@b.it', image: bad })
    check(`hook user.create: foto ${String(bad)} -> null`, !!out && out.data.image === null)
  }
  check('google: overrideUserInfoOnSignIn attivo (foto aggiornata a ogni accesso, D-20)', options.socialProviders?.google?.overrideUserInfoOnSignIn === true)
  check('google: nessun mapProfileToUser che azzeri la foto', options.socialProviders?.google?.mapProfileToUser === undefined)
  const signIn = await hooks.user.update.before({ name: 'Nome Google', email: 'x@y.it', emailVerified: true, image: 'https://lh3.googleusercontent.com/new' })
  check(
    'hook user.update: la riscrittura dell\'accesso tiene solo la foto',
    !!signIn && JSON.stringify(signIn.data) === JSON.stringify({ image: 'https://lh3.googleusercontent.com/new' }),
    JSON.stringify(signIn),
  )
  const signInNoPhoto = await hooks.user.update.before({ name: 'Nome Google', email: 'x@y.it', emailVerified: true })
  check('hook user.update: accesso senza foto -> foto null', !!signInNoPhoto && JSON.stringify(signInNoPhoto.data) === '{"image":null}', JSON.stringify(signInNoPhoto))
  const foreign = await hooks.user.update.before({ image: 'https://example.com/x.png' })
  check('hook user.update: scrittura diretta di una foto estranea -> null', !!foreign && foreign.data.image === null)
  const emptyName = await hooks.user.create.before({ name: '', email: 'mario.rossi@example.it' })
  check('hook user.create: nome vuoto -> parte locale dell\'e-mail', !!emptyName && emptyName.data.name === 'mario.rossi')
  let rejected = ''
  try { await hooks.user.update.before({ name: '   ' }) } catch (error) { rejected = String((error as { message?: string }).message ?? error) }
  check('hook user.update: nome vuoto rifiutato con "Nome non valido"', rejected.includes('Nome non valido'), rejected)
  rejected = ''
  try { await hooks.user.update.before({ name: 'a'.repeat(51) }) } catch (error) { rejected = String((error as { message?: string }).message ?? error) }
  check('hook user.update: nome da 51 punti di codice rifiutato', rejected.includes('Nome non valido'), rejected)
  const updated = await hooks.user.update.before({ name: '  Anna  ' })
  check('hook user.update: scrive il nome normalizzato', !!updated && updated.data.name === 'Anna')
  const untouched = await hooks.user.update.before({ updatedAt: new Date() })
  check('hook user.update: senza nome lascia passare', untouched === undefined)
  for (const op of ['create', 'update'] as const) {
    const out = await hooks.account[op].before({ providerId: 'google', accessToken: 'a', refreshToken: 'r', idToken: 'i', scope: 'openid' })
    check(
      `hook account.${op}: access, refresh e id token azzerati`,
      !!out && out.data.accessToken === null && out.data.refreshToken === null && out.data.idToken === null && out.data.providerId === 'google',
    )
  }

  for (const op of ['create', 'update'] as const) {
    const apple = await hooks.account[op].before({ providerId: 'apple', accessToken: 'a', refreshToken: 'r', idToken: 'i' })
    check(
      `hook account.${op}: apple tiene il refresh token e perde access e id token`,
      !!apple && apple.data.refreshToken === 'r' && apple.data.accessToken === null && apple.data.idToken === null,
    )
    const bare = await hooks.account[op].before({ accessToken: 'a', refreshToken: 'r', idToken: 'i' })
    check(
      `hook account.${op}: senza providerId perde tutti e tre i token (fallisce chiuso)`,
      !!bare && bare.data.accessToken === null && bare.data.refreshToken === null && bare.data.idToken === null,
    )
  }

  // Una riga Apple senza token non si puo' revocare: lo si dice nel log, senza valori.
  const realError = console.error
  const deleteLogged: string[] = []
  console.error = (...args: unknown[]) => void deleteLogged.push(args.map(String).join(' '))
  try {
    await hooks.account.delete.before({ providerId: 'apple', accountId: 'apple-sub-segreto', refreshToken: null })
    await hooks.account.delete.before({ providerId: 'google', refreshToken: null })
  } finally {
    console.error = realError
  }
  check(
    'hook account.delete: riga Apple senza token -> una riga di log, senza sub; Google tace',
    deleteLogged.length === 1 && deleteLogged[0].includes('Revoca Apple saltata') && !deleteLogged[0].includes('apple-sub-segreto'),
    deleteLogged.join(' | '),
  )

  // --- Etichetta del dispositivo e giorno di attivita' (D-08, AUTH-06) --------
  const { deviceLabel } = await import('../lib/userAgent')
  const { activityLabel } = await import('../lib/account')
  const UA = {
    chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    safariIpad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    chromeAndroidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    firefoxWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  }
  const device = (name: string, ua: string | null | undefined, label: string, kind: string) => {
    const got = deviceLabel(ua)
    check(`deviceLabel: ${name} -> ${label} (${kind})`, got.label === label && got.kind === kind, `${got.label} / ${got.kind}`)
  }
  device('Chrome su Mac', UA.chromeMac, 'Chrome su Mac', 'desktop')
  device('Safari su iPhone', UA.safariIphone, 'Safari su iPhone', 'phone')
  device('Safari su iPad', UA.safariIpad, 'Safari su iPad', 'tablet')
  device('Edge (contiene anche Chrome/ e Safari/)', UA.edgeWindows, 'Edge su Windows', 'desktop')
  device('Chrome su Android telefono', UA.chromeAndroid, 'Chrome su Android', 'phone')
  device('Chrome su Android senza Mobile e un tablet', UA.chromeAndroidTablet, 'Chrome su Android', 'tablet')
  device('Firefox su Windows', UA.firefoxWindows, 'Firefox su Windows', 'desktop')
  device('stringa vuota', '', 'Browser sconosciuto', 'desktop')
  device('null', null, 'Browser sconosciuto', 'desktop')
  // L'app (D-13): "FuoriRotta/<versione> (<piattaforma>; <dispositivo>)", controllata per prima.
  device('app iPhone', 'FuoriRotta/1.0.0 (iOS; iPhone)', 'App iPhone', 'phone')
  device('app iPad', 'FuoriRotta/2.3 (iOS; iPad)', 'App iPad', 'tablet')
  device('app Android', 'FuoriRotta/1.0.0 (Android; Android)', 'App Android', 'phone')
  device('lo user agent predefinito di iOS (CFNetwork) non basta, l\'app deve impostarlo', 'FuoriRotta/1 CFNetwork/1494.0.7 Darwin/23.4.0', 'Browser sconosciuto', 'desktop')
  device('solo il nome dell\'app', 'FuoriRotta', 'Browser sconosciuto', 'desktop')
  device('curl', 'curl/8.4.0', 'Browser sconosciuto', 'desktop')

  const at = (iso: string) => new Date(iso)
  const today = '2026-10-17'
  const day = (name: string, updatedAt: Date, current: boolean, expected: string) => {
    const got = activityLabel(updatedAt, current, today)
    check(`activityLabel: ${name} -> '${expected}'`, got === expected, got)
  }
  day('sessione corrente', at('2026-10-10T10:00:00Z'), true, 'attiva ora (questo dispositivo)')
  day('stesso giorno di Roma', at('2026-10-17T05:00:00Z'), false, 'oggi')
  day('un giorno prima', at('2026-10-16T12:00:00Z'), false, 'ieri')
  day('tre giorni prima', at('2026-10-14T12:00:00Z'), false, '3 giorni fa')
  // 22:30 UTC del 16 sono le 00:30 del 17 a Roma (CEST): il giorno e' quello di Roma
  day('22:30 UTC del giorno prima e gia il giorno dopo a Roma', at('2026-10-16T22:30:00Z'), false, 'oggi')

  // --- Percorso di ritorno dopo l'accesso (T-21-26) --------------------------
  const { safeNextPath, returnPathFrom } = await import('../lib/safeNextPath')
  check('safeNextPath: un percorso con query passa', safeNextPath('/eventi/12?a=1') === '/eventi/12?a=1')
  for (const [name, raw] of [
    ['URL senza schema (//host)', '//evil.example/x'],
    ['URL assoluto', 'https://evil.example'],
    ['backslash dopo la barra', '/\\evil'],
    ['spazio', '/a b'],
    ['tabulazione', '/a\tb'],
    ['stringa vuota', ''],
    ['nessuna barra iniziale', 'eventi/12'],
    ['201 caratteri', '/' + 'a'.repeat(200)],
  ] as const) {
    check(`safeNextPath: ${name} -> '/'`, safeNextPath(raw) === '/', safeNextPath(raw))
  }
  check('safeNextPath: 200 caratteri esatti passano', safeNextPath('/' + 'a'.repeat(199)).length === 200)
  check("safeNextPath: null e undefined -> '/'", safeNextPath(null) === '/' && safeNextPath(undefined) === '/')
  check(
    'returnPathFrom: toglie error e tiene il resto della query',
    returnPathFrom('/eventi/12', '?a=1&error=access_denied') === '/eventi/12?a=1',
    returnPathFrom('/eventi/12', '?a=1&error=access_denied'),
  )
  check("returnPathFrom: solo error -> percorso nudo", returnPathFrom('/', '?error=x') === '/')
  check('returnPathFrom: senza query', returnPathFrom('/lombardia', '') === '/lombardia')

  // --- Versione esatta, senza ^ ne ~ -----------------------------------------
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
  const installed = (JSON.parse(readFileSync(join(root, 'node_modules/better-auth/package.json'), 'utf8')) as { version: string }).version
  check(
    'package.json: better-auth fissato alla versione esatta installata',
    /^\d+\.\d+\.\d+$/.test(pkg.dependencies['better-auth'] ?? '') && pkg.dependencies['better-auth'] === installed,
    `${pkg.dependencies['better-auth']} / installata ${installed}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
