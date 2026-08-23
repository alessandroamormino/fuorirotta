/**
 * Self-check di lib/categories/taxonomy.ts: `npx tsx lib/categories/taxonomy.selfcheck.ts`.
 *
 * File separato, non importato da alcun codice applicativo: taxonomy.ts e'
 * importato anche da componenti client (CategoryFilterBar.tsx) e deve restare
 * un modulo puro compilabile nel bundle browser, senza `require`/`module`. Il
 * self-check resta Node-only per design e vive qui apposta (idioma diverso da
 * lib/dedup/compose.ts, che e' server-only e puo' tenere il self-check inline).
 */
import {
  CANONICAL_CATEGORIES,
  FALLBACK_CATEGORY,
  canonicalizeCategory,
  orderCategories,
  type CanonicalCategory
} from './taxonomy'
import { SOURCE_REGISTRY } from '../scrapers/registry'

let failures = 0
const assert = (condition: boolean, message: string) => {
  console.assert(condition, message)
  if (!condition) failures++
}

// I 17 valori grezzi verificati, dalle tre sorgenti (RESEARCH.md §Code Examples).
const verifiedPairs: [string, string, CanonicalCategory][] = [
  ['solosagre', 'Sagra', 'Sagre e feste'],
  ['opendata_lombardia', 'Sagra', 'Sagre e feste'],
  ['opendata_lombardia', 'Fiera', 'Fiere e mercati'],
  ['in-lombardia', 'Musica e spettacolo', 'Musica e spettacolo'],
  ['in-lombardia', 'Arte e Cultura', 'Arte e cultura'],
  ['in-lombardia', 'Turismo religioso', 'Arte e cultura'],
  ['in-lombardia', 'Food & Wine', 'Food & Wine'],
  ['in-lombardia', 'Sport', 'Sport e outdoor'],
  ['in-lombardia', 'Active & Green', 'Sport e outdoor'],
  ['in-lombardia', 'Montagne', 'Sport e outdoor'],
  ['in-lombardia', 'Cicloturismo', 'Sport e outdoor'],
  ['in-lombardia', 'Parchi', 'Sport e outdoor'],
  ['in-lombardia', 'Laghi', 'Sport e outdoor'],
  ['in-lombardia', 'Itinerari', 'Sport e outdoor'],
  ['in-lombardia', 'Lifestyle', 'Altro'],
  ['in-lombardia', 'Borghi', 'Altro'],
  ['in-lombardia', 'Top Events', 'Altro'],
  ['in-lombardia', 'Wellness', 'Altro']
]
for (const [source, raw, expected] of verifiedPairs) {
  assert(
    canonicalizeCategory(source, raw) === expected,
    `canonicalizeCategory('${source}', '${raw}') deve restituire '${expected}'`
  )
}

// La stessa stringa grezza da due sorgenti diverse risolve attraverso la
// mappa della propria sorgente (D-10, adiacenza CAT-02).
assert(
  canonicalizeCategory('opendata_lombardia', 'Sagra') === 'Sagre e feste' &&
    canonicalizeCategory('solosagre', 'Sagra') === 'Sagre e feste',
  "'Sagra' da opendata_lombardia e da solosagre devono risolvere entrambe a 'Sagre e feste' attraverso mappe distinte"
)

// CAT-04 caso (a): assente/vuoto/solo spazi -> Altro, senza eccezioni.
assert(
  canonicalizeCategory('in-lombardia', null) === 'Altro',
  "canonicalizeCategory('in-lombardia', null) deve restituire 'Altro'"
)
assert(
  canonicalizeCategory('in-lombardia', '') === 'Altro',
  "canonicalizeCategory('in-lombardia', '') deve restituire 'Altro'"
)
assert(
  canonicalizeCategory('in-lombardia', '   ') === 'Altro',
  "canonicalizeCategory('in-lombardia', '   ') deve restituire 'Altro'"
)

// CAT-04 caso (b): valore presente ma non mappato -> Altro (deriva).
assert(
  canonicalizeCategory('in-lombardia', 'Categoria Mai Vista') === 'Altro',
  "canonicalizeCategory('in-lombardia', 'Categoria Mai Vista') deve restituire 'Altro'"
)

// Sorgente non dichiarata -> Altro, mai un'eccezione, mai un evento perso.
assert(
  canonicalizeCategory('sorgente-inesistente', 'Sagra') === 'Altro',
  "canonicalizeCategory('sorgente-inesistente', 'Sagra') deve restituire 'Altro'"
)

// WR-01: un valore grezzo che coincide con una proprieta' ereditata da
// Object.prototype non deve mai "matchare" — un `entry?.categoryMap[x]` senza
// hasOwnProperty restituirebbe la funzione ereditata invece di undefined,
// bypassando sia il fallback Altro sia il warning di deriva (D-11). Ogni
// sorgente reale di SOURCE_REGISTRY viene provata, non solo una a campione.
const prototypePollutionKeys = [
  'constructor',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString'
]
for (const entry of SOURCE_REGISTRY) {
  for (const key of prototypePollutionKeys) {
    assert(
      canonicalizeCategory(entry.id, key) === 'Altro',
      `canonicalizeCategory('${entry.id}', '${key}') deve restituire 'Altro', non una proprieta' ereditata da Object.prototype`
    )
  }
}

// Spazi circostanti non devono gonfiare il bucket Altro.
assert(
  canonicalizeCategory('opendata_lombardia', '  Sagra ') === 'Sagre e feste',
  "canonicalizeCategory('opendata_lombardia', '  Sagra ') deve restituire 'Sagre e feste' (trim sulla chiave)"
)

// Ogni valore di ogni categoryMap deve essere un membro di CANONICAL_CATEGORIES.
for (const entry of SOURCE_REGISTRY) {
  for (const [raw, canonical] of Object.entries(entry.categoryMap)) {
    assert(
      (CANONICAL_CATEGORIES as readonly string[]).includes(canonical),
      `categoryMap['${entry.id}']['${raw}'] = '${canonical}' non e' un nome canonico dichiarato`
    )
  }
}

// orderCategories: decrescente per count, pareggio alfabetico, Altro sempre ultima.
const fixtureWithTie = [
  { name: 'Fiere e mercati', count: 50 },
  { name: 'Altro', count: 999 },
  { name: 'Sport e outdoor', count: 50 },
  { name: 'Sagre e feste', count: 100 }
]
const ordered = orderCategories(fixtureWithTie)
assert(
  JSON.stringify(ordered.map((c) => c.name)) ===
    JSON.stringify(['Sagre e feste', 'Fiere e mercati', 'Sport e outdoor', 'Altro']),
  `orderCategories deve dare precedenza al conteggio decrescente, pareggio alfabetico, Altro sempre ultima nonostante il conteggio piu' alto, ottenuto: ${JSON.stringify(ordered.map((c) => c.name))}`
)
const orderedAgain = orderCategories(fixtureWithTie)
assert(
  JSON.stringify(ordered) === JSON.stringify(orderedAgain),
  'orderCategories deve essere idempotente su input identico'
)
assert(
  fixtureWithTie[0].name === 'Fiere e mercati',
  "orderCategories non deve mutare l'array argomento"
)

if (failures > 0) {
  console.error(`[taxonomy.selfcheck.ts] self-check FALLITO: ${failures} asserzioni non superate`)
  process.exit(1)
}
console.log('[taxonomy.selfcheck.ts] self-check OK')
