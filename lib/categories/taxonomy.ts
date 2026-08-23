/**
 * Tassonomia canonica delle categorie (Fase 11, D-01..D-06).
 *
 * Modulo puro: nessun accesso al database, nessuna funzione asincrona, nessun
 * idioma Node-only (require/module). Legge solo i dati dichiarativi di
 * SOURCE_REGISTRY (Fase 8/10). E' importato anche da componenti client (es.
 * CategoryFilterBar.tsx) e deve restare sicuro nel bundle browser — il
 * self-check vive separato in lib/categories/taxonomy.selfcheck.ts.
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

  // WR-01: NON `entry?.categoryMap[trimmed]`. Se `trimmed` coincide con una
  // proprieta' ereditata da Object.prototype ('constructor', 'toString',
  // 'hasOwnProperty', ecc.), quel lookup restituirebbe la funzione ereditata
  // invece di undefined, bypassando sia il fallback Altro sia il warning di
  // deriva (D-11) — e un valore non-stringa arriverebbe a Prisma come
  // canonicalCategory. hasOwnProperty esclude sempre la catena di prototipo.
  const entry = getSourceById(source)
  const mapped =
    entry && Object.prototype.hasOwnProperty.call(entry.categoryMap, trimmed)
      ? entry.categoryMap[trimmed]
      : undefined
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
