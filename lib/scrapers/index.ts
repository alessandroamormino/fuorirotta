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
export { runAllScrapers } from './runner'
export type { ScrapedEvent, ScrapeParams, ScrapeResult } from './types'
