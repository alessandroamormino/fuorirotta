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
