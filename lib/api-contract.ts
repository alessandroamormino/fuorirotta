// Contratto dell'API personale con l'app: SOLO tipi e costanti, nessun import,
// perche' e' l'unico file che il lato app puo' copiare cosi' com'e'.
//
// Credenziale. Il bearer e' il valore dell'header di risposta `set-auth-token`
// (la stringa firmata "token.firma" che Better Auth restituisce all'accesso) e va
// mandato come "Authorization: Bearer <valore>" su /api/v1/me/**. Il token di
// sessione nudo (senza firma) NON vale: 401. L'app non manda Origin e NON
// manda cookie (URLSession effimera, oppure fetch con credentials 'omit'):
// con un Cookie il server tratta la richiesta come un browser e pretende
// Origin sulle scritture, e sulle rotte /api/auth/* il controllo di Origin di
// Better Auth si attiva da solo. Stessa sessione del web: 60 giorni, rinnovata
// al massimo una volta al giorno all'uso, revocabile dall'elenco in /account.
// Uscire: POST /api/auth/sign-out con il solo bearer e il corpo JSON `{}` (un corpo vuoto con
// Content-Type JSON e' un 400 di Better Auth); la sessione sparisce dal server e il bearer da' 401.
//
// Apple (Fase 27, MOB-05). Dopo l'accesso nativo con Apple l'app manda UNA volta, subito (il codice
// vale una volta sola e per pochi minuti), POST /api/v1/me/apple-token con il solo bearer e il corpo
// {"authorizationCode": "<codice>"}: 200 {stored:true}. Qualunque errore (400, 404, 409, 502, 500)
// non e' fatale per l'accesso e significa solo che, all'eliminazione dell'account, Apple non viene
// revocata. Eliminare l'account: POST /api/auth/delete-user con il solo bearer e il corpo `{}`.
//
// Metodi di accesso (Fase 27, UAT 2). Da loggata, l'app collega o scollega Apple/Google con le rotte di Better Auth,
// col solo bearer: GET /api/auth/list-accounts ([{id, providerId, ...}], mai token), POST /api/auth/link-social con
// {"provider", "idToken": {"token", "nonce"}} (nessun callbackURL: niente giro nel browser) e POST /api/auth/unlink-account
// con {"accountId": <id della RIGA>}. Il server verifica l'id token (AUTH-07: nessun collegamento implicito, serve la
// sessione). Un 401 con code INVALID_TOKEN e' un id token rifiutato, NON una sessione scaduta: l'app resta dentro; solo
// UNAUTHORIZED (o nessun code) vuol dire sessione finita. L'ultimo metodo non si scollega (400 lato server).
//
// Piano e funzioni (D-04). GET /api/v1/me/state, da loggati, aggiunge `plan` e
// `features`. Oggi ogni account e' `plan: 'beta'` con TUTTE le funzioni sotto
// elencate: non esiste una tabella di abbonamenti, ne' un'applicazione di queste
// regole, e niente di tutto cio' condiziona la scoperta degli eventi (D-01:
// ricerca, mappa, pagine evento, calendario e condivisione sono gratuiti per
// sempre). Aggiungere un valore in futuro e' gratis; RINOMINARE o TOGLIERE una
// chiave o un valore rompe le build gia' installate.

export const PLAN = 'beta' as const

export const FEATURES = ['saved', 'follows', 'calendar-feed', 'share', 'push'] as const
export type Feature = (typeof FEATURES)[number]

// User-Agent dell'app (D-13). Convenzione "FuoriRotta/<versione> (<piattaforma>; <dispositivo>)",
// con piattaforma iOS|Android e dispositivo iPhone|iPad|Android, p.es. "FuoriRotta/1.0.0 (iOS; iPhone)".
// L'app DEVE impostarlo: quello predefinito di URLSession/CFNetwork non contiene il nome del
// dispositivo e la sessione finirebbe in /account come "Browser sconosciuto". Better Auth salva lo
// user agent solo quando la sessione nasce (all'accesso): va impostato prima di accedere.
export const APP_USER_AGENT_RE = /^FuoriRotta\/\d+(?:\.\d+){0,3} \((?:iOS|Android); (iPhone|iPad|Android)\)/

// Notifiche push (Fase 26, API-03). PUT /api/v1/me/devices {token, environment, appVersion?} registra
// o aggiorna il dispositivo, DELETE /api/v1/me/devices {token} lo toglie; il token va SOLO nel corpo JSON,
// mai in percorso o query. L'app manda il PUT a OGNI avvio: Apple dice di non memorizzare il token, ne
// puo' arrivare uno nuovo a ogni lancio. `environment` lo decide la build: 'sandbox' per Xcode/sviluppo,
// 'production' per TestFlight e App Store. Il token e' esadecimale, 64-200 caratteri (Apple dice di non
// assumere la lunghezza); il server lo salva in minuscolo. Uscendo dall'app: DELETE prima di buttare il
// bearer (il server comunque cancella a cascata i dispositivi della sessione che si chiude). Al massimo
// 10 dispositivi per account: l'11esimo registrato fa sparire quello visto meno di recente.
export const APNS_ENVIRONMENTS = ['sandbox', 'production'] as const
export type ApnsEnvironment = (typeof APNS_ENVIRONMENTS)[number]
export const APNS_TOKEN_RE = /^[0-9a-fA-F]{64,200}$/
export const DEVICE_CAP = 10
export type DeviceRegistration = { token: string; environment: ApnsEnvironment; appVersion?: string }

// Salvati (Fase 27, UAT 5). GET /api/v1/me/saved e POST /api/v1/saved/resolve ({ids}, pubblica) rispondono
// {items: [...]}. Ogni voce ha anche `imageUrl`: la foto dell'evento vivo (events.image_url, composta come sulla pagina
// evento), `null` se l'evento non ha foto o la riga non esiste piu' (`eventId` null). Fa parte della voce, NON di
// `snap`/`live` (l'istantanea resta senza immagine, per scelta). Aggiunta compatibile: i client che non la
// conoscono la ignorano. Le chiavi di una voce sono quelle elencate sotto: il gate le confronta con le risposte vere.
export const SAVED_LIST_ITEM_KEYS = ['ref', 'eventId', 'savedAt', 'snap', 'live', 'imageUrl', 'siblings'] as const
export const SAVED_RESOLVE_ITEM_KEYS = ['ref', 'eventId', 'live', 'imageUrl', 'siblings'] as const

// Dettaglio evento (Fase 27, UAT7 B1). GET /api/events/{id} porta anche `comune`: {istatCode, name, provinceCode,
// provinceName} del comune agganciato, `null` se l'evento non ne ha (circa un terzo). E' cio' che serve all'app per
// "Segui" comune (kind 'comune', key = istatCode) e provincia (kind 'province', key = provinceCode) con le chiavi del
// sito. Aggiunta compatibile; le chiavi sono queste, il gate (check:mobile-api, E1) le confronta con la risposta vera.
export const EVENT_COMUNE_KEYS = ['istatCode', 'name', 'provinceCode', 'provinceName'] as const

// Zona della Home e "Dove" della Ricerca (Fase 27, UAT7 C3). L'app cerca un comune qualsiasi con GET /api/comuni/search
// (la stessa del campo Dove del sito) e lo usa come CENTRO: lat/lng arrotondati a 2 decimali + radius su /api/events,
// mai il filtro per comune (e' il ramo che puo' avviare uno scraping). Per questo ogni risultato porta anche `latitude` e
// `longitude` del comune (numeri, null se il comune non ha un punto: l'app non lo offre). Aggiunta compatibile; le chiavi
// sono queste, il gate (check:mobile-api, Z1) le confronta con la risposta vera.
export const COMUNE_SEARCH_ITEM_KEYS = ['id', 'istatCode', 'name', 'provinceName', 'regionName', 'latitude', 'longitude'] as const

// Politica di versione (Fase 26, API-04). GET /api/v1/config[?version=1.4.0] e' pubblica: niente
// sessione, niente database. Per l'app: `update-required` = schermata bloccante "Aggiorna";
// `update-recommended` = avviso che si puo' chiudere; `ok` o nessun `status` (versione mancante o
// illeggibile) = si procede. Il minimo si alza SOLO per un cambio incompatibile dell'API, vale anche
// in TestFlight (D-07). Le soglie sono variabili d'ambiente del server (D-06): si cambiano senza
// una release, e una soglia vuota o malformata e' `null` e non blocca nessuno. Una versione e' da 1 a
// 4 interi separati da punto (1.4, 1.4.0, 1.10.2.1); si confronta componente per componente.
export type VersionStatus = 'ok' | 'update-recommended' | 'update-required'
export type AppConfig = { minimumVersion: string | null; recommendedVersion: string | null; status?: VersionStatus }

// Link universali (API-05): i percorsi del sito che iOS apre nell'app. Sono pagine vere
// (app/eventi/[id] e app/l/[token]); cambiarli non richiede una release, ma la CDN di Apple tiene
// il file in cache.
export const UNIVERSAL_LINK_PATHS = ['/eventi/*', '/l/*'] as const
