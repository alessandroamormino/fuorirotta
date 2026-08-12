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
}

export interface ScrapeParams {
  dateFrom?: string // YYYY-MM-DD format
  dateTo?: string   // YYYY-MM-DD format
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
