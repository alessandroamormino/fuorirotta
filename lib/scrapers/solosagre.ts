/**
 * SoloSagre.it scraper
 *
 * Fetches and parses HTML from solosagre.it/sagre/lombardia/
 * Ported from n8n workflow nodes:
 * - HTTP Request - SoloSagre
 * - Code - Parse SoloSagre HTML
 * - Code - Transform SoloSagre
 */

import type { ScrapeParams, ScrapeResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'

interface ParsedEvent {
  title: string | null
  url: string | null
  date_start: string | null
  date_end: string | null
  location: string | null
  description: string | null
  image: string | null
}

export async function scrapeSoloSagre(params: ScrapeParams = {}): Promise<ScrapeResult> {
  const startTime = Date.now()

  try {
    // Step 1: Fetch HTML from SoloSagre with retry logic
    const response = await fetchWithRetry('https://www.solosagre.it/sagre/lombardia/')
    const html = await response.text()

    // Step 2: Parse HTML to extract events
    const parsedEvents = parseHTML(html)

    // Step 3: Transform to ScrapedEvent format with filtering
    const events = transformEvents(parsedEvents, params)

    const duration = Date.now() - startTime

    return {
      events,
      source: 'solosagre',
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime
    return {
      events: [],
      source: 'solosagre',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

function parseHTML(html: string): ParsedEvent[] {
  const events: ParsedEvent[] = []

  // Regex pattern from n8n: Find all <div class="post"> blocks
  const postMatches = html.match(/<div class="post"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g)

  if (!postMatches) {
    return events
  }

  postMatches.forEach(post => {
    // Extract title
    const titleMatch = post.match(/<span itemprop="name">(.*?)<\/span>/)
    const title = titleMatch ? titleMatch[1] : null

    // Extract URL
    const urlMatch = post.match(/<a href="(https:\/\/www\.solosagre\.it\/[^"]+)"/)
    const url = urlMatch ? urlMatch[1] : null

    // Extract dates
    const startMatch = post.match(/<time itemprop="startDate" datetime="([^"]+)">/)
    const endMatch = post.match(/<time itemprop="endDate" datetime="([^"]+)">/)
    const date_start = startMatch ? startMatch[1] : null
    const date_end = endMatch ? endMatch[1] : null

    // Extract location
    const locationMatch = post.match(/<span itemprop="location">(.*?)<\/span>/)
    const location = locationMatch ? locationMatch[1] : null

    // Extract description
    const descMatch = post.match(/<span itemprop="description">([\s\S]*?)<\/span>/)
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').substring(0, 500) : null

    // Extract image
    const imgMatch = post.match(/<img[^>]+src="([^"]+)"/)
    const image = imgMatch ? imgMatch[1] : null

    // Only add if we have at least title and start date
    if (title && date_start) {
      events.push({
        title,
        url,
        date_start,
        date_end,
        location,
        description,
        image
      })
    }
  })

  return events
}

function transformEvents(parsedEvents: ParsedEvent[], params: ScrapeParams): ScrapedEvent[] {
  // Set default date range (today to 6 months from now, same as n8n)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const sixMonthsLater = new Date()
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6)
  sixMonthsLater.setHours(23, 59, 59, 999)

  const dateFrom = params.dateFrom ? new Date(params.dateFrom) : today
  dateFrom.setHours(0, 0, 0, 0)

  const dateTo = params.dateTo ? new Date(params.dateTo) : sixMonthsLater
  dateTo.setHours(23, 59, 59, 999)

  const results: ScrapedEvent[] = []

  for (const data of parsedEvents) {
    if (!data.date_start) continue

    // Parse event dates and normalize to start/end of day
    let eventStartDate = new Date(data.date_start)
    eventStartDate.setHours(0, 0, 0, 0)

    let eventEndDate = data.date_end ? new Date(data.date_end) : new Date(eventStartDate)
    eventEndDate.setHours(23, 59, 59, 999)

    // Filter: event must be active during requested period
    // Event is active if: eventStart <= dateTo AND eventEnd >= dateFrom
    const isActiveInPeriod = eventStartDate <= dateTo && eventEndDate >= dateFrom
    if (!isActiveInPeriod) continue

    // Extract city from location (split on comma or parenthesis, take first part)
    const locationCity = data.location ? data.location.split(/[,(]/)[0].trim() : null

    // Extract sourceId from URL or generate random
    const sourceId = data.url
      ? data.url.split('/').pop()?.replace('.html', '') || String(Math.random())
      : String(Math.random())

    // Handle image URL (prepend domain if relative)
    let imageUrl: string | null = null
    if (data.image) {
      imageUrl = data.image.startsWith('http')
        ? data.image
        : 'https://www.solosagre.it' + data.image
    }

    results.push({
      source: 'solosagre',
      sourceId,
      title: data.title || 'Evento',
      description: data.description || '',
      dateStart: eventStartDate,
      dateEnd: eventEndDate,
      locationName: locationCity || 'Lombardia',
      address: null,
      latitude: null,
      longitude: null,
      category: 'Sagra',
      sourceUrl: data.url || 'https://www.solosagre.it',
      imageUrl,
      phone: null
    })
  }

  return results
}
