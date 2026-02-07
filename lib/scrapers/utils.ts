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
 * Save scraped events to PostgreSQL with deduplication
 *
 * Uses Prisma createMany with skipDuplicates to leverage the unique
 * constraint on (source, sourceId). This matches n8n's skipOnConflict behavior.
 *
 * @param events - Array of ScrapedEvent to save
 * @returns Promise with counts of saved and skipped events
 */
export async function saveEvents(
  events: ScrapedEvent[]
): Promise<{ saved: number; skipped: number }> {
  if (events.length === 0) {
    console.log('[Scraper] No events to save')
    return { saved: 0, skipped: 0 }
  }

  try {
    // Convert ScrapedEvent to Prisma Event create input
    const eventsToCreate = events.map(event => ({
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
      imageUrl: event.imageUrl
    }))

    // Use createMany with skipDuplicates to leverage unique constraint
    const result = await prisma.event.createMany({
      data: eventsToCreate,
      skipDuplicates: true
    })

    const saved = result.count
    const skipped = events.length - saved

    console.log(`[Scraper] Saved ${saved} new events, ${skipped} duplicates skipped`)

    return { saved, skipped }
  } catch (error) {
    console.error('[Scraper] Database error:', error)
    throw error
  }
}
