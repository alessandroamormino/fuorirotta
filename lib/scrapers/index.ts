/**
 * Event scrapers barrel export
 *
 * Exports all scraper functions and types for easy imports:
 * import { scrapeSoloSagre, scrapeOpenData, scrapeInLombardia } from '@/lib/scrapers'
 */

export { scrapeSoloSagre } from './solosagre'
export { scrapeOpenData } from './opendata'
export { scrapeInLombardia } from './inlombardia'
export { saveEvents, logMetrics } from './utils'
// runAllScrapers cancellata (14-01 -> 14-05, D-01/D-08): l'ultimo chiamante
// rimasto (app/api/events/route.ts, refresh da traffico) e' stato migrato a
// runRegion in 14-05. Nessuna route sotto app/ puo' piu' avviare uno scrape
// non vincolato a una regione.
export { runRegion, getRegions, getSourcesByRegion } from './runner'
export type { ScrapedEvent, ScrapeParams, ScrapeResult } from './types'
