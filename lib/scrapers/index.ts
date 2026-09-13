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
// runAllScrapers NON e' riesportata (14-01, D-01): resta raggiungibile solo
// come `import { runAllScrapers } from './runner'`, mai da questo barrel, cosi'
// nessuna route sotto app/ puo' piu' avviare uno scrape non vincolato a una
// regione passando dal barrel pubblico.
export { runRegion, getRegions, getSourcesByRegion } from './runner'
export type { ScrapedEvent, ScrapeParams, ScrapeResult } from './types'
