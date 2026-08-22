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

// Soglia di similarita' del titolo per il gradino 2 (pg_trgm) della cascata
// D-08 in lib/dedup/dedupe.ts. VALORE PROVVISORIO: il Task 2 di questo piano
// (10-03) la sostituisce con il valore misurato sulla fixture etichettata
// (scripts/dedup-fixtures.ts) via scripts/dedup-threshold-check.ts --report.
//
// Vale SOLO per il gradino 2: il gradino 1 (match esatto sul titolo
// normalizzato) non legge mai questa costante — e' questa separazione a
// rendere i duplicati certi indipendenti da un numero (D-08). Nel dubbio non
// si fonde: la soglia si tiene alta, e una coppia vicino al confine resta
// separata piuttosto che fusa per errore.
export const TITLE_SIMILARITY_THRESHOLD = 0.85
