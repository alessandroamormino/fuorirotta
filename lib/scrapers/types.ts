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
}

export interface ScrapeParams {
  dateFrom?: string // YYYY-MM-DD format
  dateTo?: string   // YYYY-MM-DD format
}

export interface ScrapeResult {
  events: ScrapedEvent[]
  source: string
  duration: number // milliseconds
  error?: string
}

export interface RunResult {
  saved: number
  skipped: number
  total: number
  errors: string[]
}
