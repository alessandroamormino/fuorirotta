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
// D-08 in lib/dedup/dedupe.ts.
//
// Vale SOLO per il gradino 2: il gradino 1 (match esatto sul titolo
// normalizzato) non legge mai questa costante — e' questa separazione a
// rendere i duplicati certi indipendenti da un numero (D-08).
//
// Misurata il 2026-08-22 con `bash scripts/dev-db.sh npx tsx
// scripts/dedup-threshold-check.ts --report` sulle coppie di
// scripts/dedup-fixtures.ts che il gradino 1 non risolve gia' (stesso comune,
// stesso giorno, titoli diversi):
// - max_no_merge = 0.5152, fissato da `sulzano-street-food-vs-music-festival`
//   (SULZANO STREET FOOD FESTIVAL / Sulzano Music Festival — stesso comune e
//   giorno, eventi realmente distinti: la coppia che decide la soglia);
// - min_merge = 0.5625, fissato da `sagra-dell-offella` (SAGRA DELL'OFFELLA /
//   Sagra dell'Offella di Parona 2026 — stesso evento, la seconda sorgente
//   aggiunge solo toponimo e anno).
// L'intervallo (0.5152, 0.5625] separa le due etichette: il valore scelto,
// 0.56, sta dentro l'intervallo e vicino all'estremo alto (piu' vicino a
// min_merge che a max_no_merge) — nel dubbio non si fonde, quindi una coppia
// al confine resta separata piuttosto che fusa per errore.
export const TITLE_SIMILARITY_THRESHOLD = 0.56
