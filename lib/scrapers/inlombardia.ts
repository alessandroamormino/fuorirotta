/**
 * InLombardia scraper
 *
 * Fetches paginated HTML via AJAX POST from in-lombardia.it
 * Ported from n8n workflow nodes:
 * - Code - Fetch All InLombardia Events (Paginated)
 * - Code - Parse InLombardia HTML
 * - Code - Transform InLombardia
 */

import type { ScrapeParams, ScrapeResult, ScrapedEvent } from './types'

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

export async function scrapeInLombardia(params: ScrapeParams = {}): Promise<ScrapeResult> {
  const startTime = Date.now()

  try {
    // Step 1: Fetch all pages (with AJAX pagination)
    const html = await fetchAllPages(params)

    // Step 2: Parse HTML to extract events
    const parsedEvents = parseHTML(html)

    // Step 3: Transform to ScrapedEvent format with filtering
    const events = transformEvents(parsedEvents, params)

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

  // Build initial URL
  const initialUrl = `https://www.in-lombardia.it/eventi?from%5Bvalue%5D%5Bdate%5D=${encodeURIComponent(dateFrom)}&to%5Bvalue%5D%5Bdate%5D=${encodeURIComponent(dateTo)}&location=&where=&distance=40&what%5B%5D=all&date_search=period`

  // Fetch initial page
  const initialResponse = await fetch(initialUrl)
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
  const maxPages = 50

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
      // POST to AJAX endpoint
      const ajaxResponse = await fetch('https://www.in-lombardia.it/it/views/ajax', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: formData
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
      // On any fetch error, stop pagination (don't throw)
      hasMorePages = false
    }
  }

  return allHtml
}

function parseHTML(html: string): ParsedEvent[] {
  const events: ParsedEvent[] = []

  // Regex pattern from n8n: Find all <article class="...c-card..."> blocks
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

function transformEvents(parsedEvents: ParsedEvent[], params: ScrapeParams): ScrapedEvent[] {
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

    // Extract city from address (best effort)
    let locationCity: string | null = null
    if (data.address) {
      // Try to match city name before province code: "City Name (XX)"
      const cityMatch = data.address.match(/([A-Z][a-zà-ù\s]+)(?:\s*\([A-Z]{2}\))?/)
      locationCity = cityMatch ? cityMatch[1].trim() : data.address.split(',')[0].trim()
    }

    if (!locationCity && data.venue) {
      locationCity = data.venue.split(',')[0].trim()
    }

    // Extract sourceId from URL or generate random
    const sourceId = data.url ? data.url.split('/').pop() || String(Math.random()) : String(Math.random())

    results.push({
      source: 'in-lombardia',
      sourceId,
      title: data.title || 'Evento',
      description: '', // InLombardia doesn't provide descriptions in list view
      dateStart: eventStartDate,
      dateEnd: eventEndDate,
      locationName: locationCity || data.venue || 'Lombardia',
      address: data.address,
      latitude: null, // InLombardia doesn't provide coordinates
      longitude: null,
      category: data.category || 'Evento',
      sourceUrl: data.url || 'https://www.in-lombardia.it',
      imageUrl: data.image
    })
  }

  return results
}
