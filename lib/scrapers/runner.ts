/**
 * Scraper runner script
 *
 * Executes all 3 scrapers concurrently and saves results to PostgreSQL.
 *
 * Usage:
 *   npx tsx frontend/lib/scrapers/runner.ts
 *   npx tsx frontend/lib/scrapers/runner.ts --from 2026-03-01 --to 2026-06-30
 */

import { SOURCE_REGISTRY, getSourceById } from './registry'
import type { SourceRegistryEntry } from './registry'
import { saveEvents, logMetrics } from './utils'
import { truncateError } from './health'
import { prisma } from '../prisma'
import { acquireRegionLock, releaseRegionLock } from './regionLock'
import type { ScrapeParams, ScrapeResult, RunResult } from './types'

/**
 * Elenco delle regioni dichiarate nel registry, nell'ordine di prima
 * apparizione (D-04). Il 404 di app/api/cron/scrape/route.ts e il generatore
 * di crontab della 14-04 dipendono da questa stabilità dell'ordine: non
 * sostituire con un ordinamento alfabetico o un Set non ordinato.
 */
export function getRegions(): string[] {
  return Array.from(new Set(SOURCE_REGISTRY.map(entry => entry.region)))
}

/**
 * Sorgenti del registry che appartengono a una regione. Confronto di
 * uguaglianza su stringa, mai costruzione di SQL: e' la mitigazione per
 * costruzione di T-14-02 (SQL injection via `region`).
 */
export function getSourcesByRegion(region: string): SourceRegistryEntry[] {
  return SOURCE_REGISTRY.filter(entry => entry.region === region)
}

/**
 * Raggruppa le sorgenti per hostname, nell'ordine di prima apparizione
 * dell'host. D-02: il Crawl-delay e' un vincolo per host (Fase 8 D-08/D-10),
 * quindi host diversi possono scrapare in parallelo senza violare nulla,
 * mentre due sorgenti sullo stesso host vanno serializzate fra loro.
 */
export function groupSourcesByHost(entries: SourceRegistryEntry[]): SourceRegistryEntry[][] {
  const byHost = new Map<string, SourceRegistryEntry[]>()
  for (const entry of entries) {
    const host = new URL(entry.url).hostname
    const group = byHost.get(host)
    if (group) {
      group.push(entry)
    } else {
      byHost.set(host, [entry])
    }
  }
  return Array.from(byHost.values())
}

/**
 * Scrape di una singola regione (SCHED-01, D-01): filtra il registry sulla
 * regione, raggruppa per host (D-02) ed esegue i gruppi in parallelo fra
 * loro e in sequenza dentro ogni gruppo. Non decide codici HTTP: se la
 * regione non ha sorgenti restituisce un RunResult a zero, ed e' la ROUTE a
 * rispondere 404 con getRegions() (D-03). Non esegue la coda di aggancio
 * territoriale/deduplica/cache dei cluster: quella coda e' del job
 * consolidato separato (D-05/D-06/D-07, 14-03), non di questa funzione.
 *
 * @param region - Slug di regione (D-04), gia' validato dal chiamante
 * @param params - Optional date range parameters
 * @returns RunResult con saved, skipped, total e errors per la sola regione
 */
export async function runRegion(region: string, params?: ScrapeParams): Promise<RunResult> {
  console.log(`[Scraper] Starting scrape of region "${region}"...`)
  const startedAt = new Date()

  try {
    const groups = groupSourcesByHost(getSourcesByRegion(region))

    // Gruppi (host diversi) in parallelo fra loro; dentro ogni gruppo (stesso
    // host) le sorgenti in sequenza — D-02.
    const groupSettled = await Promise.allSettled(
      groups.map(async group => {
        const groupResults: ScrapeResult[] = []
        for (const entry of group) {
          try {
            const adapterResult = await entry.scrape(params)
            groupResults.push({ ...adapterResult, region: entry.region })
          } catch (err) {
            groupResults.push({
              events: [],
              source: entry.id,
              region: entry.region,
              duration: 0,
              error: err instanceof Error ? err.message : 'Unknown error'
            })
          }
        }
        return groupResults
      })
    )

    const results: ScrapeResult[] = groupSettled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))

    logMetrics(results)

    // Storico scrape_runs: un problema qui non deve mai impedire il salvataggio eventi.
    await recordScrapeRuns(results, startedAt)

    const errors = results.filter(r => r.error).map(r => `${r.source}: ${r.error}`)
    const allEvents = results.flatMap(r => r.events)

    if (allEvents.length === 0) {
      console.log(`[Scraper] No events to save for region "${region}".`)
      return { saved: 0, skipped: 0, total: 0, errors }
    }

    const { saved, skipped } = await saveEvents(allEvents)
    console.log(`[Scraper] Done. ${saved} new events saved to database for region "${region}".`)

    return { saved, skipped, total: allEvents.length, errors }
  } catch (error) {
    console.error(`[Scraper] Fatal error scraping region "${region}":`, error)
    throw error
  }
}

/**
 * Scrive una riga scrape_runs per ogni risultato (SRC-07), a esecuzione conclusa.
 * Avvolta in try/catch: un fallimento della scrittura dello storico non deve mai far
 * fallire lo scrape, gli eventi vengono salvati comunque e l'errore viene loggato.
 */
async function recordScrapeRuns(results: ScrapeResult[], startedAt: Date): Promise<void> {
  try {
    await Promise.all(
      results.map(result =>
        prisma.scrapeRun.create({
          data: {
            source: result.source,
            region: result.region,
            startedAt,
            durationMs: result.duration,
            eventCount: result.events.length,
            error: truncateError(result.error ?? null)
          }
        })
      )
    )
  } catch (error) {
    console.error('[Scraper] Failed to record scrape run history:', error)
  }
}

// Run directly: npx tsx lib/scrapers/runner.ts [source] [--region <slug>] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// Stessa guardia a tre condizioni degli altri self-check del progetto. Oggi
// questo modulo non e' raggiungibile dal bundle browser (i client importano
// lib/scrapers/registry.ts direttamente, mai il barrel che riesporta di qui),
// quindi la forma nuda non esplodeva — ma e' la stessa mina che ha ucciso la
// homepage quando connectionLimit.ts, quello SI' raggiungibile, l'ha usata.
// Basterebbe un import del barrel da un componente client per riaccenderla.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const args = process.argv.slice(2)
  const params: ScrapeParams = {}
  let sourceId: string | null = null
  let regionSlug: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      params.dateFrom = args[i + 1]
      i++
    } else if (args[i] === '--to' && args[i + 1]) {
      params.dateTo = args[i + 1]
      i++
    } else if (args[i] === '--region' && args[i + 1]) {
      regionSlug = args[i + 1]
      i++
    } else if (!args[i].startsWith('--')) {
      sourceId = args[i]
    }
  }

  const run = async () => {
    if (regionSlug) {
      if (getSourcesByRegion(regionSlug).length === 0) {
        const regions = getRegions().join(', ')
        console.error(`[Scraper] Unknown region "${regionSlug}". Available: ${regions}`)
        process.exit(1)
      }
      console.log(`[Scraper] Running region: ${regionSlug}`)
      // Stessa coppia importata da ./regionLock usata dalla route cron (D-13):
      // mai una seconda implementazione del lock per il chiamante CLI.
      if (!(await acquireRegionLock(regionSlug))) {
        console.error(`[Scraper] Scrape gia' in corso per la regione "${regionSlug}", esco.`)
        process.exit(1)
      }
      try {
        await runRegion(regionSlug, params)
      } finally {
        await releaseRegionLock(regionSlug)
      }
    } else if (sourceId) {
      const entry = getSourceById(sourceId)
      if (!entry) {
        const ids = SOURCE_REGISTRY.map(e => e.id).join(', ')
        console.error(`[Scraper] Unknown source "${sourceId}". Available: ${ids}`)
        process.exit(1)
      }
      console.log(`[Scraper] Running single scraper: ${entry.id}`)
      const startedAt = new Date()
      const adapterResult = await entry.scrape(params)
      const result: ScrapeResult = { ...adapterResult, region: entry.region }
      logMetrics([result])
      await recordScrapeRuns([result], startedAt)
      if (result.events.length > 0) {
        const { saved, skipped } = await saveEvents(result.events)
        console.log(`[Scraper] Done. ${saved} new events saved, ${skipped} skipped.`)
      } else {
        console.log('[Scraper] No events found.')
      }
    } else {
      // Nessun argomento: scrape sequenziale di tutte le regioni dichiarate
      // nel registry (14-03), non piu' runAllScrapers() — quel ramo non
      // aveva ne' lock ne' scoping per regione. Stessa coppia acquireRegion-
      // Lock/releaseRegionLock del ramo --region sopra (D-13): una regione
      // gia' occupata (es. da un trigger cron in corso) viene saltata, non
      // interrompe il ciclo sulle altre.
      for (const region of getRegions()) {
        console.log(`[Scraper] Running region: ${region}`)
        if (!(await acquireRegionLock(region))) {
          console.error(`[Scraper] Scrape gia' in corso per la regione "${region}", salto.`)
          continue
        }
        try {
          await runRegion(region, params)
        } finally {
          await releaseRegionLock(region)
        }
      }
    }
    await prisma.$disconnect()
  }

  run().catch(async (error) => {
    console.error('[Scraper] Execution failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
}
