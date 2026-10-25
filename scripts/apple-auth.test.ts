// Gate unitario di Apple (check:apple, test:ci). Nessun database e nessuna rete:
// la chiave e' generata qui, fetch e' iniettato. Copre il client secret (claim,
// durata, cache, ri-firma), la forma delle richieste di revoca e di scambio del
// codice. Esce con 1 al primo controllo fallito e stampa "ok  <caso>" per ognuno.
import { generateKeyPairSync, verify } from 'node:crypto'
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, importSPKI, jwtVerify } from 'jose'

// Variabili PRIMA dell'import dinamico di lib/appleAuth (che importa lib/prisma,
// il quale non apre nessuna connessione all'import).
const WEB_ID = 'it.fuorirotta.web.test'
const BUNDLE_ID = 'it.fuorirotta.app.test'
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
Object.assign(process.env, {
  DATABASE_URL: 'postgresql://fuorirotta:fuorirotta@localhost:5433/fuorirotta_dev',
  APPLE_CLIENT_ID: WEB_ID,
  APPLE_APP_BUNDLE_ID: BUNDLE_ID,
  APPLE_TEAM_ID: 'TEAMID1234',
  APPLE_KEY_ID: 'KEYID12345',
  APPLE_PRIVATE_KEY_B64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64'),
})

function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) {
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`)
    process.exit(1)
  }
  console.log(`ok  ${name}`)
}

type Call = { url: string; init: RequestInit; form: URLSearchParams }

/** fetch iniettato: registra le chiamate e risponde con la sequenza data (una Response per chiamata, o un errore da lanciare). */
function fakeFetch(answers: (Response | Error)[]): { doFetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {}, form: new URLSearchParams(String(init?.body ?? '')) })
    const answer = answers[Math.min(calls.length, answers.length) - 1]
    if (answer instanceof Error) throw answer
    return answer
  }) as typeof fetch
  return { doFetch, calls }
}

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>

async function main(): Promise<void> {
  const { appleClientSecret, revokeAppleToken, exchangeAppleCode, verifyAppleNotification } = await import('../lib/appleAuth')
  const now = 1_800_000_000

  // --- client secret ---------------------------------------------------------
  const secret = appleClientSecret(WEB_ID, now)
  const [head, body, signature] = secret.split('.')
  const header = decode(head)
  const claims = decode(body)
  check('client secret: header ES256 con il kid', header.alg === 'ES256' && header.kid === 'KEYID12345', JSON.stringify(header))
  check(
    'client secret: iss = team, aud = Apple, sub = client id',
    claims.iss === 'TEAMID1234' && claims.aud === 'https://appleid.apple.com' && claims.sub === WEB_ID,
    JSON.stringify(claims),
  )
  const ttl = Number(claims.exp) - Number(claims.iat)
  check('client secret: exp - iat = 3600 (al massimo 15777000)', ttl === 3600 && ttl <= 15_777_000, String(ttl))
  check(
    'client secret: firma valida (crypto.verify, ieee-p1363)',
    verify('sha256', Buffer.from(`${head}.${body}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')),
  )
  check('client secret: una seconda chiamata restituisce la stessa stringa', appleClientSecret(WEB_ID, now + 60) === secret)
  const refreshed = appleClientSecret(WEB_ID, now + 3600 - 599)
  check('client secret: con meno di 600 s residui ne torna uno nuovo', refreshed !== secret && decode(refreshed.split('.')[1]).iat === now + 3600 - 599)
  const verified = await jwtVerify(secret, await importSPKI(publicKey.export({ type: 'spki', format: 'pem' }) as string, 'ES256'), {
    algorithms: ['ES256'],
    issuer: 'TEAMID1234',
    audience: 'https://appleid.apple.com',
    currentDate: new Date(now * 1000),
  }).then(() => true, () => false)
  check('client secret: verificato in modo indipendente da jose (ES256, iss, aud)', verified)
  check('client secret: il bundle ID ha un sub suo', decode(appleClientSecret(BUNDLE_ID, now).split('.')[1]).sub === BUNDLE_ID)

  // --- revoca ------------------------------------------------------------------
  const ok = () => new Response(null, { status: 200 })
  const refused = () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 })
  const TOKEN = 'refresh-token-segreto'

  const first = fakeFetch([ok()])
  await revokeAppleToken(TOKEN, first.doFetch)
  const sent = first.calls[0]
  check(
    'revoca: un solo POST a /auth/revoke con i quattro campi e nient altro',
    first.calls.length === 1 &&
      sent.url === 'https://appleid.apple.com/auth/revoke' &&
      sent.init.method === 'POST' &&
      [...sent.form.keys()].sort().join(',') === 'client_id,client_secret,token,token_type_hint' &&
      sent.form.get('client_id') === WEB_ID &&
      sent.form.get('token') === TOKEN &&
      sent.form.get('token_type_hint') === 'refresh_token',
    JSON.stringify([...sent.form.keys()]),
  )
  check(
    'revoca: il client secret ha sub = Services ID, nessun redirect, timeout attivo',
    decode(sent.form.get('client_secret')?.split('.')[1] ?? '').sub === WEB_ID && sent.init.redirect === 'error' && !!sent.init.signal,
  )

  const second = fakeFetch([refused(), ok()])
  await revokeAppleToken(TOKEN, second.doFetch)
  check(
    'revoca: con il Services ID rifiutato la seconda chiamata va al bundle ID',
    second.calls.length === 2 && second.calls[0].form.get('client_id') === WEB_ID && second.calls[1].form.get('client_id') === BUNDLE_ID,
  )

  const failing = fakeFetch([refused(), new TypeError('rete assente con ' + TOKEN)])
  let message = ''
  try {
    await revokeAppleToken(TOKEN, failing.doFetch)
  } catch (error) {
    message = error instanceof Error ? error.message : 'non-Error'
  }
  check('revoca: se falliscono tutti i client id lancia, con stato o "rete" e senza il token', message !== '' && !message.includes(TOKEN) && message.includes('HTTP 400') && message.includes('rete'), message)

  // --- scambio del codice (Fase 27) -------------------------------------------------
  const exchange = fakeFetch([new Response(JSON.stringify({ refresh_token: 'RT-nativo', id_token: 'id.token.x', access_token: 'non-lo-vogliamo' }), { status: 200 })])
  const result = await exchangeAppleCode('codice-nativo', BUNDLE_ID, exchange.doFetch)
  const call = exchange.calls[0]
  check(
    'scambio: POST a /auth/token con grant_type, code, client_id e client_secret',
    call.url === 'https://appleid.apple.com/auth/token' &&
      [...call.form.keys()].sort().join(',') === 'client_id,client_secret,code,grant_type' &&
      call.form.get('grant_type') === 'authorization_code' &&
      call.form.get('code') === 'codice-nativo' &&
      call.form.get('client_id') === BUNDLE_ID &&
      decode(call.form.get('client_secret')?.split('.')[1] ?? '').sub === BUNDLE_ID,
  )
  check('scambio: restituisce refresh token e id token, nient altro', result.refreshToken === 'RT-nativo' && result.idToken === 'id.token.x' && Object.keys(result).length === 2)
  const empty = await exchangeAppleCode('c', BUNDLE_ID, fakeFetch([new Response('{}', { status: 200 })]).doFetch)
  check('scambio: senza token nel corpo restituisce null', empty.refreshToken === null && empty.idToken === null)
  let exchangeError = ''
  try {
    await exchangeAppleCode('codice-segreto', BUNDLE_ID, fakeFetch([refused()]).doFetch)
  } catch (error) {
    exchangeError = error instanceof Error ? error.message : 'non-Error'
  }
  check('scambio: un rifiuto lancia con lo stato e senza il codice', exchangeError.includes('HTTP 400') && !exchangeError.includes('codice-segreto'), exchangeError)
  // --- notifiche server-to-server --------------------------------------------------
  const rsa = await generateKeyPair('RS256')
  const other = await generateKeyPair('RS256')
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(rsa.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }] })
  const sign = (events: unknown, o: { iss?: string; aud?: string; key?: typeof rsa.privateKey } = {}) =>
    new SignJWT({ events })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(o.iss ?? 'https://appleid.apple.com')
      .setAudience(o.aud ?? WEB_ID)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(o.key ?? rsa.privateKey)
  const rejects = (jws: string) => verifyAppleNotification(jws, jwks).then(() => false, () => true)
  const event = { type: 'account-deleted', sub: 'sub-1' }

  const asString = await verifyAppleNotification(await sign(JSON.stringify(event)), jwks)
  check('notifica: events come stringa JSON accettato', asString.type === 'account-deleted' && asString.sub === 'sub-1')
  const asObject = await verifyAppleNotification(await sign(event, { aud: BUNDLE_ID }), jwks)
  check('notifica: events come oggetto accettato (e aud = bundle ID)', asObject.type === 'account-deleted' && asObject.sub === 'sub-1')
  check('notifica: aud sbagliata rifiutata', await rejects(await sign(event, { aud: 'other.client' })))
  check('notifica: iss sbagliato rifiutato', await rejects(await sign(event, { iss: 'https://evil.example' })))
  check('notifica: firma di un altra chiave rifiutata', await rejects(await sign(event, { key: other.privateKey })))
  check('notifica: events senza sub rifiutato', await rejects(await sign({ type: 'account-deleted' })))
  check('notifica: events assente rifiutato', await rejects(await sign(undefined)))
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
