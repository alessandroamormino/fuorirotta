/**
 * Normalizzazione del nome di un comune per il gradino 2 della cascata di
 * matching (D-05): minuscole, diacritici rimossi (forma NFD), forme abbreviate
 * di "Sant'"/"S." unificate, punteggiatura residua collassata in spazi.
 *
 * Nessun import di Prisma: funzione pura, riceve una stringa e ne restituisce
 * un'altra. La lettura dal database resta responsabilita' del chiamante.
 */

export function normalizeComuneName(raw: string): string {
  if (!raw) return ''

  return raw
    .toLowerCase()
    // opendata_lombardia scrive spesso in maiuscolo (VALDIDENTRO): il lowercase
    // sopra e' gia' sufficiente a farlo combaciare con "Valdidentro".
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritici combinanti (à→a, ò→o, ù→u, ecc.)
    .replace(/['’`]/g, ' ') // apostrofo dritto e tipografico (U+2019) -> spazio
    .replace(/\bs\.\s*/g, 'san ') // "S. Angelo" -> "san angelo"
    .replace(/\bsant\b/g, 'san') // "Sant Angelo" (dopo lo strip dell'apostrofo) -> "san angelo"
    .replace(/[^a-z0-9\s]/g, ' ') // punteggiatura residua -> spazio
    .replace(/\s+/g, ' ')
    .trim()
}

// Self-check: `npx tsx lib/territorial/normalize.ts`.
// Non un framework di test, solo un demo() con assert che fallisce rumorosamente.
if (require.main === module) {
  const santAngeloForms = [
    normalizeComuneName("Sant'Angelo"),
    normalizeComuneName('Sant’Angelo'), // apostrofo tipografico U+2019
    normalizeComuneName('S. Angelo'),
    normalizeComuneName('SANT ANGELO'),
  ]
  console.assert(
    new Set(santAngeloForms).size === 1,
    `le quattro forme di Sant'Angelo devono normalizzare alla stessa chiave, ottenuto: ${JSON.stringify(santAngeloForms)}`
  )

  console.assert(
    normalizeComuneName('VALDIDENTRO') === normalizeComuneName('Valdidentro'),
    'VALDIDENTRO (tutto maiuscolo, opendata_lombardia) deve normalizzare come Valdidentro'
  )

  console.assert(
    !/[À-ÿ]/.test(normalizeComuneName('Cantù')),
    "normalizeComuneName('Cantù') non deve contenere diacritici"
  )
  console.assert(normalizeComuneName('Cantù') === 'cantu', "atteso 'cantu'")

  console.assert(normalizeComuneName('') === '', 'stringa vuota non deve lanciare e deve restituire vuoto')

  // Comuni il cui nome inizia per "Sant"/"Santa" senza essere una forma di "Sant'"
  // non devono essere alterati: la parola intera deve combaciare, non il prefisso.
  console.assert(normalizeComuneName('Santena') === 'santena', "'Santena' non deve diventare 'sanena'")
  console.assert(normalizeComuneName('Santa Maria') === 'santa maria', "'Santa Maria' non deve perdere la 'a' finale")

  console.log('[normalize.ts] self-check OK')
}
