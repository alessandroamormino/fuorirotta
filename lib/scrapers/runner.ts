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
import { saveEvents, logMetrics } from './utils'
import { truncateError } from './health'
import { prisma } from '../prisma'
import { backfillEvents } from '../territorial/backfill'
import type { ScrapeParams, ScrapeResult, RunResult } from './types'

/**
 * Run all scrapers concurrently and save to database
 *
 * @param params - Optional date range parameters
 * @returns RunResult with saved, skipped, total counts and errors
 */
export async function runAllScrapers(params?: ScrapeParams): Promise<RunResult> {
  console.log('[Scraper] Starting scrape of all sources...')
  const startedAt = new Date()

  try {
    // Run all registry sources concurrently
    const settledResults = await Promise.allSettled(
      SOURCE_REGISTRY.map(entry => entry.scrape(params))
    )

    // Convert PromiseSettledResult to ScrapeResult, attaching region from the registry entry
    const results: ScrapeResult[] = settledResults.map((result, index) => {
      const entry = SOURCE_REGISTRY[index]
      if (result.status === 'fulfilled') {
        return { ...result.value, region: entry.region }
      } else {
        // Promise was rejected - create error ScrapeResult
        return {
          events: [],
          source: entry.id,
          region: entry.region,
          duration: 0,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
        }
      }
    })

    // Log metrics summary
    logMetrics(results)

    // Storico scrape_runs: un problema qui non deve mai impedire il salvataggio eventi.
    await recordScrapeRuns(results, startedAt)

    // Collect errors from failed scrapers
    const errors = results
      .filter(r => r.error)
      .map(r => `${r.source}: ${r.error}`)

    // Combine all events from successful scrapers
    const allEvents = results.flatMap(r => r.events)

    if (allEvents.length === 0) {
      console.log('[Scraper] No events to save.')
      return { saved: 0, skipped: 0, total: 0, errors }
    }

    // Save to database with deduplication
    const { saved, skipped } = await saveEvents(allEvents)

    console.log(`[Scraper] Done. ${saved} new events saved to database.`)

    // Aggancio territoriale in coda a ogni scrape (D-15).
    // Perche' qui e non dentro saveEvents: l'aggancio esiste in una sola
    // implementazione al mondo (la cascata di lib/territorial/), esercitata a
    // ogni scrape invece che una volta sola — una regressione del matching si
    // vede subito, invece di restare latente fino al prossimo backfill manuale.
    // Perche' l'errore propaga, a differenza di recordScrapeRuns qui sopra:
    // quando questa chiamata parte gli eventi sono gia' persistiti, quindi
    // propagare non perde niente; inghiottire l'errore ricreerebbe esattamente
    // lo scenario che D-15 esiste per impedire — eventi che si accumulano
    // senza comune mentre tutto sembra funzionare. La finestra di incoerenza
    // dichiarata sono i millisecondi fra le due chiamate.
    // Costo basso per costruzione (D-08): il backfill ripassa su tutti gli
    // eventi ma scrive solo dove il valore differisce, quindi a dati fermi
    // scrive quasi niente.
    const backfillReport = await backfillEvents()
    console.log(
      `[Scraper] Backfill territoriale: ${backfillReport.updated} agganciati/aggiornati, ${backfillReport.unchanged} invariati su ${backfillReport.scanned} eventi (no_input: ${backfillReport.byStep.no_input}).`
    )

    return {
      saved,
      skipped,
      total: allEvents.length,
      errors
    }
  } catch (error) {
    console.error('[Scraper] Fatal error:', error)
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

// Run directly: npx tsx lib/scrapers/runner.ts [source] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
if (require.main === module) {
  const args = process.argv.slice(2)
  const params: ScrapeParams = {}
  let sourceId: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      params.dateFrom = args[i + 1]
      i++
    } else if (args[i] === '--to' && args[i + 1]) {
      params.dateTo = args[i + 1]
      i++
    } else if (!args[i].startsWith('--')) {
      sourceId = args[i]
    }
  }

  const run = async () => {
    if (sourceId) {
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
      await runAllScrapers(params)
    }
    await prisma.$disconnect()
  }

  run().catch(async (error) => {
    console.error('[Scraper] Execution failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
}
