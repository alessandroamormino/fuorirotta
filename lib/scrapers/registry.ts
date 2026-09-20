/**
 * Registry ESEGUIBILE delle sorgenti: metadati (lib/scrapers/sources.ts) uniti
 * alle funzioni di scrape.
 *
 * Aggiungere una sorgente richiede due tocchi, non uno: la voce in `SOURCE_META`
 * (lib/scrapers/sources.ts) e la funzione in `SCRAPERS` qui sotto. Il join
 * fallisce rumorosamente al caricamento del modulo se i due insiemi divergono,
 * quindi non e' possibile dimenticarne uno in silenzio — e' il prezzo
 * deliberato per tenere i metadati importabili senza cheerio e senza Prisma.
 *
 * IMPORTA QUESTO FILE SOLO SE DEVI ESEGUIRE UNO SCRAPE. L'unico consumatore
 * legittimo e' lib/scrapers/runner.ts. Chi legge metadati (regione, trustRank,
 * categoryMap, schedule) importa lib/scrapers/sources.ts, che non tira dentro
 * ne' un parser HTML ne' uno stack HTTP ne' Prisma — vedi l'intestazione di
 * quel file per le due volte in cui questa distinzione e' costata un guasto in
 * produzione (bundle browser e host Node 18).
 */

import { scrapeSoloSagreForRegion } from './solosagre'
import { scrapeOpenData } from './opendata'
import { scrapeInLombardia } from './inlombardia'
import { scrapeEmiliaRomagna } from './emiliaromagna'
import { scrapePuglia } from './puglia'
import { scrapeAltoAdige } from './altoadige'
import { scrapeFirenze } from './firenze'
import { scrapeTorino } from './torino'
import type { AdapterResult, ScrapeParams } from './types'
import { SOURCE_META, type SourceMeta } from './sources'

export type { SourceType } from './sources'
export {
  SOURCE_META,
  REGION_SCHEDULES,
  MAINTENANCE_SCHEDULE,
  getSourceMetaById,
  getRegions,
} from './sources'

export type ScrapeFn = (params?: ScrapeParams) => Promise<AdapterResult>

export interface SourceRegistryEntry extends SourceMeta {
  scrape: ScrapeFn
}

/**
 * Fabbrica per id, non piu' una funzione fissa (Fase 15, SRC-04): venti entry
 * SoloSagre condividono lo stesso id ('solosagre', scritto in produzione in
 * `events.source` — non si tocca), quindi la funzione di scrape non puo' piu'
 * dipendere dal solo id, deve ricevere la propria entry per sapere QUALE
 * regione servire. Le altre sorgenti (una regione ciascuna) ignorano
 * l'argomento e restituiscono la funzione esistente invariata.
 */
type ScrapeFactory = (meta: SourceMeta) => ScrapeFn

/**
 * Implementazione per id. Le chiavi devono coincidere ESATTAMENTE con gli id
 * dichiarati in SOURCE_META: il controllo qui sotto lo impone.
 */
const SCRAPERS: Record<string, ScrapeFactory> = {
  solosagre: (meta) => scrapeSoloSagreForRegion(meta.region),
  opendata_lombardia: () => scrapeOpenData,
  'in-lombardia': () => scrapeInLombardia,
  'emilia-romagna': () => scrapeEmiliaRomagna,
  puglia: () => scrapePuglia,
  altoadige: () => scrapeAltoAdige,
  firenze: () => scrapeFirenze,
  torino: () => scrapeTorino,
}

// Join fail-closed, in entrambe le direzioni. Un metadato senza scraper
// significherebbe una sorgente pianificata nel crontab che non sa scrapare; uno
// scraper senza metadato significherebbe codice morto che nessuno esegue. Meglio
// un errore al caricamento del modulo che una delle due cose scoperta in
// produzione — la fase 14 ha gia' insegnato quanto lontano arrivi un problema
// che nessun controllo vede.
const metaIds = SOURCE_META.map((entry) => entry.id)
const missingScrapers = metaIds.filter((id) => !(id in SCRAPERS))
if (missingScrapers.length > 0) {
  throw new Error(
    `lib/scrapers/registry.ts: nessuna funzione di scrape per ${missingScrapers.join(', ')} — ` +
      `dichiarata in SOURCE_META (lib/scrapers/sources.ts) ma assente da SCRAPERS.`
  )
}
const orphanScrapers = Object.keys(SCRAPERS).filter((id) => !metaIds.includes(id))
if (orphanScrapers.length > 0) {
  throw new Error(
    `lib/scrapers/registry.ts: scraper senza metadati per ${orphanScrapers.join(', ')} — ` +
      `presente in SCRAPERS ma assente da SOURCE_META (lib/scrapers/sources.ts).`
  )
}

/**
 * Le entry preservano l'ordine di dichiarazione di SOURCE_META: getSourcesByRegion()
 * e il generatore di crontab ne dipendono (D-04/S4).
 */
export const SOURCE_REGISTRY: SourceRegistryEntry[] = SOURCE_META.map((meta) => ({
  ...meta,
  scrape: SCRAPERS[meta.id](meta),
}))

/**
 * Sorgente per id, opzionalmente disambiguata per regione (WR-02, Fase 15
 * review, stessa logica di getSourceMetaById in sources.ts). Dopo SRC-04
 * 'solosagre' e' condiviso da 20 entry: senza `region` questa funzione torna
 * la PRIMA dichiarata (Lombardia) — comportamento storico, preservato per non
 * rompere chiamate gia' univoche. Il ramo CLI di runner.ts, l'unico
 * chiamante che puo' ricevere un id ambiguo da un operatore, richiede
 * `region` esplicitamente prima di arrivare qui.
 */
export function getSourceById(id: string, region?: string): SourceRegistryEntry | undefined {
  if (region !== undefined) {
    return SOURCE_REGISTRY.find((entry) => entry.id === id && entry.region === region)
  }
  return SOURCE_REGISTRY.find((entry) => entry.id === id)
}
