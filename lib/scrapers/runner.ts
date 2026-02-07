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
import type { ScrapeParams, ScrapeResult } from './types'

/**
 * Run all scrapers concurrently and save to database
 *
 * @param params - Optional date range parameters
 */
export async function runAllScrapers(params?: ScrapeParams): Promise<void> {
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

    // Combine all events from successful scrapers
    const allEvents = results.flatMap(r => r.events)

    if (allEvents.length === 0) {
      console.log('[Scraper] No events to save.')
      return
    }

    // Save to database with deduplication
    const { saved, skipped } = await saveEvents(allEvents)

    console.log(`[Scraper] Done. ${saved} new events saved to database.`)
  } catch (error) {
    console.error('[Scraper] Fatal error:', error)
    throw error
  }
}

// Run directly: npx tsx frontend/lib/scrapers/runner.ts
if (require.main === module) {
  // Parse command-line arguments
  const args = process.argv.slice(2)
  const params: ScrapeParams = {}

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      params.dateFrom = args[i + 1]
      i++
    } else if (args[i] === '--to' && args[i + 1]) {
      params.dateTo = args[i + 1]
      i++
    }
  }

  runAllScrapers(params)
    .then(async () => {
      await prisma.$disconnect()
    })
    .catch(async (error) => {
      console.error('[Scraper] Execution failed:', error)
      await prisma.$disconnect()
      process.exit(1)
    })
}
