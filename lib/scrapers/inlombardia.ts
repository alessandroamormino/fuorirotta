/**
 * InLombardia scraper
 *
 * Fetches paginated HTML via AJAX POST from in-lombardia.it
 * Handles AJAX pagination, parses article HTML, fetches detail pages for
 * JSON-LD structured data, and transforms to Event schema.
 */

import type { ScrapeParams, ScrapeResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'

interface ParsedEvent {
  title: string | null
  venue: string | null
  address: string | null
  date: string | null // Format: DD/MM/YYYY or DD/MM/YYYY - DD/MM/YYYY
  category: string | null
  url: string | null
  image: string | null
}

interface AjaxCommand {
  command?: string
  data?: string
}

interface DetailData {
  description: string | null
  venueName: string | null
  fullAddress: string | null
  phone: string | null
}

export async function scrapeInLombardia(params: ScrapeParams = {}): Promise<ScrapeResult> {
  const startTime = Date.now()

  try {
    // Step 1: Fetch all pages (with AJAX pagination)
    const html = await fetchAllPages(params)

    // Step 2: Parse HTML to extract events
    const parsedEvents = parseHTML(html)

    // Step 3: Fetch detail pages for rich data
    const detailDataMap = await fetchDetailPages(parsedEvents)

    // Step 4: Transform to ScrapedEvent format with filtering and detail data
    const events = transformEvents(parsedEvents, params, detailDataMap)

    const duration = Date.now() - startTime

    return {
      events,
      source: 'in-lombardia',
      duration
    }
  } catch (error) {
    const duration = Date.now() - startTime
    return {
      events: [],
      source: 'in-lombardia',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

async function fetchAllPages(params: ScrapeParams): Promise<string> {
  // Convert dates to DD/MM/YYYY format for InLombardia
  const today = new Date()
  const dateFromStr = params.dateFrom || today.toISOString().split('T')[0]

  const sixMonthsLater = new Date()
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6)
  const dateToStr = params.dateTo || sixMonthsLater.toISOString().split('T')[0]

  // Convert YYYY-MM-DD to DD/MM/YYYY
  const dateFrom = dateFromStr.split('-').reverse().join('/')
  const dateTo = dateToStr.split('-').reverse().join('/')

  // Calculate date range in days for adaptive maxPages
  const dateFromParsed = new Date(dateFromStr)
  const dateToParsed = new Date(dateToStr)
  const daysDiff = Math.ceil((dateToParsed.getTime() - dateFromParsed.getTime()) / (1000 * 60 * 60 * 24))

  // Adaptive maxPages based on date range
  let maxPages: number
  if (daysDiff <= 7) {
    maxPages = 5 // Short searches (1 week or less)
  } else if (daysDiff <= 30) {
    maxPages = 15 // Medium searches (up to 1 month)
  } else {
    maxPages = 50 // Long searches (more than 1 month)
  }

  // Build initial URL
  const initialUrl = `https://www.in-lombardia.it/eventi?from%5Bvalue%5D%5Bdate%5D=${encodeURIComponent(dateFrom)}&to%5Bvalue%5D%5Bdate%5D=${encodeURIComponent(dateTo)}&location=&where=&distance=40&what%5B%5D=all&date_search=period`

  // Fetch initial page with retry logic (2 retries, 500ms delay)
  const initialResponse = await fetchWithRetry(initialUrl, {
    timeout: 30000,
    retries: 2,
    retryDelay: 500
  })
  const initialHtml = await initialResponse.text()

  // Extract view_dom_id (required for AJAX pagination)
  const viewDomIdMatch = initialHtml.match(/view_dom_id["']?:\s*["']([a-f0-9]+)["']/)
  if (!viewDomIdMatch) {
    // No view_dom_id means pagination not available - return just initial page
    return initialHtml
  }
  const viewDomId = viewDomIdMatch[1]

  // Start pagination
  let allHtml = initialHtml
  let page = 1
  let cardLastPos = 20
  let hasMorePages = true

  while (hasMorePages && page < maxPages) {
    // Build form data for AJAX request
    const formData = [
      `page=${page}`,
      `view_name=events`,
      `view_display_id=aggregatore_tutti`,
      `view_dom_id=${viewDomId}`,
      `pager_element=0`,
      `card_last_pos=${cardLastPos}`,
      `card_last_merge_pos=${cardLastPos - 2}`,
      `from%5Bvalue%5D%5Bdate%5D=${encodeURIComponent(dateFrom)}`,
      `to%5Bvalue%5D%5Bdate%5D=${encodeURIComponent(dateTo)}`,
      `distance=40`,
      `what%5B0%5D=all`,
      `date_search=period`
    ].join('&')

    try {
      // POST to AJAX endpoint with reduced timeout and retries for speed
      const ajaxResponse = await fetchWithRetry('https://www.in-lombardia.it/it/views/ajax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData,
        timeout: 10000, // 10s timeout for AJAX requests
        retries: 1, // Only 1 retry
        retryDelay: 500 // 500ms delay
      })

      const ajaxData: AjaxCommand[] = await ajaxResponse.json()

      // Find the insert command
      const insertCommand = ajaxData.find(cmd =>
        cmd.command === 'insert' ||
        cmd.command === 'views_infinite_scroll_insert_view' ||
        cmd.command === 'views_infinite_scroll_content_selector'
      )

      if (insertCommand && insertCommand.data) {
        const pageHtml = insertCommand.data

        // Count events in this page
        const eventCount = (pageHtml.match(/<article/g) || []).length

        if (eventCount === 0) {
          // No more events - stop pagination
          hasMorePages = false
        } else {
          // Append HTML and continue
          allHtml += pageHtml
          page++
          cardLastPos += 10
        }
      } else {
        // No insert command - stop pagination
        hasMorePages = false
      }
    } catch (error) {
      // On any fetch error, stop pagination and return events collected so far (don't throw)
      hasMorePages = false
    }
  }

  return allHtml
}

function parseHTML(html: string): ParsedEvent[] {
  const events: ParsedEvent[] = []

  // Regex pattern: Find all <article class="...c-card..."> blocks
  const cardMatches = html.match(/<article[^>]*class="[^"]*c-card[^"]*"[^>]*>([\s\S]*?)<\/article>/g)

  if (!cardMatches) {
    return events
  }

  cardMatches.forEach(card => {
    // Extract title
    const titleMatch = card.match(/<h4[^>]*class="c-card__title"[^>]*>([^<]+)<\/h4>/)
    const title = titleMatch ? titleMatch[1].trim() : null

    // Extract venue
    const venueMatch = card.match(/<h5[^>]*class="c-card__location"[^>]*>([^<]+)<\/h5>/)
    const venue = venueMatch ? venueMatch[1].trim() : null

    // Extract address
    const addressMatch = card.match(/<h6[^>]*class="c-card__city"[^>]*>([^<]+)<\/h6>/)
    const address = addressMatch ? addressMatch[1].trim() : null

    // Extract date (format: DD/MM/YYYY or DD/MM/YYYY - DD/MM/YYYY)
    const dateMatch = card.match(/<div[^>]*class="c-card__date"[^>]*>(\d{2}\/\d{2}\/\d{4}(?:\s*-\s*\d{2}\/\d{2}\/\d{4})?)<\/div>/)
    const dateStr = dateMatch ? dateMatch[1].trim() : null

    // Extract category
    const categoryMatch = card.match(/<div[^>]*class="c-card__labels"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/)
    const category = categoryMatch ? categoryMatch[1].trim() : null

    // Extract URL
    const urlMatch = card.match(/<a[^>]+href="([^"]+)"/)
    let url = urlMatch ? urlMatch[1] : null
    if (url && !url.startsWith('http')) {
      url = 'https://www.in-lombardia.it' + url
    }

    // Extract image
    const imgMatch = card.match(/<img[^>]+src="([^"]+)"/)
    let image = imgMatch ? imgMatch[1] : null
    if (image && image !== 'blank.gif' && !image.includes('blank.gif')) {
      if (!image.startsWith('http')) {
        image = 'https://www.in-lombardia.it' + (image.startsWith('/') ? image : '/' + image)
      }
    } else {
      image = null
    }

    // Only add if we have at least title and date
    if (title && dateStr) {
      events.push({
        title,
        venue,
        address,
        date: dateStr,
        category,
        url,
        image
      })
    }
  })

  return events
}

async function fetchDetailPage(url: string): Promise<DetailData> {
  try {
    // Fetch detail page with short timeout and 1 retry for speed
    const response = await fetchWithRetry(url, {
      timeout: 5000,
      retries: 1,
      retryDelay: 500
    })
    const html = await response.text()

    let description: string | null = null
    let venueName: string | null = null
    let fullAddress: string | null = null
    let phone: string | null = null

    // Extract JSON-LD structured data
    const jsonLdPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g
    let match: RegExpExecArray | null

    while ((match = jsonLdPattern.exec(html)) !== null) {
      try {
        const jsonData = JSON.parse(match[1])

        // JSON-LD may be an object, array, or have @graph wrapper
        let items: any[] = []
        if (Array.isArray(jsonData)) {
          items = jsonData
        } else if (jsonData['@graph'] && Array.isArray(jsonData['@graph'])) {
          items = jsonData['@graph']
        } else {
          items = [jsonData]
        }

        for (const item of items) {
          // Check if this is an Event type
          if (item['@type'] && String(item['@type']).includes('Event')) {
            // Extract description
            if (item.description && typeof item.description === 'string') {
              let desc = item.description.trim()
              // Decode HTML entities (simple approach)
              desc = desc
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#039;/g, "'")
                .replace(/<[^>]+>/g, '') // Strip HTML tags
              description = desc
            }

            // Extract venue name and address from location
            if (item.location && typeof item.location === 'object') {
              if (item.location.name && typeof item.location.name === 'string') {
                venueName = item.location.name.trim()
              }

              if (item.location.address && typeof item.location.address === 'object') {
                // Build full address from PostalAddress components
                const addr = item.location.address
                const parts: string[] = []

                if (addr.streetAddress) parts.push(String(addr.streetAddress).trim())
                if (addr.addressLocality) parts.push(String(addr.addressLocality).trim())
                if (addr.postalCode) parts.push(String(addr.postalCode).trim())
                if (addr.addressRegion) parts.push(String(addr.addressRegion).trim())

                if (parts.length > 0) {
                  fullAddress = parts.join(', ')
                }
              }
            }

            break // Found Event data, stop looking
          }
        }
      } catch (jsonError) {
        // Invalid JSON in this script tag, continue to next
        continue
      }
    }

    // Extract phone number from HTML (check tel: link, span, or p tag)
    const phonePattern = /icon-phone[\s\S]{0,200}?(?:<a[^>]*href="tel:([^"]+)"|<(?:span|p)[^>]*>\s*([\d\s\+\-\.\/\(\)]{7,})\s*<\/(?:span|p)>)/
    const phoneMatch = html.match(phonePattern)
    if (phoneMatch) {
      const phoneStr = phoneMatch[1] || phoneMatch[2]
      if (phoneStr && phoneStr.length >= 7) {
        // Clean phone string
        phone = phoneStr.trim().replace(/\s+/g, ' ')
      }
    }

    return { description, venueName, fullAddress, phone }
  } catch (error) {
    // On error, return null data (graceful degradation)
    return { description: null, venueName: null, fullAddress: null, phone: null }
  }
}

async function fetchDetailPages(events: ParsedEvent[]): Promise<Map<string, DetailData>> {
  const detailDataMap = new Map<string, DetailData>()

  // Filter to only events with valid URLs
  const eventsWithUrls = events.filter(e => e.url && e.url.startsWith('http'))

  // Cap at 200 events maximum
  const eventsToFetch = eventsWithUrls.slice(0, 200)

  if (eventsToFetch.length === 0) {
    return detailDataMap
  }

  console.log(`[InLombardia] Fetching ${eventsToFetch.length} detail pages in batches of 10...`)

  // Process in batches of 10 concurrent requests
  const batchSize = 10
  for (let i = 0; i < eventsToFetch.length; i += batchSize) {
    const batch = eventsToFetch.slice(i, i + batchSize)

    // Use Promise.allSettled for resilience - individual failures don't crash the batch
    const results = await Promise.allSettled(
      batch.map(event =>
        fetchDetailPage(event.url!).then(data => ({ url: event.url!, data }))
      )
    )

    // Collect successful results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        detailDataMap.set(result.value.url, result.value.data)
      }
    }
  }

  console.log(`[InLombardia] Fetched ${detailDataMap.size} detail pages successfully`)

  return detailDataMap
}

function parseItalianDate(dateStr: string): Date | null {
  // Parse DD/MM/YYYY format
  const parts = dateStr.split('-')[0].trim().split('/')
  if (parts.length === 3) {
    const date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
    date.setHours(0, 0, 0, 0)
    return date
  }
  return null
}

function parseEndDate(dateStr: string): Date | null {
  // Parse end date from range: DD/MM/YYYY - DD/MM/YYYY
  if (dateStr.includes('-')) {
    const endPart = dateStr.split('-')[1].trim()
    const parts = endPart.split('/')
    if (parts.length === 3) {
      const date = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
      date.setHours(23, 59, 59, 999)
      return date
    }
  }
  return null
}

function transformEvents(parsedEvents: ParsedEvent[], params: ScrapeParams, detailDataMap: Map<string, DetailData>): ScrapedEvent[] {
  // Set default date range
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
    if (!data.date) continue

    // Parse Italian date format
    const eventStartDate = parseItalianDate(data.date)
    if (!eventStartDate) continue

    let eventEndDate = parseEndDate(data.date)
    if (!eventEndDate) {
      eventEndDate = new Date(eventStartDate)
      eventEndDate.setHours(23, 59, 59, 999)
    }

    // Filter: event must be active during requested period
    const isActiveInPeriod = eventStartDate <= dateTo && eventEndDate >= dateFrom
    if (!isActiveInPeriod) continue

    // Look up detail data for this event URL
    const detailData = data.url ? detailDataMap.get(data.url) : null

    // Use detail data if available, fallback to list-view data
    const description = detailData?.description || null
    const phone = detailData?.phone || null

    // For locationName: prefer detail venue name, fallback to extracted city
    let locationName: string | null = detailData?.venueName || null

    if (!locationName) {
      // Extract city from address (best effort)
      if (data.address) {
        // Try to match city name before province code: "City Name (XX)"
        const cityMatch = data.address.match(/([A-Z][a-zà-ù\s]+)(?:\s*\([A-Z]{2}\))?/)
        locationName = cityMatch ? cityMatch[1].trim() : data.address.split(',')[0].trim()
      }

      if (!locationName && data.venue) {
        locationName = data.venue.split(',')[0].trim()
      }
    }

    // For address: prefer detail fullAddress if richer, fallback to list-view address
    const address = detailData?.fullAddress || data.address

    // Extract sourceId from URL or generate random
    const sourceId = data.url ? data.url.split('/').pop() || String(Math.random()) : String(Math.random())

    results.push({
      source: 'in-lombardia',
      sourceId,
      title: data.title || 'Evento',
      description,
      dateStart: eventStartDate,
      dateEnd: eventEndDate,
      locationName: locationName || 'Lombardia',
      address,
      latitude: null, // InLombardia doesn't provide coordinates
      longitude: null,
      category: data.category || 'Evento',
      sourceUrl: data.url || 'https://www.in-lombardia.it',
      imageUrl: data.image,
      phone
    })
  }

  return results
}
