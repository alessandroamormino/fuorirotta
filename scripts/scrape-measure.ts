#!/usr/bin/env npx tsx
/**
 * Misura di conteggio eventi, durata e richieste HTTP per sorgente (SRC-03, D-08, D-10,
 * 08-05). Chiama solo gli adapter — MAI saveEvents né runAllScrapers — e non scrive nulla
 * sul database.
 *
 * Uso:
 *   npx tsx scripts/scrape-measure.ts --source solosagre
 *   npx tsx scripts/scrape-measure.ts --source in-lombardia [--max-detail-pages N] [--max-list-pages N]
 *
 * SoloSagre: esegue scrapeSoloSagre() per intero (già limitato da SOLOSAGRE_MAX_PAGES=20,
 * al momento della scrittura il sito dichiara 3 pagine — misura veloce, nessun bound
 * ulteriore necessario).
 *
 * In-lombardia: una misura completa richiederebbe una richiesta ogni dieci secondi PER
 * OGNI evento trovato, e — scoperta durante l'esecuzione di questo stesso piano — anche la
 * sola fase di lista non si ferma in tempi brevi: osservate dal vivo più di 33 pagine AJAX
 * consecutive (~264 eventi), throttled correttamente a 10s l'una, senza alcun segnale di
 * termine imminente dopo oltre 5 minuti. Enumerare l'intero listato per una MISURA (non per
 * uno scrape reale) sarebbe un costo sproporzionato verso un sito di terzi. Quindi:
 *   1. esegue la fase di lista (pagine AJAX, throttled — fetchAllPages) fino a un tetto di
 *      cortesia `--max-list-pages` (default 6), dichiarato esplicitamente in output se
 *      raggiunto prima dell'ultima pagina reale — il tetto di produzione di
 *      fetchAllPages (maxPages=200) resta invariato per uno scrape reale
 *   2. conta le pagine di dettaglio che sarebbero da scaricare per gli eventi visti nel
 *      campione (non il totale reale del sito, se il tetto di lista è stato raggiunto)
 *   3. scarica DAVVERO solo le prime `--max-detail-pages` (default 3) di quelle, cronometrando
 *      i distanziamenti fra richieste consecutive per confermare che rispettano
 *      INLOMBARDIA_CRAWL_DELAY_MS
 *   4. proietta il costo per pagina (attesa + latenza media misurata), dichiarando
 *      esplicitamente quando il totale reale del sito resta sconosciuto
 */
import { scrapeSoloSagre } from '../lib/scrapers/solosagre'
import {
  fetchAllPages,
  parseInLombardiaCards,
  fetchDetailPage,
  INLOMBARDIA_CRAWL_DELAY_MS
} from '../lib/scrapers/inlombardia'

function parseArgs(argv: string[]): { source: 'solosagre' | 'in-lombardia'; maxDetailPages: number; maxListPages: number } {
  const sourceIdx = argv.indexOf('--source')
  const source = sourceIdx !== -1 ? argv[sourceIdx + 1] : null
  if (source !== 'solosagre' && source !== 'in-lombardia') {
    console.error('Uso: tsx scripts/scrape-measure.ts --source solosagre|in-lombardia [--max-detail-pages N] [--max-list-pages N]')
    process.exit(2)
  }
  const maxDetailIdx = argv.indexOf('--max-detail-pages')
  const maxDetailPages = maxDetailIdx !== -1 ? Number(argv[maxDetailIdx + 1]) : 3
  if (!Number.isFinite(maxDetailPages) || maxDetailPages < 0) {
    console.error('--max-detail-pages deve essere un numero >= 0')
    process.exit(2)
  }
  const maxListIdx = argv.indexOf('--max-list-pages')
  const maxListPages = maxListIdx !== -1 ? Number(argv[maxListIdx + 1]) : 6
  if (!Number.isFinite(maxListPages) || maxListPages < 1) {
    console.error('--max-list-pages deve essere un numero >= 1')
    process.exit(2)
  }
  return { source, maxDetailPages, maxListPages }
}

// Conta le richieste HTTP reali senza toccare lib/scrapers/utils.ts: intercetta il fetch
// globale solo per la durata della misura, poi lo ripristina sempre (anche in caso di
// eccezione, via try/finally nel chiamante).
function trackFetches(): { count: () => number; restore: () => void } {
  const originalFetch = global.fetch
  let count = 0
  global.fetch = ((...args: Parameters<typeof fetch>) => {
    count++
    return originalFetch(...args)
  }) as typeof fetch
  return {
    count: () => count,
    restore: () => { global.fetch = originalFetch }
  }
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

async function measureSoloSagre(): Promise<void> {
  const tracker = trackFetches()
  const start = Date.now()
  let result
  try {
    result = await scrapeSoloSagre()
  } finally {
    tracker.restore()
  }
  const duration = Date.now() - start

  console.log('=== SoloSagre ===')
  console.log(`eventi: ${result.events.length}`)
  console.log(`durata: ${formatSeconds(duration)}`)
  console.log(`richieste HTTP: ${tracker.count()}`)
  if (result.error) console.log(`errore: ${result.error}`)
}

async function measureInLombardia(maxDetailPages: number, maxListPages: number): Promise<void> {
  const listTracker = trackFetches()
  const listStart = Date.now()
  let listResult
  try {
    listResult = await fetchAllPages({}, maxListPages)
  } finally {
    listTracker.restore()
  }
  const listDuration = Date.now() - listStart
  const ajaxPagesFetched = listResult.pagesFetched
  const listCapped = ajaxPagesFetched >= maxListPages

  const outcome = parseInLombardiaCards(listResult.html)
  const eventsWithUrls = outcome.events.filter(e => e.url && e.url.startsWith('http'))
  const totalDetailPagesInSample = eventsWithUrls.length

  const sampleSize = Math.min(maxDetailPages, totalDetailPagesInSample)
  const requestStarts: number[] = []
  const requestLatencies: number[] = []

  const detailTracker = trackFetches()
  try {
    for (let i = 0; i < sampleSize; i++) {
      await new Promise(resolve => setTimeout(resolve, INLOMBARDIA_CRAWL_DELAY_MS))
      const startedAt = Date.now()
      requestStarts.push(startedAt)
      await fetchDetailPage(eventsWithUrls[i].url!)
      requestLatencies.push(Date.now() - startedAt)
    }
  } finally {
    detailTracker.restore()
  }

  // Distanziamenti fra le prime tre richieste consecutive di dettaglio (o meno, se il
  // campione è più piccolo): conferma che rispettano INLOMBARDIA_CRAWL_DELAY_MS.
  const gaps: number[] = []
  for (let i = 1; i < Math.min(3, requestStarts.length); i++) {
    gaps.push(requestStarts[i] - requestStarts[i - 1])
  }

  const avgDetailLatencyMs = requestLatencies.length > 0
    ? requestLatencies.reduce((a, b) => a + b, 0) / requestLatencies.length
    : 0
  const avgListLatencyMs = ajaxPagesFetched > 0
    ? listDuration / ajaxPagesFetched - INLOMBARDIA_CRAWL_DELAY_MS
    : 0

  // Costo osservato per pagina (attesa fissa + latenza media misurata sul campione reale
  // di questa esecuzione), lo stesso su lista e dettaglio perché entrambi condividono
  // INLOMBARDIA_CRAWL_DELAY_MS. Riusabile per proiettare QUALUNQUE totale N di pagine:
  // durata(N) = N × (INLOMBARDIA_CRAWL_DELAY_MS + latenzaMediaMisurata).
  const costPerListPageMs = INLOMBARDIA_CRAWL_DELAY_MS + Math.max(0, avgListLatencyMs)
  const costPerDetailPageMs = INLOMBARDIA_CRAWL_DELAY_MS + avgDetailLatencyMs

  console.log('=== In-Lombardia ===')
  console.log(`eventi nel campione di lista: ${outcome.events.length}`)
  console.log(`pagine AJAX scaricate in questa misura: ${ajaxPagesFetched} (tetto di cortesia --max-list-pages=${maxListPages}${listCapped ? ', RAGGIUNTO — il sito ha piu\' pagine reali, non enumerate' : ', non raggiunto: fine naturale della lista'})`)
  console.log(`durata fase di lista (reale, sul campione): ${formatSeconds(listDuration)}`)
  console.log(`richieste HTTP fase di lista: ${listTracker.count()}`)
  console.log(`costo medio osservato per pagina di lista: ${formatSeconds(costPerListPageMs)} (attesa ${formatSeconds(INLOMBARDIA_CRAWL_DELAY_MS)} + latenza media ${avgListLatencyMs.toFixed(0)}ms)`)
  console.log(`pagine di dettaglio nel campione di lista: ${totalDetailPagesInSample}`)
  console.log(`pagine di dettaglio scaricate davvero in questa misura: ${sampleSize}`)
  console.log(`richieste HTTP fase di dettaglio (campione): ${detailTracker.count()}`)
  console.log(`distanziamenti fra le prime ${gaps.length + 1} richieste di dettaglio consecutive: ${gaps.map(formatSeconds).join(', ') || 'n/d (campione troppo piccolo)'}`)
  console.log(`costo medio osservato per pagina di dettaglio: ${formatSeconds(costPerDetailPageMs)} (attesa ${formatSeconds(INLOMBARDIA_CRAWL_DELAY_MS)} + latenza media ${avgDetailLatencyMs.toFixed(0)}ms)`)
  console.log('formula di proiezione (per N pagine, lista o dettaglio): durata(N) = N × (INLOMBARDIA_CRAWL_DELAY_MS + latenza media osservata)')
  if (listCapped) {
    console.log(`NOTA: il totale reale di pagine/eventi del sito NON è determinato da questa misura (tetto di cortesia raggiunto) — solo il costo per pagina è misurato e proiettabile su qualunque N reale`)
  }
}

async function main(): Promise<void> {
  const { source, maxDetailPages, maxListPages } = parseArgs(process.argv.slice(2))
  if (source === 'solosagre') {
    await measureSoloSagre()
  } else {
    await measureInLombardia(maxDetailPages, maxListPages)
  }
}

main()
