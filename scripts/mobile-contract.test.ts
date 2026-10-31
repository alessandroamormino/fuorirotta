// Contratto dell'API per l'app (check:mobile-contract, test:ci). Nessun database.
//
// Per ora prova che il comparatore di scripts/golden-shape.ts sa FALLIRE: senza
// questa prova il gate check:api-golden (che gira solo in locale, sul Postgres di
// sviluppo) potrebbe essere vuoto e nessuno se ne accorgerebbe in CI. In fondo i casi
// sulla configurazione (/api/v1/config) e su .well-known, chiamando i gestori a mano.
//
// Esce con 1 al primo controllo fallito. Stampa "ok  <caso>" per ognuno.
import { compareShapes, shapeOf } from './golden-shape'

function check(name: string, condition: boolean, detail = ''): void {
  if (!condition) {
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ''}`)
    process.exit(1)
  }
  console.log(`ok  ${name}`)
}

const golden = shapeOf({ a: 'x', n: 1, list: [{ b: 'y' }], flag: true })
const violationsOf = (value: unknown) => compareShapes(golden, shapeOf(value))
const base = { a: 'x', n: 1, list: [{ b: 'y' }], flag: true }

check('forma identica -> nessuna violazione', violationsOf(base).length === 0)

const removed = violationsOf({ n: 1, list: [{ b: 'y' }], flag: true })
check('chiave rimossa -> percorso rimosso', removed.some((v) => v === 'percorso rimosso: $.a'), removed.join('; '))

const retyped = violationsOf({ ...base, a: 5 })
check('stringa -> numero -> tipo perso', retyped.includes('tipo perso: $.a (string)'), retyped.join('; '))

const lost = violationsOf({ ...base, list: ['solo-stringhe'] })
check(
  "elementi oggetto -> stringhe: violazione sul percorso dell'elemento",
  lost.includes('tipo perso: $.list[] (object)') && lost.includes('percorso rimosso: $.list[].b'),
  lost.join('; '),
)

const emptied = violationsOf({ ...base, list: [] })
check('array svuotato -> percorso rimosso (la risposta vuota non passa)', emptied.includes('percorso rimosso: $.list[]'), emptied.join('; '))

check('chiave aggiunta -> compatibile', violationsOf({ ...base, extra: [1, 2] }).length === 0)
check(
  'tipo aggiunto (null accanto a string) -> compatibile',
  compareShapes({ '$.x': ['string'] }, { '$.x': ['null', 'string'] }).length === 0,
)
check('valore che diventa SOLO null -> tipo perso', violationsOf({ ...base, a: null }).includes('tipo perso: $.a (string)'))

const nested = shapeOf({ a: [{ b: [{ c: 1 }] }] })
check("percorsi annidati: '$.a[].b[].c' compare in shapeOf", nested['$.a[].b[].c']?.join() === 'number', Object.keys(nested).join(','))
check('tipi ordinati e senza duplicati', shapeOf([1, 'a', null, 2])['$[]'].join() === 'null,number,string')

// --- GET /api/v1/config (API-04): senza database, l'ambiente si legge a ogni richiesta ---------------
async function main(): Promise<void> {
  const cfgMod = await import('../app/api/v1/config/route')
  const cfg = ((cfgMod as { default?: unknown }).default ?? cfgMod) as typeof cfgMod
  const env = process.env as Record<string, string | undefined>
  const setEnv = (min?: string, rec?: string) => {
    for (const [k, v] of [['APP_MIN_VERSION', min], ['APP_RECOMMENDED_VERSION', rec]] as const) {
      if (v === undefined) delete env[k]
      else env[k] = v
    }
  }
  const ask = async (qs = '') => {
    const res = await cfg.GET(new Request(`http://localhost/api/v1/config${qs}`))
    return { res, text: await res.text() }
  }
  const statusOf = async (version: string) => {
    const { text } = await ask(`?version=${encodeURIComponent(version)}`)
    return (JSON.parse(text) as { status?: string }).status
  }

  setEnv()
  const none = await ask()
  check('config: senza variabili -> minimumVersion e recommendedVersion null, nessuna chiave status', none.text === '{"minimumVersion":null,"recommendedVersion":null}', none.text)
  check('config: senza variabili e con ?version=1.0.0 -> ok', (await statusOf('1.0.0')) === 'ok')
  check('config: content-type application/json e Cache-Control no-store', none.res.headers.get('content-type')?.includes('application/json') === true && none.res.headers.get('cache-control') === 'no-store')

  setEnv('1.2.0', '1.4.0')
  const grid: Array<[string, string]> = [
    ['1.1.9', 'update-required'], ['1.2.0', 'update-recommended'], ['1.3.9', 'update-recommended'],
    ['1.4.0', 'ok'], ['2.0', 'ok'], ['1.4', 'ok'],
  ]
  for (const [v, want] of grid) check(`config: min 1.2.0 / rec 1.4.0, versione ${v} -> ${want}`, (await statusOf(v)) === want, String(await statusOf(v)))

  setEnv('1.10.0', undefined)
  check('config: min 1.10.0, versione 1.9.9 -> update-required (numerico, non per stringa)', (await statusOf('1.9.9')) === 'update-required')
  setEnv('1.9.0', undefined)
  check('config: min 1.9.0, versione 1.10.0 -> ok', (await statusOf('1.10.0')) === 'ok')
  setEnv('1.4.0', undefined)
  check("config: '1.4' uguale a minimo '1.4.0' -> non update-required", (await statusOf('1.4')) === 'ok')
  setEnv('2.0.0', '1.5.0')
  check('config: minimo sopra il consigliato -> vince il minimo', (await statusOf('1.6.0')) === 'update-required')

  for (const bad of ['abc', '1.0.0-beta', 'v1.0']) {
    setEnv(bad, bad)
    const { text } = await ask('?version=1.0.0')
    check(`config: variabili malformate '${bad}' -> null e nessuno bloccato`, text === '{"minimumVersion":null,"recommendedVersion":null,"status":"ok"}', text)
  }

  setEnv('1.2.0', '1.4.0')
  for (const bad of ['v1.0', '1..0', '1.0.0.0.0', '', '9999999999']) {
    const { text } = await ask(`?version=${encodeURIComponent(bad)}`)
    check(`config: ?version='${bad}' malformato -> nessuna chiave status`, !('status' in JSON.parse(text)), text)
  }

  const a = await ask('?version=1.3.0')
  const b = await ask('?version=1.3.0')
  check('config: la stessa richiesta due volte -> corpi identici byte per byte', a.text === b.text)
  const many = await Promise.all(Array.from({ length: 5 }, () => ask('?version=1.3.0')))
  check('config: cinque chiamate concorrenti -> corpi identici', many.every((m) => m.text === a.text))
  setEnv('1.3.5', '1.4.0')
  check("config: cambiare APP_MIN_VERSION tra due chiamate cambia la risposta, senza riavvio", (await statusOf('1.3.0')) === 'update-required' && a.text.includes('update-recommended'))

  delete env.AUTH_ENABLED
  check('config: con AUTH_ENABLED spento la rotta risponde comunque 200', (await ask()).res.status === 200)

  const { readFileSync } = await import('node:fs')
  const code = readFileSync(new URL('../app/api/v1/config/route.ts', import.meta.url), 'utf8')
    .split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')
  check('config: la rotta non importa lib/auth, lib/account ne lib/prisma', !/lib\/(auth|account|prisma)/.test(code), code)
}

main().catch((e) => { console.error('FAIL: errore inatteso', e); process.exit(1) })
