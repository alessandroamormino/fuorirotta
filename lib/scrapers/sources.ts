/**
 * Metadati dichiarativi delle sorgenti, SENZA le implementazioni degli scraper.
 *
 * Perche' questo file esiste separato da registry.ts: registry.ts importa i tre
 * adattatori (solosagre, opendata, inlombardia) perche' ogni entry porta la
 * propria funzione `scrape`. Quegli adattatori tirano dentro cheerio -> undici,
 * e Prisma per la persistenza. Chiunque volesse solo SAPERE quali sorgenti e
 * quali regioni esistono si portava dietro un parser HTML e uno stack HTTP.
 *
 * Il prezzo si e' pagato due volte, in due ambienti diversi:
 *
 *  - Nel BROWSER: app/HomeClient.tsx -> lib/categories/taxonomy.ts ->
 *    registry.ts -> solosagre.ts -> cheerio. L'intero stack di scraping piu'
 *    Prisma finivano nel bundle client, e il self-check CommonJS di
 *    connectionLimit.ts ci e' arrivato dietro, uccidendo la homepage
 *    (ReferenceError: module is not defined).
 *  - Sull'HOST di produzione (Node 18.19.1, mentre l'immagine e' node:20-alpine):
 *    scripts/generate-crontab.ts e scripts/maintenance-job.ts si schiantavano con
 *    `ReferenceError: File is not defined` — undici@7 richiede il global `File`,
 *    aggiunto in Node 20. Il job di manutenzione notturno non sarebbe mai partito.
 *
 * La regola che ne esce: chi legge METADATI importa questo file; solo chi deve
 * ESEGUIRE uno scrape importa registry.ts. L'unico consumatore del secondo tipo
 * e' lib/scrapers/runner.ts.
 *
 * Questo file non deve mai importare nulla oltre ai tipi: e' cio' che lo rende
 * sicuro sia nel bundle browser sia su un Node vecchio. Il gate
 * scripts/browser-bundle-safety.ts ne verifica la parte browser;
 * scripts/host-script-deps.ts verifica che gli script host non tornino a
 * importare la catena pesante.
 */
export type SourceType = 'html' | 'json'

export interface SourceMeta {
  id: string
  region: string
  type: SourceType
  url: string
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
   * getSourceMetaById). E' il self-check di taxonomy.ts a provare che ogni
   * valore sia un nome canonico reale.
   */
  categoryMap: Record<string, string>
}

// Gli id sono ESATTAMENTE le stringhe gia' scritte in produzione in `events.source`.
// Fanno parte del vincolo unique (source, sourceId): cambiarle tratterebbe ogni evento
// esistente come nuovo al prossimo upsert, duplicando l'intero dataset.
//
// L'ordine di dichiarazione e' significativo: getRegions() lo preserva, e
// scripts/generate-crontab.ts ne deriva l'ordine delle righe del crontab (D-04/S4).
export const SOURCE_META: SourceMeta[] = [
  {
    id: 'solosagre',
    region: 'lombardia',
    type: 'html',
    url: 'https://www.solosagre.it/sagre/lombardia/',
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
 * Gli orari sono in UTC (vedi il commento immediatamente sopra la costante).
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
 * Ogni regione presente in `SOURCE_META` DEVE avere una voce qui:
 * `scripts/generate-crontab.ts` fallisce rumorosamente se manca, mai un
 * crontab con una riga silenziosamente omessa (mitigazione della
 * prohibition di transparency di 14-04-PLAN.md).
 */
// ORARI IN UTC. Non e' una scelta estetica: l'host di produzione e' su UTC e il
// suo cron (Vixie 3.0pl1-184ubuntu2) NON supporta CRON_TZ — verificato contro la
// macchina reale il 2026-09-15, `strings /usr/sbin/cron | grep CRON_TZ` non
// stampa nulla. L'Assumption A2 di 14-RESEARCH.md, che dava per buono il
// contrario, e' caduta. 03:17 UTC = 05:17 in Italia d'estate, 04:17 d'inverno:
// entrambe dentro la finestra notturna voluta, e cio' che il design richiede
// (giornalieri e scaglionati FRA LORO) e' relativo, quindi regge in ogni fuso.
export const REGION_SCHEDULES: Record<string, string> = {
  lombardia: '17 3 * * *'
}

/**
 * Orario del job di manutenzione consolidato (scripts/maintenance-job.ts,
 * 14-03: backfill+dedup+cache dei cluster). Non e' una voce di
 * REGION_SCHEDULES perche' non appartiene a nessuna singola regione — gira
 * una volta al giorno DOPO l'ultima regione pianificata, non insieme a una.
 *
 * In UTC come REGION_SCHEDULES. 05:30 UTC lascia 1h13m dall'avvio dello scrape
 * lombardo (03:17 UTC), che costa >=53 minuti misurati.
 */
export const MAINTENANCE_SCHEDULE = '30 5 * * *'

/** Metadati di una sorgente per id. */
export function getSourceMetaById(id: string): SourceMeta | undefined {
  return SOURCE_META.find((entry) => entry.id === id)
}

/** Regioni distinte, nell'ordine di dichiarazione di SOURCE_META (D-04). */
export function getRegions(): string[] {
  return Array.from(new Set(SOURCE_META.map((entry) => entry.region)))
}
