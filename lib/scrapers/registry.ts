/**
 * Registry dichiarativo delle sorgenti di scraping (SRC-01, SRC-02).
 *
 * Aggiungere una sorgente qui e' l'unico cambiamento necessario perche' il runner e la
 * CLI la eseguano: nessun altro file deve nominare una sorgente specifica.
 */

import { scrapeSoloSagre } from './solosagre'
import { scrapeOpenData } from './opendata'
import { scrapeInLombardia } from './inlombardia'
import type { AdapterResult, ScrapeParams } from './types'

export type SourceType = 'html' | 'json'

export interface SourceRegistryEntry {
  id: string
  region: string
  type: SourceType
  url: string
  schedule: string
  scrape: (params?: ScrapeParams) => Promise<AdapterResult>
  /**
   * Gerarchia di fiducia fra sorgenti (Fase 10, D-12): numero piu' basso vince.
   * Campo OBBLIGATORIO e non opzionale, cosi' il typecheck costringe ogni
   * sorgente futura (Fase 15, rollout nazionale) a dichiarare la propria
   * posizione invece di scivolare dentro con un default silenzioso.
   *
   * Serve SOLO alla composizione a lettura dei campi di un evento fuso
   * (lib/dedup/compose.ts) e NON decide quale riga sia canonica: quella resta
   * sempre MIN(id) (D-02), apposta perche' una gerarchia di sorgenti
   * sposterebbe la canonica il giorno in cui la sorgente piu' fidata smette
   * di pubblicare.
   *
   * Ordine attuale: in-lombardia (1) e' la sorgente con descrizioni e
   * immagini piu' ricche in pratica ed e' la piu' numerosa (1.656/2.737);
   * opendata_lombardia (2) e' il dataset regionale ufficiale, seconda per
   * volume (1.060); solosagre (3) porta solo 21 eventi con testi molto scarni.
   */
  trustRank: number
}

// Gli id sono ESATTAMENTE le stringhe gia' scritte in produzione in `events.source`.
// Fanno parte del vincolo unique (source, sourceId): cambiarle tratterebbe ogni evento
// esistente come nuovo al prossimo upsert, duplicando l'intero dataset.
//
// `schedule` e' informativo in questa fase: nessun codice lo legge o lo esegue ancora,
// sara' consumato dalla Fase 14.
export const SOURCE_REGISTRY: SourceRegistryEntry[] = [
  {
    id: 'solosagre',
    region: 'lombardia',
    type: 'html',
    url: 'https://www.solosagre.it/sagre/lombardia/',
    schedule: '0 */4 * * *',
    scrape: scrapeSoloSagre,
    trustRank: 3
  },
  {
    id: 'opendata_lombardia',
    region: 'lombardia',
    type: 'json',
    url: 'https://www.dati.lombardia.it/resource/hs8z-dcey.json',
    schedule: '0 */4 * * *',
    scrape: scrapeOpenData,
    trustRank: 2
  },
  {
    id: 'in-lombardia',
    region: 'lombardia',
    type: 'html',
    url: 'https://www.in-lombardia.it/eventi',
    schedule: '0 */4 * * *',
    scrape: scrapeInLombardia,
    trustRank: 1
  }
]

export function getSourceById(id: string): SourceRegistryEntry | undefined {
  return SOURCE_REGISTRY.find(entry => entry.id === id)
}
