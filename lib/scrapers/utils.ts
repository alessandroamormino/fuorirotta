/**
 * Scraper utilities for production-readiness
 *
 * Provides:
 * - fetchWithRetry: HTTP requests with exponential backoff and timeout
 * - saveEvents: Database persistence with deduplication
 * - logMetrics: Scrape metrics logging
 */

import type { ScrapeResult, ScrapedEvent } from './types'
import { prisma } from '../prisma'

interface FetchWithRetryOptions extends RequestInit {
  retries?: number
  retryDelay?: number
  timeout?: number
}

/**
 * Fetch with automatic retry on 5xx errors and timeouts
 *
 * @param url - URL to fetch
 * @param options - Fetch options plus retries, retryDelay, timeout
 * @returns Promise<Response>
 * @throws Error after all retries exhausted
 */
export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {}
): Promise<Response> {
  const {
    retries = 3,
    retryDelay = 1000,
    timeout = 30000,
    ...fetchOptions
  } = options

  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal
        })

        clearTimeout(timeoutId)

        // Check if response is ok (2xx or 3xx status)
        if (!response.ok) {
          // Only retry 5xx errors (server errors)
          if (response.status >= 500 && attempt < retries) {
            const delay = retryDelay * Math.pow(2, attempt)
            console.warn(`[Scraper] Retry ${attempt + 1}/${retries} for ${url}: HTTP ${response.status}`)
            await new Promise(resolve => setTimeout(resolve, delay))
            continue
          }

          // Don't retry 4xx errors (client errors)
          if (response.status >= 400 && response.status < 500) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
        }

        return response
      } catch (error) {
        clearTimeout(timeoutId)
        throw error
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Check if this is a timeout error
      const isTimeout = error instanceof Error && error.name === 'AbortError'
      const errorMsg = isTimeout ? 'Request timeout' : lastError.message

      // Retry on network errors and timeouts
      if (attempt < retries) {
        const delay = retryDelay * Math.pow(2, attempt)
        console.warn(`[Scraper] Retry ${attempt + 1}/${retries} for ${url}: ${errorMsg}`)
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      // All retries exhausted
      throw lastError
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError || new Error('Unknown error')
}

/**
 * Format duration in milliseconds as human-readable string
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "1.2s" or "45.3s"
 */
export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Log scrape metrics summary table to console
 *
 * @param results - Array of ScrapeResult from all scrapers
 */
export function logMetrics(results: ScrapeResult[]): void {
  console.log('[Scraper] === Scrape Complete ===')

  let totalEvents = 0
  let totalDuration = 0

  for (const result of results) {
    const status = result.error ? `error: ${result.error}` : 'success'
    const eventCount = result.events.length
    const duration = formatDuration(result.duration)

    // Format source name for display
    const sourceName = result.source === 'opendata_lombardia'
      ? 'OpenData'
      : result.source === 'solosagre'
      ? 'SoloSagre'
      : 'InLombardia'

    console.log(`[Scraper] ${sourceName.padEnd(15)} ${String(eventCount).padStart(4)} events in ${duration.padStart(6)} (${status})`)

    totalEvents += eventCount
    totalDuration += result.duration
  }

  console.log(`[Scraper] Total: ${totalEvents} events in ${formatDuration(totalDuration)}`)
}

/**
 * Save scraped events to PostgreSQL with upsert behavior
 *
 * Uses Prisma upsert to update existing events or create new ones.
 * This ensures that enriched data (descriptions, phone, venue) from detail
 * pages updates existing records instead of being skipped.
 *
 * @param events - Array of ScrapedEvent to save
 * @returns Promise with counts of saved and updated events
 */
export async function saveEvents(
  events: ScrapedEvent[]
): Promise<{ saved: number; skipped: number }> {
  if (events.length === 0) {
    console.log('[Scraper] No events to save')
    return { saved: 0, skipped: 0 }
  }

  try {
    let created = 0
    let updated = 0

    // Use Promise.allSettled to handle all upserts, even if some fail
    const results = await Promise.allSettled(
      events.map(event =>
        prisma.event.upsert({
          where: {
            events_source_source_id_key: {
              source: event.source,
              sourceId: event.sourceId
            }
          },
          create: {
            source: event.source,
            sourceId: event.sourceId,
            title: event.title,
            description: event.description,
            dateStart: event.dateStart,
            dateEnd: event.dateEnd,
            locationName: event.locationName,
            address: event.address,
            latitude: event.latitude,
            longitude: event.longitude,
            category: event.category,
            sourceUrl: event.sourceUrl,
            imageUrl: event.imageUrl,
            phone: event.phone
          },
          update: {
            title: event.title,
            description: event.description,
            dateStart: event.dateStart,
            dateEnd: event.dateEnd,
            locationName: event.locationName,
            address: event.address,
            latitude: event.latitude,
            longitude: event.longitude,
            category: event.category,
            sourceUrl: event.sourceUrl,
            imageUrl: event.imageUrl,
            phone: event.phone,
            updatedAt: new Date()
          }
        })
      )
    )

    // Count successes and failures
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        // Check if it was created or updated (rough heuristic: compare timestamps)
        const event = result.value
        const wasJustCreated = event.createdAt.getTime() === event.updatedAt.getTime()
        if (wasJustCreated) {
          created++
        } else {
          updated++
        }
      } else {
        console.error(`[Scraper] Failed to save event ${index}:`, result.reason)
      }
    })

    const saved = created + updated
    console.log(`[Scraper] Created ${created}, updated ${updated} events (${saved} total)`)

    return { saved, skipped: 0 }
  } catch (error) {
    console.error('[Scraper] Database error:', error)
    throw error
  }
}
