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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(__dirname, '..')

// Variabili PRIMA dell'import dinamico di lib/auth. Il segreto e' di 40
// caratteri non banali: uno ripetitivo farebbe scrivere alla libreria un
// avviso di bassa entropia.
const SECRET = 'q8Vn2LzTfX0cRk5aYw9JdHs3UeBm7PoG1iNtZ4Ab'
Object.assign(process.env, {
  AUTH_ENABLED: '1',
  BETTER_AUTH_URL: 'https://fuori-rotta.it',
  BETTER_AUTH_SECRET: SECRET,
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  DATABASE_URL: 'postgresql://fuorirotta:fuorirotta@localhost:5433/fuorirotta_dev',
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
  account?: { accountLinking?: { enabled?: boolean; disableImplicitLinking?: boolean; trustedProviders?: unknown } }
  advanced?: { ipAddress?: { ipAddressHeaders?: string[] } }
  plugins?: { id: string; options?: { requireSignature?: boolean } }[]
  telemetry?: { enabled?: boolean }
  socialProviders?: { google?: { includeGrantedScopes?: boolean } }
  user?: { deleteUser?: { enabled?: boolean; sendDeleteAccountVerification?: unknown } }
  databaseHooks: {
    user: { create: { before: Hook }; update: { before: Hook } }
    account: { create: { before: Hook }; update: { before: Hook } }
  }
}

async function main(): Promise<void> {
  const { authEnabled, getAuth } = await import('../lib/auth')
  const display = await import('../lib/displayName')

  // --- Nome visualizzato: punti di codice, dopo NFC e trim (D-09) -------------
  check('displayName: trim', display.normalizeDisplayName('  Anna  ') === 'Anna')
  check('displayName: vuoto e spazi non validi', !display.isValidDisplayName('') && !display.isValidDisplayName('   '))
  check('displayName: un valore non stringa non e valido', !display.isValidDisplayName(42) && !display.isValidDisplayName(null) && !display.isValidDisplayName(undefined))
  check('displayName: 50 emoji valide, 51 punti di codice no', display.isValidDisplayName('😀'.repeat(50)) && !display.isValidDisplayName('a'.repeat(51)))
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
  check('displayName: iniziale in maiuscolo del nome', display.displayInitial('éva', 'x@y.it') === 'É')
  check('displayName: iniziale dall\'e-mail se il nome e vuoto', display.displayInitial('', 'zoe@y.it') === 'Z')

  // --- authEnabled(): rifiuta la configurazione incompleta e non svela i valori -
  const logged: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  const saved = { ...process.env }
  try {
    check('authEnabled: attivo con la configurazione completa', authEnabled() === true)

    process.env.AUTH_ENABLED = '0'
    check('authEnabled: AUTH_ENABLED=0 -> spento e senza log', authEnabled() === false && logged.length === 0)
    process.env.AUTH_ENABLED = '1'

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
  } finally {
    console.error = originalError
    Object.assign(process.env, saved)
  }
  check('authEnabled: ripristinato, torna attivo', authEnabled() === true)

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
  check('linking: accountLinking attivo (serve al collegamento esplicito della Fase 25)', options.account?.accountLinking?.enabled === true)
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
  check('eliminazione: deleteUser attivo senza callback di verifica', options.user?.deleteUser?.enabled === true && options.user.deleteUser.sendDeleteAccountVerification === undefined)

  // --- Hook del database: nome valido, nessun token, nessuna foto -------------
  const hooks = options.databaseHooks
  const created = await hooks.user.create.before({ name: '  '.concat('y'.repeat(120)), email: 'n@b.it', image: 'https://lh3.googleusercontent.com/x' })
  check(
    'hook user.create: nome a 50 punti di codice e foto scartata',
    !!created && Array.from(String(created.data.name)).length === 50 && created.data.image == null,
  )
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
