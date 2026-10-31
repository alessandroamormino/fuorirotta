// Push di prova dal terminale (Fase 26, D-11). Nessun endpoint puo' mandare un push: l'unica strada e' questo
// script, con accesso alla shell del server e la chiave APNs nel .env dell'host (D-17). Sull'host si lancia
// con scripts/send-test-push.sh (container node:24.22.1-alpine); sul Mac, in sviluppo, direttamente con tsx.
//
// Tre modi:
//   --reach                         senza alcuna credenziale: una chiave usa-e-getta contro entrambi gli host di
//                                   Apple. Ogni host deve rispondere 403 InvalidProviderToken: prova DNS, uscita
//                                   sulla 443, TLS e HTTP/2 verso Apple, senza chiave vera.
//   --token <hex> --env <ambiente>  un dispositivo (sandbox|production), senza database e senza mai cancellare.
//   --user <id|e-mail>              tutti i dispositivi di un utente, con potatura (sendToUser).
// Opzionali: --title T, --body B.
//
// Uscita: 0 riuscito (inviato; per --token anche "morto"; per --reach due 403 InvalidProviderToken);
//         1 argomenti, utente non trovato, o esito config/retry/rejected/rete; 2 configurazione APNs incompleta
//         (si stampano i NOMI mancanti, nessuna rete). Mai un token di dispositivo, un JWT o la chiave in uscita.
//
// ../lib/prisma e ../lib/push/send si importano SOLO dentro --user, in modo dinamico: --reach e --token non
// toccano mai un database.
import { exportPKCS8, generateKeyPair } from 'jose'
import { APNS_ENVIRONMENTS, APNS_TOKEN_RE } from '../lib/api-contract'
import { APNS_ORIGIN, apnsMissingConfig, sendBatch, type DeviceReport } from '../lib/push/apns'

const USAGE =
  'uso: send-test-push (--reach | --token <hex> --env sandbox|production | --user <id|e-mail>) [--title T] [--body B]'

const HINTS: Record<string, string> = {
  '400 BadDeviceToken': "chiave, key id, team e host accettati da Apple; il topic (bundle id) non e' ancora dimostrato",
  '403 InvalidProviderToken': 'APNS_KEY_ID o APPLE_TEAM_ID sbagliati, .p8 corrotto o chiave senza il servizio APNs',
  '403 BadEnvironmentKeyIdInToken': "la chiave e' limitata all'altro ambiente",
  '403 ExpiredProviderToken': "l'orologio del server sbaglia di piu' di un'ora",
  '400 BadTopic': 'APPLE_APP_BUNDLE_ID sbagliato',
  '400 DeviceTokenNotForTopic': "APPLE_APP_BUNDLE_ID sbagliato (o token di un'altra app)",
  '410 Unregistered': "Apple dice che l'app non e' piu' installata: il dispositivo e' morto",
}

const answerOf = (r: DeviceReport) => (r.status === undefined ? 'nessuna risposta' : `${r.status} ${r.reason ?? ''}`.trim())

function parse(argv: string[]): Record<string, string | true> | null {
  const out: Record<string, string | true> = {}
  const withValue = ['--token', '--env', '--user', '--title', '--body']
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--reach') out.reach = true
    else if (withValue.includes(a) && argv[i + 1] !== undefined) out[a.slice(2)] = argv[++i]
    else return null
  }
  const modes = ['reach', 'token', 'user'].filter((m) => out[m] !== undefined).length
  return modes === 1 ? out : null
}

async function reach(): Promise<number> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  const env = {
    APNS_KEY_ID: 'ABC123DEFG',
    APPLE_TEAM_ID: 'DEF123GHIJ',
    APPLE_APP_BUNDLE_ID: 'it.example.fake',
    APNS_PRIVATE_KEY_B64: Buffer.from(await exportPKCS8(privateKey)).toString('base64'),
  }
  let ok = true
  // una chiamata per ambiente: un esito 'config' (il 403 atteso) ferma il lotto
  for (const environment of APNS_ENVIRONMENTS) {
    const { byDevice } = await sendBatch([{ id: 1, deviceToken: '0'.repeat(64), environment }], { title: 'reach', body: 'reach' }, { env })
    const r = byDevice[0]
    console.log(`${environment} ${new URL(APNS_ORIGIN[environment]).host} ${answerOf(r)}`)
    if (r.status !== 403 || r.reason !== 'InvalidProviderToken') ok = false
  }
  if (!ok) console.error("Apple non ha risposto 403 InvalidProviderToken da entrambi gli host: controlla DNS, uscita sulla 443 (alternativa documentata da Apple: 2197) e TLS")
  return ok ? 0 : 1
}

async function token(hex: string, environment: string, title: string, body: string): Promise<number> {
  if (!APNS_TOKEN_RE.test(hex) || !(APNS_ENVIRONMENTS as readonly string[]).includes(environment)) {
    console.error(`token esadecimale di 64-200 caratteri e --env ${APNS_ENVIRONMENTS.join('|')} obbligatori`)
    return 1
  }
  const { byDevice } = await sendBatch([{ id: 1, deviceToken: hex, environment }], { title, body })
  const r = byDevice[0]
  console.log(`${environment} ${answerOf(r)} -> ${r.outcome}`)
  const hint = HINTS[answerOf(r)]
  if (hint) console.log(`  ${hint}`)
  return r.outcome === 'sent' || r.outcome === 'dead' ? 0 : 1
}

async function user(who: string, title: string, body: string): Promise<number> {
  // Node 20 su Linux: un modulo compilato da tsx puo' arrivare come { default: modulo }
  const dbMod = (await import('../lib/prisma')) as typeof import('../lib/prisma') & { default?: typeof import('../lib/prisma') }
  const sendMod = (await import('../lib/push/send')) as typeof import('../lib/push/send') & { default?: typeof import('../lib/push/send') }
  const { prisma } = dbMod.default ?? dbMod
  const { sendToUser } = sendMod.default ?? sendMod
  try {
    const found = await prisma.user.findFirst({ where: { OR: [{ id: who }, { email: who.toLowerCase() }] }, select: { id: true } })
    if (!found) {
      console.error('utente non trovato')
      return 1
    }
    const r = await sendToUser(found.id, { title, body })
    console.log(`inviati ${r.sent}, potati ${r.pruned}, da ritentare ${r.retry}, rifiutati ${r.rejected}, configurazione ${r.config}, saltati ${r.skipped}`)
    for (const d of r.byDevice) console.log(`#${d.id} ${answerOf(d)} -> ${d.outcome}`)
    return r.config + r.retry + r.rejected > 0 ? 1 : 0
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<number> {
  const args = parse(process.argv.slice(2))
  if (!args) {
    console.error(USAGE)
    return 1
  }
  if (args.reach) return reach()
  const missing = await apnsMissingConfig()
  if (missing.length > 0) {
    console.error(`configurazione APNs incompleta: ${missing.join(', ')}`)
    return 2
  }
  const title = typeof args.title === 'string' ? args.title : 'Fuorirotta'
  const body = typeof args.body === 'string' ? args.body : 'Notifica di prova'
  if (typeof args.token === 'string') return token(args.token, String(args.env ?? ''), title, body)
  return user(String(args.user), title, body)
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error('errore:', e instanceof Error ? e.message : 'sconosciuto')
    process.exit(1)
  },
)
