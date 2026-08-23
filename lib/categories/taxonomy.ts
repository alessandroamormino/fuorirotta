/**
 * Tassonomia canonica delle categorie (Fase 11, D-01..D-06).
 *
 * Modulo puro: nessun accesso al database, nessuna funzione asincrona. Legge
 * solo i dati dichiarativi di SOURCE_REGISTRY (Fase 8/10), esattamente come
 * lib/dedup/compose.ts legge trustRank per la composizione a lettura.
 */
import { getSourceById, SOURCE_REGISTRY } from '../scrapers/registry'

// I 7 nomi canonici, in ordine di volume misurato (D-01). 'Altro' e' sempre
// l'ultimo per posizione dichiarata, non per conteggio (orderCategories sotto
// lo forza comunque in ultima posizione a runtime).
export const CANONICAL_CATEGORIES = [
  'Sagre e feste',
  'Musica e spettacolo',
  'Arte e cultura',
  'Fiere e mercati',
  'Sport e outdoor',
  'Food & Wine',
  'Altro'
] as const

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number]

// D-06: scarto (categoria assente/vuota) e non-ancora-mappato (categoria
// presente ma sconosciuta al categoryMap della sorgente) sono DELIBERATAMENTE
// la stessa voce, cosi' il conteggio resta una metrica sola. D-11: questo
// conteggio e' l'UNICO segnale di deriva che questa fase possiede — nessun
// gate di test dedicato, nessuno stato 'degraded' per sorgente.
export const FALLBACK_CATEGORY: CanonicalCategory = 'Altro' as const

// Deduplica i warning per (source, rawValue): un unico avviso per coppia
// distinta durante la vita del processo, non uno per ogni evento che porta
// quel valore grezzo.
const warnedPairs = new Set<string>()

/**
 * Risolve (source, rawCategory) sul nome canonico dichiarato in
 * SOURCE_REGISTRY[source].categoryMap. Pura e sincrona: nessun accesso al
 * database.
 *
 * Il valore grezzo viene sempre trimmato prima del lookup: lib/scrapers/
 * inlombardia.ts:331-332 decodifica le entita' HTML con he.decode ma non
 * trimma, quindi uno spazio residuo instraderebbe un valore correttamente
 * mappato verso Altro, indistinguibile da una deriva reale (D-11).
 */
export function canonicalizeCategory(
  source: string,
  rawCategory: string | null | undefined
): CanonicalCategory {
  const trimmed = rawCategory?.trim()
  if (!trimmed) {
    // Caso (a) CAT-04: assente/vuoto/solo spazi. Non e' un segnale di deriva,
    // e' l'assenza stessa del dato — nessun warning.
    return FALLBACK_CATEGORY
  }

  const entry = getSourceById(source)
  const mapped = entry?.categoryMap[trimmed]
  if (mapped) {
    return mapped as CanonicalCategory
  }

  // Caso (b) CAT-04: valore presente ma non mappato (sorgente sconosciuta o
  // categoryMap senza quella chiave). E' il segnale di deriva che D-11
  // dichiara essere l'unico strumento diagnostico della fase.
  const pairKey = `${source}|${trimmed}`
  if (!warnedPairs.has(pairKey)) {
    warnedPairs.add(pairKey)
    console.warn(
      `[taxonomy] categoria non mappata: source=${source} rawValue="${trimmed}" -> fallback ${FALLBACK_CATEGORY}`
    )
  }
  return FALLBACK_CATEGORY
}

/**
 * Ordina le categorie per CAT-01: conteggio decrescente, pareggio risolto
 * alfabeticamente, 'Altro' sempre ultima indipendentemente dal conteggio.
 * Senza un tiebreak esplicito l'ordine dipenderebbe dal query plan di
 * Postgres e la riga dei chip potrebbe rimescolarsi fra due refetch.
 *
 * Non muta l'argomento: restituisce sempre un nuovo array.
 */
export function orderCategories(
  counts: { name: string; count: number }[]
): { name: string; count: number }[] {
  return [...counts].sort((a, b) => {
    if (a.name === FALLBACK_CATEGORY) return 1
    if (b.name === FALLBACK_CATEGORY) return -1
    if (b.count !== a.count) return b.count - a.count
    return a.name.localeCompare(b.name)
  })
}

// Self-check: `npx tsx lib/categories/taxonomy.ts`. Nessun accesso al
// database: il modulo e' puro e il self-check deve restare eseguibile senza
// container, stesso idioma di lib/dedup/compose.ts.
if (require.main === module) {
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
    console.error(`[taxonomy.ts] self-check FALLITO: ${failures} asserzioni non superate`)
    process.exit(1)
  }
  console.log('[taxonomy.ts] self-check OK')
}
