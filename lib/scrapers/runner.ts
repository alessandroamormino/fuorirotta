/**
 * Scraper runner script
 *
 * Executes all 3 scrapers concurrently and saves results to PostgreSQL.
 *
 * Usage:
 *   npx tsx frontend/lib/scrapers/runner.ts
 *   npx tsx frontend/lib/scrapers/runner.ts --from 2026-03-01 --to 2026-06-30
 */

import { scrapeSoloSagre } from './solosagre'
import { scrapeOpenData } from './opendata'
import { scrapeInLombardia } from './inlombardia'
import { saveEvents, logMetrics } from './utils'
import { prisma } from '../prisma'
import type { ScrapeParams, ScrapeResult, RunResult } from './types'

/**
 * Run all scrapers concurrently and save to database
 *
 * @param params - Optional date range parameters
 * @returns RunResult with saved, skipped, total counts and errors
 */
export async function runAllScrapers(params?: ScrapeParams): Promise<RunResult> {
  console.log('[Scraper] Starting scrape of all sources...')

  try {
    // Run all scrapers concurrently
    const settledResults = await Promise.allSettled([
      scrapeSoloSagre(params),
      scrapeOpenData(params),
      scrapeInLombardia(params)
    ])

    // Convert PromiseSettledResult to ScrapeResult
    const results: ScrapeResult[] = settledResults.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value
      } else {
        // Promise was rejected - create error ScrapeResult
        const sources = ['solosagre', 'opendata_lombardia', 'in-lombardia']
        return {
          events: [],
          source: sources[index],
          duration: 0,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
        }
      }
    })

    // Log metrics summary
    logMetrics(results)

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

const SCRAPERS: Record<string, (params?: ScrapeParams) => Promise<ScrapeResult>> = {
  inlombardia: scrapeInLombardia,
  solosagre: scrapeSoloSagre,
  opendata: scrapeOpenData,
}

// Run directly: npx tsx lib/scrapers/runner.ts [source] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
if (require.main === module) {
  const args = process.argv.slice(2)
  const params: ScrapeParams = {}
  let source: string | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      params.dateFrom = args[i + 1]
      i++
    } else if (args[i] === '--to' && args[i + 1]) {
      params.dateTo = args[i + 1]
      i++
    } else if (!args[i].startsWith('--')) {
      source = args[i].toLowerCase()
    }
  }

  const run = async () => {
    if (source) {
      const scraperFn = SCRAPERS[source]
      if (!scraperFn) {
        console.error(`[Scraper] Unknown source "${source}". Available: ${Object.keys(SCRAPERS).join(', ')}`)
        process.exit(1)
      }
      console.log(`[Scraper] Running single scraper: ${source}`)
      const result = await scraperFn(params)
      logMetrics([result])
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
