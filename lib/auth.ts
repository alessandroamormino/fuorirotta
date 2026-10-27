import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { APIError } from 'better-auth/api'
import { decryptOAuthToken } from 'better-auth/oauth2'
import { bearer } from 'better-auth/plugins'
import { APPLE_ISSUER, appleClientIds, appleClientSecret, appleConfigured, appleMissingConfig, revokeAppleToken } from './appleAuth'
import { displayNameFromProvider, isValidDisplayName, normalizeDisplayName } from './displayName'
import { googleProfileImage } from './profileImage'
import { prisma } from './prisma'

// Accesso con Google (Fase 21). Questo e' l'UNICO file che configura Better
// Auth. Due regole:
//
// - Costruzione pigra: betterAuth() parte alla prima richiesta, mai
//   all'import. `next build` e `test:ci` non hanno nessun segreto, e un
//   modulo che lancia all'import li farebbe cadere (21-RESEARCH Pitfall 8).
// - Interruttore a runtime (D-16, D-19): con AUTH_ENABLED diverso da 'true', o
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

// https sempre; http solo per localhost (sviluppo e gate). Senza schema, o con
// http su un dominio vero, il prefisso __Secure- del cookie cambierebbe in
// silenzio o ogni richiesta andrebbe in 500: meglio spento.
function validBaseUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')
  } catch {
    return false
  }
}

/**
 * True solo con AUTH_ENABLED='true' E configurazione completa. Con AUTH_ENABLED='true'
 * ma qualcosa mancante rifiuta (false) e lo dice nel log, con i NOMI delle
 * variabili e mai i valori: meglio un accesso spento che mezzo configurato.
 */
export function authEnabled(): boolean {
  if (process.env.AUTH_ENABLED !== 'true') return false
  const missing: string[] = REQUIRED_VARS.filter((name) => !process.env[name])
  if (process.env.BETTER_AUTH_URL && !validBaseUrl(process.env.BETTER_AUTH_URL)) missing.push('BETTER_AUTH_URL')
  if ((process.env.BETTER_AUTH_SECRET ?? '').length < MIN_SECRET_LENGTH) {
    missing.push('BETTER_AUTH_SECRET')
  }
  if (missing.length === 0) return true
  const key = missing.join(',')
  if (!reportedMissing.has(key)) {
    reportedMissing.add(key)
    console.error(`[Auth] AUTH_ENABLED=true ma la configurazione e' incompleta o non valida: ${missing.join(', ')}`)
  }
  return false
}

/**
 * Interruttore di Apple (D-04), separato da quello di Google: true solo con
 * APPLE_AUTH_ENABLED='true', accesso attivo E le quattro variabili complete con
 * una chiave EC P-256 leggibile. Interruttore acceso ma configurazione
 * incompleta: spento, e il log dice i NOMI (una volta per insieme), mai i valori.
 */
export function appleEnabled(): boolean {
  if (process.env.APPLE_AUTH_ENABLED !== 'true' || !authEnabled()) return false
  const missing = appleMissingConfig()
  if (missing.length === 0) return true
  const key = `apple:${missing.join(',')}`
  if (!reportedMissing.has(key)) {
    reportedMissing.add(key)
    console.error(`[Auth] APPLE_AUTH_ENABLED=true ma la configurazione Apple e' incompleta o non valida: ${missing.join(', ')}`)
  }
  return false
}

// I token di Google non si tengono mai (21 D-12). Quello di Apple si tiene solo
// il refresh token, e solo per poterlo revocare (D-13): la libreria lo ha gia'
// cifrato prima che l'hook giri. Chi non e' esplicitamente 'apple' (anche senza
// providerId) perde tutto: fallisce chiuso.
function noTokens<T extends object>(account: T): T {
  const providerId = (account as { providerId?: string }).providerId
  return providerId === 'apple'
    ? { ...account, accessToken: null, idToken: null }
    : { ...account, accessToken: null, refreshToken: null, idToken: null }
}

// Provider Apple: il Services ID e' il client primario (scambio del codice web);
// il bundle ID, se c'e', si aggiunge solo all'audience dell'id token (Pitfall 4:
// appBundleIdentifier la SOSTITUIREBBE). Nessun overrideUserInfoOnSignIn (D-07).
// clientSecret e' un getter: la libreria tiene l'oggetto per riferimento e lo
// legge a ogni scambio, un valore calcolato qui resterebbe congelato.
function appleProvider() {
  const [servicesId] = appleClientIds()
  return {
    clientId: [servicesId],
    audience: appleClientIds(),
    get clientSecret() {
      return appleClientSecret(servicesId)
    },
  }
}

function create() {
  const baseURL = process.env.BETTER_AUTH_URL
  // Il hook di revoca ha bisogno del contesto dell'istanza che sta nascendo: si
  // legge dentro l'hook (mai alla costruzione), quando `instance` esiste.
  const created = betterAuth({
    // Esplicito: mai ricavato dalla richiesta. Da qui derivano il redirect_uri
    // di Google, il prefisso __Secure- del cookie e il controllo di Origin.
    baseURL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    telemetry: { enabled: false },
    // Nessun client usa i token dei provider. Questi tre rinfrescherebbero il
    // token di Apple con un aggiornamento senza providerId (noTokens lo azzera,
    // e la revoca salterebbe) e /refresh-token lo restituirebbe in chiaro.
    disabledPaths: ['/refresh-token', '/get-access-token', '/account-info'],
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
      // secondo provider si collega con un'azione esplicita dal profilo.
      // allowDifferentEmails riguarda solo quel collegamento, fatto da chi ha
      // gia' una sessione (l'e-mail di Apple e' spesso un relay): un accesso con
      // e-mail uguale resta rifiutato da disableImplicitLinking.
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: true },
      // Cifrati con BETTER_AUTH_SECRET: ruotarlo rende illeggibili i token Apple
      // gia' salvati, la revoca viene saltata e loggata.
      encryptOAuthTokens: true,
    },
    // Apple fa un POST cross-site al callback. I cookie restano tutti Lax e non
    // cambia nulla: il POST senza cookie diventa un GET same-site. Questo serve
    // solo al browser che un cookie lo manda comunque (altrimenti 403
    // INVALID_ORIGIN).
    ...(appleEnabled() ? { trustedOrigins: [APPLE_ISSUER] } : {}),
    // Eliminazione immediata, senza mail ne' verifica (D-10).
    user: { deleteUser: { enabled: true } },
    // Senza questo gli errori finirebbero sulla pagina di errore della libreria.
    onAPIError: { errorURL: `${baseURL}/accedi` },
    databaseHooks: {
      user: {
        create: {
          // Il nome di Google non e' nostro: lo si porta a 1-50 punti di codice
          // (la colonna e' VARCHAR(50), un nome piu' lungo farebbe fallire
          // l'inserimento). La foto si salva solo se e' un indirizzo di Google
          // (D-20, sostituisce D-07).
          before: async (user) => ({
            data: {
              ...user,
              name: displayNameFromProvider(user.name, user.email),
              image: googleProfileImage(user.image),
            },
          }),
        },
        update: {
          // Rete di sicurezza per POST /api/auth/update-user diretto: la
          // libreria accetta qualunque nome e qualunque foto. Le rotte
          // /api/v1/me/* validano prima con la stessa regola.
          before: async (user) => {
            // overrideUserInfoOnSignIn riscrive a ogni accesso nome, e-mail e
            // foto dal profilo Google (l'unico chiamante che passa l'e-mail).
            // Il nome e' dell'utente (D-09) e l'e-mail e' l'identita': di
            // quella riscrittura teniamo solo la foto, nuova o null (D-20).
            // La libreria unisce il risultato ai dati originali: i campi da
            // non toccare vanno esplicitamente a undefined (Prisma li ignora).
            if (user.email !== undefined) {
              return {
                data: { name: undefined, email: undefined, emailVerified: undefined, image: googleProfileImage(user.image) },
              }
            }
            if (user.name === undefined && user.image === undefined) return
            const data = { ...user }
            if (user.image !== undefined) data.image = googleProfileImage(user.image)
            if (user.name !== undefined) {
              if (!isValidDisplayName(user.name)) {
                throw new APIError('BAD_REQUEST', { message: 'Nome non valido' })
              }
              data.name = normalizeDisplayName(user.name)
            }
            return { data }
          },
        },
      },
      account: {
        // Non chiamiamo mai le API di Google: i suoi token non si tengono
        // (21 D-12, e un'informativa piu' corta). Di Apple resta il refresh
        // token, cifrato, per la revoca (D-13).
        create: { before: async (account) => ({ data: noTokens(account) }) },
        update: { before: async (account) => ({ data: noTokens(account) }) },
        // Un solo punto per scollegamento, eliminazione dell'account e qualunque
        // cancellazione interna (D-10, D-13). Non ritorna mai false e non lancia
        // mai: un Apple irraggiungibile non deve bloccare la cancellazione (D-14).
        // Si basa su appleConfigured(), non sull'interruttore: a interruttore
        // spento ma con le chiavi presenti il token si revoca comunque.
        delete: {
          before: async (account) => {
            if (account.providerId !== 'apple') return
            if (!account.refreshToken) {
              console.error('[Auth] Revoca Apple saltata: nessun token salvato')
              return
            }
            if (!appleConfigured()) {
              console.error(`[Auth] Revoca Apple saltata: configurazione Apple assente (${appleMissingConfig().join(', ')})`)
              return
            }
            try {
              const token = await decryptOAuthToken(account.refreshToken, (await created.$context) as unknown as Parameters<typeof decryptOAuthToken>[1])
              await revokeAppleToken(token)
            } catch (error) {
              console.error('[Auth] Revoca del token Apple non riuscita:', error instanceof Error ? error.message : 'errore')
            }
          },
        },
      },
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
        // Altrimenti a Google arriva include_granted_scopes=true.
        includeGrantedScopes: false,
        // D-20: la foto si aggiorna a ogni accesso; l'hook user.update.before
        // la separa da nome ed e-mail, che questa opzione riscriverebbe.
        overrideUserInfoOnSignIn: true,
      },
      ...(appleEnabled() ? { apple: appleProvider() } : {}),
    },
  })
  return created
}

export type Auth = ReturnType<typeof create>

let instance: Auth | null = null

export function getAuth(): Auth | null {
  return authEnabled() ? (instance ??= create()) : null
}
