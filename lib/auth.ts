import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError } from 'better-auth/api'
import { bearer } from 'better-auth/plugins'
import { displayNameFromProvider, isValidDisplayName, normalizeDisplayName } from './displayName'
import { prisma } from './prisma'

// Accesso con Google (Fase 21). Questo e' l'UNICO file che configura Better
// Auth. Due regole:
//
// - Costruzione pigra: betterAuth() parte alla prima richiesta, mai
//   all'import. `next build` e `test:ci` non hanno nessun segreto, e un
//   modulo che lancia all'import li farebbe cadere (21-RESEARCH Pitfall 8).
// - Interruttore a runtime (D-16, D-19): con AUTH_ENABLED diverso da '1', o
//   con la configurazione incompleta, getAuth() e' null e tutta la
//   superficie risponde 404 / { enabled: false }.
//
// Nessun marcatore "solo server": il pacchetto non e' installato e i gate tsx
// importano questo file. Che nessun codice client lo raggiunga lo controlla
// check:browser-bundle.

const MIN_SECRET_LENGTH = 32
const REQUIRED_VARS = ['BETTER_AUTH_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const

// Una riga di log per ogni insieme distinto di variabili mancanti, non una
// per richiesta: authEnabled() gira a ogni chiamata a getAuth().
const reportedMissing = new Set<string>()

/**
 * True solo con AUTH_ENABLED='1' E configurazione completa. Con AUTH_ENABLED='1'
 * ma qualcosa mancante rifiuta (false) e lo dice nel log, con i NOMI delle
 * variabili e mai i valori: meglio un accesso spento che mezzo configurato.
 */
export function authEnabled(): boolean {
  if (process.env.AUTH_ENABLED !== '1') return false
  const missing: string[] = REQUIRED_VARS.filter((name) => !process.env[name])
  if ((process.env.BETTER_AUTH_SECRET ?? '').length < MIN_SECRET_LENGTH) {
    missing.push('BETTER_AUTH_SECRET')
  }
  if (missing.length === 0) return true
  const key = missing.join(',')
  if (!reportedMissing.has(key)) {
    reportedMissing.add(key)
    console.error(`[Auth] AUTH_ENABLED=1 ma la configurazione e' incompleta: ${missing.join(', ')}`)
  }
  return false
}

function noTokens<T extends object>(account: T): T {
  return { ...account, accessToken: null, refreshToken: null, idToken: null }
}

function create() {
  const baseURL = process.env.BETTER_AUTH_URL
  return betterAuth({
    // Esplicito: mai ricavato dalla richiesta. Da qui derivano il redirect_uri
    // di Google, il prefisso __Secure- del cookie e il controllo di Origin.
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    telemetry: { enabled: false },
    // requireSignature: un token di sessione "nudo" non vale come bearer, solo
    // il valore firmato (21-RESEARCH Pattern 5).
    plugins: [bearer({ requireSignature: true })],
    session: {
      expiresIn: 60 * 60 * 24 * 60, // 60 giorni, D-04
      updateAge: 60 * 60 * 24, // rinnovo al massimo una volta al giorno
      // freshAge 0: di default elenco sessioni ed eliminazione account
      // falliscono per chi ha fatto l'accesso da piu' di un giorno, cioe'
      // quasi tutti con una sessione da 60 giorni (Pitfall 1).
      freshAge: 0,
      // Nessuna cookieCache: una sessione revocata o eliminata deve morire
      // subito, non alla scadenza della cache (D-10, D-11).
    },
    advanced: {
      cookiePrefix: 'fuorirotta',
      // Solo X-Real-IP: nginx lo sovrascrive con $remote_addr
      // (20-PRODUCTION-FACTS.md sezione 1). Un X-Forwarded-For lo scrive chi
      // vuole, quindi non si legge.
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    rateLimit: {
      // Esplicito: di default e' attivo solo in produzione e i gate girano in dev.
      enabled: true,
      // Nel database (auth_rate_limit): il contatore sopravvive a un riavvio
      // o a un deploy.
      storage: 'database',
      window: 60,
      max: 60,
      // Sostituisce la regola di serie sui sign-in (3 ogni 10 s).
      customRules: { '/sign-in/social': { window: 60, max: 5 } },
    },
    account: {
      // AUTH-07: mai unire in automatico un utente nuovo a uno esistente con la
      // stessa e-mail (classe CVE-2026-53516). Nessun trustedProviders. Il
      // secondo provider della Fase 25 si collega con un'azione esplicita.
      accountLinking: { enabled: true, disableImplicitLinking: true },
    },
    // Eliminazione immediata, senza mail ne' verifica (D-10).
    user: { deleteUser: { enabled: true } },
    // Senza questo gli errori finirebbero sulla pagina di errore della libreria.
    onAPIError: { errorURL: `${baseURL}/accedi` },
    databaseHooks: {
      user: {
        create: {
          // Il nome di Google non e' nostro: lo si porta a 1-50 punti di codice
          // (la colonna e' VARCHAR(50), un nome piu' lungo farebbe fallire
          // l'inserimento) e la foto non si salva mai (D-07, D-09).
          before: async (user) => ({
            data: { ...user, name: displayNameFromProvider(user.name, user.email), image: null },
          }),
        },
        update: {
          // Rete di sicurezza per POST /api/auth/update-user diretto: la
          // libreria accetta qualunque nome. Le rotte /api/v1/me/* validano
          // prima con la stessa regola.
          before: async (user) => {
            if (user.name === undefined) return
            if (!isValidDisplayName(user.name)) {
              throw new APIError('BAD_REQUEST', { message: 'Nome non valido' })
            }
            return { data: { ...user, name: normalizeDisplayName(user.name) } }
          },
        },
      },
      account: {
        // Non chiamiamo mai le API di Google: i suoi token non si tengono
        // (D-12, e un'informativa piu' corta).
        create: { before: async (account) => ({ data: noTokens(account) }) },
        update: { before: async (account) => ({ data: noTokens(account) }) },
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        // Altrimenti a Google arriva include_granted_scopes=true.
        includeGrantedScopes: false,
        // D-07: la foto di Google non si salva.
        mapProfileToUser: () => ({ image: undefined }),
      },
    },
  })
}

export type Auth = ReturnType<typeof create>

let instance: Auth | null = null

export function getAuth(): Auth | null {
  return authEnabled() ? (instance ??= create()) : null
}
