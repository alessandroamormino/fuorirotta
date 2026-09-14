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
  /**
   * Mappa valore grezzo di categoria -> nome canonico (Fase 11, D-10).
   * Campo OBBLIGATORIO e non opzionale, cosi' il typecheck costringe ogni
   * sorgente futura (Fase 15, rollout nazionale) a dichiarare la propria
   * mappatura invece di scivolare dentro con un default silenzioso.
   *
   * Tipizzato Record<string, string> e non Record<string, CanonicalCategory>
   * apposta: importare CanonicalCategory da lib/categories/taxonomy.ts qui
   * creerebbe un ciclo di import (taxonomy.ts legge gia' questo file tramite
   * getSourceById). E' il self-check di taxonomy.ts a provare che ogni
   * valore sia un nome canonico reale.
   *
   * Letta SOLO da canonicalizeCategory() in lib/categories/taxonomy.ts, cosi'
   * il registry resta l'unica sede dichiarativa (D-10).
   */
  categoryMap: Record<string, string>
}

// Gli id sono ESATTAMENTE le stringhe gia' scritte in produzione in `events.source`.
// Fanno parte del vincolo unique (source, sourceId): cambiarle tratterebbe ogni evento
// esistente come nuovo al prossimo upsert, duplicando l'intero dataset.
//
// L'orario NON e' piu' un campo di questa entry (Fase 14, D-10): si e' spostato su
// REGION_SCHEDULES qui sotto, perche' l'unita' schedulabile e' la regione, non la
// sorgente — vedi il commento su REGION_SCHEDULES per il perche'.
export const SOURCE_REGISTRY: SourceRegistryEntry[] = [
  {
    id: 'solosagre',
    region: 'lombardia',
    type: 'html',
    url: 'https://www.solosagre.it/sagre/lombardia/',
    scrape: scrapeSoloSagre,
    trustRank: 3,
    categoryMap: {
      Sagra: 'Sagre e feste'
    }
  },
  {
    id: 'opendata_lombardia',
    region: 'lombardia',
    type: 'json',
    url: 'https://www.dati.lombardia.it/resource/hs8z-dcey.json',
    scrape: scrapeOpenData,
    trustRank: 2,
    categoryMap: {
      Sagra: 'Sagre e feste',
      Fiera: 'Fiere e mercati'
    }
  },
  {
    id: 'in-lombardia',
    region: 'lombardia',
    type: 'html',
    url: 'https://www.in-lombardia.it/eventi',
    scrape: scrapeInLombardia,
    trustRank: 1,
    categoryMap: {
      'Musica e spettacolo': 'Musica e spettacolo',
      'Arte e Cultura': 'Arte e cultura',
      'Turismo religioso': 'Arte e cultura',
      'Food & Wine': 'Food & Wine',
      Sport: 'Sport e outdoor',
      'Active & Green': 'Sport e outdoor',
      Montagne: 'Sport e outdoor',
      Cicloturismo: 'Sport e outdoor',
      Parchi: 'Sport e outdoor',
      Laghi: 'Sport e outdoor',
      Itinerari: 'Sport e outdoor',
      Lifestyle: 'Altro',
      Borghi: 'Altro',
      'Top Events': 'Altro',
      Wellness: 'Altro'
    }
  }
]

/**
 * Orario per regione (Fase 14, D-09/D-10/D-11): l'unita' schedulabile e' la
 * regione, non la sorgente — e' quello che il trigger accetta (D-01,
 * `?region=` su `/api/cron/scrape`). Tre sorgenti lombarde con tre orari
 * identici scritti a mano sarebbero tre occasioni di divergere per niente;
 * una sola voce per regione qui e' l'unica fonte di verita' letta da
 * `scripts/generate-crontab.ts` (D-09) — nessuno schedule va scritto a mano
 * altrove.
 *
 * Struttura piatta (Record<string, string>) e non un'entita' con piu' campi:
 * a N=1 non c'e' nulla da modellare, e la Fase 15 la estendera' se e quando
 * servira' davvero.
 *
 * La frequenza si giustifica con un numero misurato, mai con una stima
 * (D-11): in-lombardia.it costa **>=53 minuti misurati** (limite inferiore,
 * probabilmente oltre un'ora — 08-05-SUMMARY.md), quindi la Lombardia non
 * entra in una finestra da 4 ore ripetuta sei volte al giorno e passa a una
 * cadenza giornaliera. Il minuto di partenza (17, non 0) e' deliberatamente
 * non tondo: e' la prima voce di uno scaglionamento che alla Fase 15
 * diventera' venti voci a minuti di distanza, e partire da uno slot gia'
 * spostato evita che le regioni future si accalchino tutte sul minuto zero.
 *
 * La sostenibilita' e' aritmetica: 24h / 20 regioni = 72 minuti di slot,
 * che copre anche la regione piu' lenta misurata. Le regioni leggere (solo
 * l'adattatore SoloSagre generalizzato, costo in secondi) restano ogni 4h
 * quando la Fase 15 le aggiungera' — non tutte le regioni hanno bisogno
 * della stessa cadenza solo perche' ora e' una proprieta' della regione.
 *
 * Ogni regione presente in `SOURCE_REGISTRY` DEVE avere una voce qui:
 * `scripts/generate-crontab.ts` fallisce rumorosamente se manca, mai un
 * crontab con una riga silenziosamente omessa (mitigazione della
 * prohibition di transparency di 14-04-PLAN.md).
 */
export const REGION_SCHEDULES: Record<string, string> = {
  lombardia: '17 3 * * *'
}

export function getSourceById(id: string): SourceRegistryEntry | undefined {
  return SOURCE_REGISTRY.find(entry => entry.id === id)
}
