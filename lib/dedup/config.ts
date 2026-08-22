/**
 * Costanti di taratura del passo di dedup, dichiarate in un posto solo (D-09):
 * ne' `dedupe.ts` ne' `scripts/dedup-events.ts` ridichiarano questi valori.
 */

// Un bucket (comuneId, giorno) con piu' di MAX_BUCKET_SIZE righe viene saltato
// per intero (contato in `bucketsSkipped`, mai confrontato a coppie): il
// confronto a coppie e' quadratico, e un solo bucket patologico bloccherebbe
// l'intero passo (T-10-02, Denial of Service). Sul dataset locale il bucket
// piu' grande oggi ha 8 righe, quindi il tetto non scatta mai su dati reali:
// esiste per il caso in cui una sorgente futura pubblichi migliaia di righe
// nello stesso comune e nello stesso giorno.
export const MAX_BUCKET_SIZE = 200
