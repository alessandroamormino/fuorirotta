/**
 * SoloSagre.it scraper
 *
 * Fetches and parses HTML from solosagre.it/sagre/lombardia/
 * Fetches event listings, parses HTML via cheerio (DOM selectors), and transforms to Event schema.
 */

import * as cheerio from 'cheerio'
import type { Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'

// Copy esatta della stringa d'errore fissata in 08-UI-SPEC.md/08-RESEARCH.md — usata
// identicamente da entrambi gli scraper HTML quando l'anchor strutturale sparisce (D-07).
export const MARKUP_DRIFT_ERROR = 'Selettore DOM non ha trovato eventi — possibile cambio di markup sulla pagina sorgente.'

// Testo di un elemento cheerio, o null se l'elemento non contiene alcun carattere
// (replica la semantica della vecchia regex `[^<]+`, che richiedeva almeno un carattere
// per considerare il campo presente — uno span vuoto restituiva `null`, non "").
function textOrNull(el: Cheerio<AnyNode>): string | null {
  const raw = el.text()
  return raw.length > 0 ? raw.trim() : null
}

interface ParsedEvent {
  title: string | null
  url: string | null
  date_start: string | null
  date_end: string | null
  location: string | null
  description: string | null
  image: string | null
}

// Forma condivisa da tutte le funzioni pure di parsing della Fase 8 (D-07 le userà
// per il fail-loudly quando cheerio sostituirà queste regex in 08-03). Oggi `error`
// non viene mai valorizzato: il comportamento resta identico a prima di questa estrazione.
interface ParseOutcome {
  events: ParsedEvent[]
  error?: string
}

export async function scrapeSoloSagre(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    // Step 1: Fetch HTML from SoloSagre with retry logic
    const response = await fetchWithRetry('https://www.solosagre.it/sagre/lombardia/')
    const html = await response.text()

    // Step 2: Parse HTML to extract events
    const outcome = parseSoloSagreHtml(html)

    // Step 3: Transform to ScrapedEvent format with filtering
    const events = transformEvents(outcome.events, params)

    const duration = Date.now() - startTime

    // Un markup cambiato non è un'eccezione: è un risultato che riporta un errore (D-07).
    // outcome.error viene propagato qui, senza passare dal ramo catch.
    return {
      events,
      source: 'solosagre',
      duration,
      ...(outcome.error ? { error: outcome.error } : {})
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

export function parseSoloSagreHtml(html: string): ParseOutcome {
  const $ = cheerio.load(html)

  // Anchor strutturale (D-07): deve sempre esistere se il template non è cambiato.
  // Il selettore CSS confronta i token di classe, non la stringa intera dell'attributo,
  // quindi resta valido anche con `class="postList "` (spazi aggiuntivi nella fixture reale).
  const container = $('.postList')
  if (container.length === 0) {
    return { events: [], error: MARKUP_DRIFT_ERROR }
  }

  const events: ParsedEvent[] = []

  container.find('.post').each((_, el) => {
    const post = $(el)

    const title = textOrNull(post.find('[itemprop="name"]'))
    const url = post.find('a[href^="https://www.solosagre.it/"]').first().attr('href') ?? null
    const date_start = post.find('[itemprop="startDate"]').attr('datetime') ?? null
    const date_end = post.find('[itemprop="endDate"]').attr('datetime') ?? null
    const location = textOrNull(post.find('[itemprop="location"]'))
    const description = textOrNull(post.find('[itemprop="description"]'))
    const truncatedDescription = description !== null ? description.substring(0, 500) : null
    const image = post.find('img').first().attr('src') ?? null

    // Only add if we have at least title and start date (comportamento invariato)
    if (title && date_start) {
      events.push({
        title,
        url,
        date_start,
        date_end,
        location,
        description: truncatedDescription,
        image
      })
    }
  })

  return { events }
}

function transformEvents(parsedEvents: ParsedEvent[], params: ScrapeParams): ScrapedEvent[] {
  // Set default date range (today to 6 months from now)
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
    const eventStartDate = new Date(data.date_start)
    eventStartDate.setHours(0, 0, 0, 0)

    const eventEndDate = data.date_end ? new Date(data.date_end) : new Date(eventStartDate)
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
