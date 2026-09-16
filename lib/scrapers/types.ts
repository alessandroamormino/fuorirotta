/**
 * Common types for event scraping functionality
 *
 * ScrapedEvent shape matches the Prisma Event model for easy database insertion
 */

export interface ScrapedEvent {
  source: string
  sourceId: string
  title: string
  description: string | null
  dateStart: Date
  dateEnd: Date | null
  locationName: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  category: string | null
  sourceUrl: string | null
  imageUrl: string | null
  phone: string | null
  /**
   * L'evento e' stato costruito SENZA scaricare la sua pagina di dettaglio,
   * perche' il dettaglio era gia' in database (vedi
   * `ScrapeParams.detailCachedUrls`). I campi che vivono solo nel dettaglio
   * — description, phone, latitude, longitude — e quelli che il dettaglio
   * migliora — locationName, address, imageUrl — qui valgono null o la
   * versione povera letta dalla lista: `saveEvents` NON deve scriverli, o
   * cancellerebbe dati buoni gia' salvati. Assente/false = evento completo.
   */
  detailSkipped?: boolean
}

export interface ScrapeParams {
  dateFrom?: string // YYYY-MM-DD format
  dateTo?: string   // YYYY-MM-DD format
  /**
   * `sourceUrl` degli eventi il cui dettaglio e' gia' in database e non va
   * riscaricato. Il costo di uno scrape e' aritmetico — numero di richieste x
   * Crawl-delay dell'host — quindi l'unica leva che lo riduce senza violare
   * il robots.txt e' fare meno richieste. Chi popola questo insieme e' il
   * runner (unico a parlare col database): gli adattatori restano puri.
   *
   * Assente = scarica tutto, che e' il comportamento storico e resta quello
   * del refresh completo settimanale.
   */
  detailCachedUrls?: Set<string>
}

export interface ScrapeResult {
  events: ScrapedEvent[]
  source: string
  region: string
  duration: number // milliseconds
  error?: string
}

// Gli adapter non conoscono la propria regione: e' il registry (SRC-01) ad assegnarla.
// L'obbligatorieta' di `region` su ScrapeResult fa si' che il compilatore garantisca che
// nessun risultato arrivi allo storico scrape_runs senza regione.
export type AdapterResult = Omit<ScrapeResult, 'region'>

export interface RunResult {
  saved: number
  skipped: number
  total: number
  errors: string[]
}
