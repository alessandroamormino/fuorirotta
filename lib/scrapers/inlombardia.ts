/**
 * InLombardia scraper
 *
 * Fetches paginated HTML via AJAX POST from in-lombardia.it
 * Handles AJAX pagination, parses article HTML, fetches detail pages for
 * JSON-LD structured data, and transforms to Event schema.
 */

import he from 'he'
import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
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
  latitude: number | null
  longitude: number | null
}

// Stessa forma di ParseOutcome in solosagre.ts, dichiarata localmente per file (Fase 8).
// `error` non e' mai valorizzato oggi: il fail-loudly di D-07 arriva con cheerio in 08-03.
interface ParseOutcome {
  events: ParsedEvent[]
  error?: string
}

interface DetailParseOutcome {
  detail: DetailData
  error?: string
}

export async function scrapeInLombardia(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    // Step 1: Fetch all pages (with AJAX pagination)
    const html = await fetchAllPages(params)

    // Step 2: Parse HTML to extract events
    const parsedEvents = parseInLombardiaCards(html).events

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
  const today = new Date()
  // Dates stay in YYYY-MM-DD — the site now uses this format natively
  const dateFrom = params.dateFrom || today.toISOString().split('T')[0]

  const sixMonthsLater = new Date()
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6)
  const dateTo = params.dateTo || sixMonthsLater.toISOString().split('T')[0]

  const maxPages = 200

  const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  // Initial page — new q[] param format with ISO dates
  const initialUrl = `https://www.in-lombardia.it/eventi?q%5Bfrom%5D=${dateFrom}&q%5Bto%5D=${dateTo}&q%5Bwhat%5D%5Ball%5D=all&q%5Bfield_posizione_proximity%5D%5Bvalue%5D=40&q%5Bdate_search%5D=&q%5Blocation%5D=&q%5Bwhere%5D=`

  const initialResponse = await fetchWithRetry(initialUrl, {
    headers: { 'User-Agent': BROWSER_UA },
    timeout: 30000,
    retries: 2,
    retryDelay: 500
  })
  const initialHtml = await initialResponse.text()

  // Extract view_dom_id — required for AJAX pagination
  const viewDomIdMatch = initialHtml.match(/view_dom_id["']?:\s*["']([a-f0-9]+)["']/)
  if (!viewDomIdMatch) {
    return initialHtml
  }
  const viewDomId = viewDomIdMatch[1]

  // Extract view config from drupalSettings (falls back to known defaults)
  let viewName = 'aggregatore_eventi'
  let viewDisplayId = 'aggregatore'
  let viewArgs = '24533'
  let viewPath = '/node/24533'
  const ajaxViewsMatch = initialHtml.match(/"ajaxViews"\s*:\s*\{[^}]*"views?_dom_id:[a-f0-9]+":\s*(\{[^}]+\})/)
  if (ajaxViewsMatch) {
    try {
      const viewConfig = JSON.parse(ajaxViewsMatch[1])
      if (viewConfig.view_name) viewName = viewConfig.view_name
      if (viewConfig.view_display_id) viewDisplayId = viewConfig.view_display_id
      if (viewConfig.view_args) viewArgs = String(viewConfig.view_args)
      if (viewConfig.view_path) viewPath = viewConfig.view_path.replace(/\\\//g, '/')
    } catch { /* keep defaults */ }
  }

  // Try to extract the compressed libraries token from the initial page
  let pageLibraries = ''
  const librariesMatch = initialHtml.match(/"libraries"\s*:\s*"([^"]+)"/)
  if (librariesMatch) pageLibraries = librariesMatch[1]

  console.log(`[InLombardia] view=${viewName}/${viewDisplayId} args=${viewArgs} dom_id=${viewDomId.substring(0, 8)}...`)

  let allHtml = initialHtml
  let page = 1
  let hasMorePages = true

  while (hasMorePages && page <= maxPages) {
    // AJAX pagination uses GET (not POST) with q[] params and ISO dates
    const queryParts = [
      `q%5Bfrom%5D=${dateFrom}`,
      `q%5Bto%5D=${dateTo}`,
      `q%5Bwhat%5D%5Ball%5D=all`,
      `q%5Bfield_posizione_proximity%5D%5Bvalue%5D=40`,
      `q%5Bdate_search%5D=`,
      `q%5Blocation%5D=`,
      `q%5Bwhere%5D=`,
      `_wrapper_format=drupal_ajax`,
      `view_name=${viewName}`,
      `view_display_id=${viewDisplayId}`,
      `view_args=${encodeURIComponent(viewArgs)}`,
      `view_path=${encodeURIComponent(viewPath)}`,
      `view_base_path=`,
      `view_dom_id=${viewDomId}`,
      `pager_element=0`,
      `from=${dateFrom}`,
      `to=${dateTo}`,
      `where=`,
      `page=${page}`,
      `_drupal_ajax=1`,
      `ajax_page_state%5Btheme%5D=turismo`,
      `ajax_page_state%5Btheme_token%5D=`,
      `ajax_page_state%5Blibraries%5D=${encodeURIComponent(pageLibraries)}`
    ].join('&')

    const ajaxUrl = `https://www.in-lombardia.it/views/ajax?${queryParts}`

    try {
      const ajaxResponse = await fetchWithRetry(ajaxUrl, {
        headers: {
          'User-Agent': BROWSER_UA,
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
          'Referer': initialUrl
        },
        timeout: 15000,
        retries: 1,
        retryDelay: 500
      })

      const ajaxData: AjaxCommand[] = await ajaxResponse.json()

      const commandNames = ajaxData.map(cmd => cmd.command).filter(Boolean)
      console.log(`[InLombardia] Page ${page} commands: ${commandNames.join(', ')}`)

      const insertCommand = ajaxData.find(cmd =>
        cmd.command === 'insert' ||
        cmd.command === 'views_infinite_scroll_insert_view' ||
        cmd.command === 'views_infinite_scroll_content_selector' ||
        cmd.command === 'replaceWith' ||
        cmd.command === 'append' ||
        (cmd.data && typeof cmd.data === 'string' && cmd.data.includes('<article'))
      )

      if (insertCommand && insertCommand.data) {
        const pageHtml = insertCommand.data
        const eventCount = (pageHtml.match(/<article/g) || []).length

        if (eventCount === 0) {
          hasMorePages = false
        } else {
          allHtml += pageHtml
          console.log(`[InLombardia] Page ${page}: ${eventCount} events`)
          page++
        }
      } else {
        hasMorePages = false
      }
    } catch (error) {
      console.log(`[InLombardia] Page ${page} error: ${error instanceof Error ? error.message : 'unknown'}`)
      hasMorePages = false
    }
  }

  console.log(`[InLombardia] Pagination complete: ${page - 1} AJAX pages fetched`)
  return allHtml
}

export function parseInLombardiaCards(html: string): ParseOutcome {
  const events: ParsedEvent[] = []

  // Regex pattern: Find all <article class="...c-card..."> blocks
  const cardMatches = html.match(/<article[^>]*class="[^"]*c-card[^"]*"[^>]*>([\s\S]*?)<\/article>/g)

  if (!cardMatches) {
    return { events }
  }

  cardMatches.forEach(card => {
    // Extract title
    const titleMatch = card.match(/<h4[^>]*class="c-card__title"[^>]*>([^<]+)<\/h4>/)
    const title = titleMatch ? titleMatch[1].trim() : null

    // Extract venue from <span class="organization"> inside c-card__location
    const venueMatch = card.match(/<span[^>]*class="[^"]*organization[^"]*"[^>]*>([^<]+)<\/span>/)
    const venue = venueMatch ? venueMatch[1].trim() : null

    // Extract address from <span class="address-line1"> inside c-card__location
    const addressMatch = card.match(/<span[^>]*class="[^"]*address-line1[^"]*"[^>]*>([^<]+)<\/span>/)
    const address = addressMatch ? addressMatch[1].trim() : null

    // Extract date from <time> elements inside c-card__date block (DD/MM/YYYY format)
    // Supports single dates and date ranges (two <time> elements)
    const timeMatches = [...card.matchAll(/<time[^>]*>(\d{2}\/\d{2}\/\d{4})<\/time>/g)]
    let dateStr: string | null = null
    if (timeMatches.length >= 2) {
      dateStr = `${timeMatches[0][1]} - ${timeMatches[1][1]}`
    } else if (timeMatches.length === 1) {
      dateStr = timeMatches[0][1]
    }

    // Extract category
    const categoryMatch = card.match(/<div[^>]*class="c-card__labels"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/)
    const category = categoryMatch ? he.decode(categoryMatch[1].trim()) : null

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

  return { events }
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

    return parseInLombardiaDetail(html).detail
  } catch (error) {
    // On error, return null data (graceful degradation)
    return { description: null, venueName: null, fullAddress: null, phone: null, latitude: null, longitude: null }
  }
}

// Riceve l'HTML gia' scaricato e non fa alcuna rete: fetchDetailPage resta responsabile
// del solo fetchWithRetry. Corpo identico a prima dell'estrazione, zero logica nuova.
export function parseInLombardiaDetail(html: string): DetailParseOutcome {
  try {
    let description: string | null = null
    let venueName: string | null = null
    let fullAddress: string | null = null
    let phone: string | null = null
    let latitude: number | null = null
    let longitude: number | null = null

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

    // Fallback: extract description from HTML if JSON-LD didn't provide it
    if (!description) {
      // Find the opening tag of body-readmore, then extract until the matching closing </div>
      const startMatch = html.match(/<div[^>]*class="body-readmore"[^>]*>/)
      if (startMatch && startMatch.index !== undefined) {
        const contentStart = startMatch.index + startMatch[0].length
        let depth = 1
        let i = contentStart
        while (i < html.length && depth > 0) {
          if (html.startsWith('<div', i)) depth++
          else if (html.startsWith('</div', i)) depth--
          if (depth > 0) i++
        }
        const innerHtml = html.slice(contentStart, i).trim()
        if (innerHtml.length > 0) {
          // Keep formatting tags, strip only scripts/styles and unwanted attributes
          description = innerHtml
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/\s+class="[^"]*"/g, '')
            .replace(/\s+id="[^"]*"/g, '')
            .replace(/\s+style="[^"]*"/g, '')
            .replace(/\s+/g, ' ')
            .trim()
        }
      }
    }

    // Extract coordinates from c-map data-url: @lat,lng,zoom
    const mapMatch = html.match(/class="c-map"[^>]*data-url="[^"]*@([\d.\-]+),([\d.\-]+)/)
    if (mapMatch) {
      latitude = parseFloat(mapMatch[1])
      longitude = parseFloat(mapMatch[2])
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

    return { detail: { description, venueName, fullAddress, phone, latitude, longitude } }
  } catch {
    // On error, return null data (graceful degradation) — comportamento identico a prima
    return { detail: { description: null, venueName: null, fullAddress: null, phone: null, latitude: null, longitude: null } }
  }
}

async function fetchDetailPages(events: ParsedEvent[]): Promise<Map<string, DetailData>> {
  const detailDataMap = new Map<string, DetailData>()

  // Filter to only events with valid URLs
  const eventsWithUrls = events.filter(e => e.url && e.url.startsWith('http'))

  const eventsToFetch = eventsWithUrls

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
    const latitude = detailData?.latitude ?? null
    const longitude = detailData?.longitude ?? null

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
      latitude,
      longitude,
      category: data.category || 'Evento',
      sourceUrl: data.url || 'https://www.in-lombardia.it',
      imageUrl: data.image,
      phone
    })
  }

  return results
}
