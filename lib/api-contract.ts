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
