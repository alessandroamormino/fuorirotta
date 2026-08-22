/**
 * Normalizzazione dei titoli evento per il gradino 1 (esatto) del matching di
 * dedup (D-08): minuscole, forma NFD, diacritici rimossi, apostrofi tipografici
 * e dritti collassati in spazio, punteggiatura residua collassata in spazio,
 * spazi multipli collassati, trim.
 *
 * Riusa SOLO la parte generica di `lib/territorial/normalize.ts` (minuscolo,
 * NFD, strip diacritici, punteggiatura -> spazio, collasso spazi, trim). Le
 * due regole specifiche ai toponimi di quel file (espansione di "S." in "san",
 * riduzione di "Sant'" senza apostrofo) NON vengono portate qui: su un titolo
 * evento trasformerebbero ad esempio "S. Valentino in Musica" in una forma che
 * puo' collidere per caso con un evento che comincia davvero con quella
 * parola. `lib/territorial/normalize.ts` non viene toccato: la cascata
 * territoriale della Fase 6 e' verificata e non va modificata per questo scopo.
 *
 * Guardia obbligatoria (D-08): se il risultato normalizzato e' stringa vuota,
 * il titolo e' NON confrontabile. Questa funzione non impone da sola
 * l'esclusione del match fra due stringhe vuote — quella regola vive nel
 * chiamante del gradino 1 (`matchPair` in `dedupe.ts`), perche' e' li' che si
 * decide se due titoli "combaciano".
 *
 * Nessun import di Prisma: funzione pura.
 */

export function normalizeTitle(raw: string): string {
  if (!raw) return ''

  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritici combinanti (à→a, è→e, ù→u, ecc.)
    .replace(/['’`]/g, ' ') // apostrofo dritto e tipografico (U+2019) -> spazio
    .replace(/[^a-z0-9\s]/g, ' ') // punteggiatura residua -> spazio
    .replace(/\s+/g, ' ')
    .trim()
}

// Self-check: `npx tsx lib/dedup/normalizeTitle.ts`.
// Non un framework di test, solo un demo() con assert che fallisce rumorosamente.
if (require.main === module) {
  console.assert(
    normalizeTitle('SAGRA DELLA BRUSADELA') === normalizeTitle('sagra della brusadela'),
    'insensibilita alle maiuscole: SAGRA DELLA BRUSADELA deve normalizzare come sagra della brusadela'
  )

  console.assert(
    normalizeTitle('Sagra della Brüsadèla') === 'sagra della brusadela',
    `insensibilita ai diacritici: atteso 'sagra della brusadela', ottenuto '${normalizeTitle('Sagra della Brüsadèla')}'`
  )

  // Edge encoding (D-08): la stessa parola in NFC e in NFD deve normalizzare
  // alla stessa chiave. Costruita via normalize() e non digitando il
  // carattere accentato, cosi' la differenza fra le due forme non dipende
  // dall'encoding dell'editor che ha scritto questo file.
  const uUmlautBase = 'Br' + String.fromCharCode(0x00fc) + 'sadela' // 'ü' precomposta (U+00FC)
  const uUmlautNFC = uUmlautBase.normalize('NFC')
  const uUmlautNFD = uUmlautBase.normalize('NFD')
  console.assert(
    uUmlautNFC !== uUmlautNFD && normalizeTitle(uUmlautNFC) === normalizeTitle(uUmlautNFD),
    'la stessa parola in NFC e NFD deve normalizzare alla stessa chiave'
  )

  console.assert(
    normalizeTitle('!!!') === '',
    "il collasso di punteggiatura pura ('!!!') deve produrre stringa vuota"
  )

  // Una forma abbreviata puntata NON deve essere espansa: a differenza del
  // normalizzatore dei toponimi territoriali, qui "S." resta "s" e basta, non
  // diventa "san" (vedi header sul motivo per cui questa regola non e' portata qui).
  console.assert(
    normalizeTitle('S. Valentino in Musica') === 's valentino in musica',
    `"S." non deve espandersi a "san" nei titoli evento, ottenuto '${normalizeTitle('S. Valentino in Musica')}'`
  )

  console.log('[normalizeTitle.ts] self-check OK')
}
