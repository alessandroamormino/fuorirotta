/**
 * Event scrapers barrel export
 *
 * Exports all scraper functions and types for easy imports:
 * import { scrapeSoloSagreForRegion, scrapeOpenData, scrapeInLombardia } from '@/lib/scrapers'
 */

export { scrapeSoloSagreForRegion } from './solosagre'
export { scrapeOpenData } from './opendata'
export { scrapeInLombardia } from './inlombardia'
// IN-02 (Fase 15 review): mancavano da questo barrel nonostante il docstring
// dichiari "tutte" le sorgenti — nessun consumatore reale le importa da qui
// oggi (registry.ts importa gli adattatori direttamente), ma tenerle fuori
// contraddiceva il commento sopra e avrebbe sorpreso il prossimo import.
export { scrapeEmiliaRomagna } from './emiliaromagna'
export { scrapePuglia } from './puglia'
export { saveEvents, logMetrics } from './utils'
// runAllScrapers cancellata (14-01 -> 14-05, D-01/D-08): l'ultimo chiamante
// rimasto (app/api/events/route.ts, refresh da traffico) e' stato migrato a
// runRegion in 14-05. Nessuna route sotto app/ puo' piu' avviare uno scrape
// non vincolato a una regione.
// isHostBusyForRegion (CR-02, Fase 15 review): controllo cross-regione a
// livello di host per il refresh on-demand, vedi lib/scrapers/runner.ts.
export { runRegion, getRegions, getSourcesByRegion, isHostBusyForRegion } from './runner'
export type { ScrapedEvent, ScrapeParams, ScrapeResult } from './types'
