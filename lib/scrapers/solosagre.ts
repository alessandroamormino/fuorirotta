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

// Crawl-delay: 5 dichiarato da solosagre.it/robots.txt (D-08), verificato live 2026-08-11
// (08-RESEARCH.md Pattern 2). Tetto difensivo (SOLOSAGRE_MAX_PAGES) indipendente dal
// numero di pagine letto da #paging: quel numero è input remoto non fidato (T-08-16).
export const SOLOSAGRE_CRAWL_DELAY_MS = 5000
export const SOLOSAGRE_MAX_PAGES = 20

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
    // Step 1: Fetch pagina 1 (serve comunque per il contenuto, nessun costo aggiuntivo)
    const page1Response = await fetchWithRetry('https://www.solosagre.it/sagre/lombardia/')
    const page1Html = await page1Response.text()
    const page1Outcome = parseSoloSagreHtml(page1Html)

    const outcomes: ParseOutcome[] = [page1Outcome]

    // Se pagina 1 ha già l'anchor mancante (markup cambiato), non ha senso proseguire
    // la paginazione: il totale letto da #paging su un documento mutato non è affidabile.
    if (!page1Outcome.error) {
      const totalPages = parseSoloSagreTotalPages(page1Html)

      for (let page = 2; page <= totalPages; page++) {
        // Attesa PRIMA della richiesta, scritta nell'adapter (mai dentro fetchWithRetry).
        await new Promise(resolve => setTimeout(resolve, SOLOSAGRE_CRAWL_DELAY_MS))

        const pageResponse = await fetchWithRetry(`https://www.solosagre.it/sagre/lombardia/${page}/`)
        const pageHtml = await pageResponse.text()
        const pageOutcome = parseSoloSagreHtml(pageHtml)

        if (pageOutcome.error) {
          // Anchor mancante su una pagina successiva: markup cambiato, propagare
          // l'errore come stabilito in 08-03 (D-07) e fermarsi.
          outcomes.push(pageOutcome)
          break
        }

        if (pageOutcome.events.length === 0) {
          // Anchor presente, zero eventi: segnale coerente (il sito ha ripaginato
          // mentre lo si leggeva, o N era sovrastimato), non un guasto. Ci si ferma
          // qui senza aggiungere una pagina vuota e senza errore.
          break
        }

        outcomes.push(pageOutcome)
      }
    }

    // Step 2: Unire le pagine raccolte, deduplicando per sourceId
    const merged = mergeSoloSagrePages(outcomes)

    // Step 3: Transform to ScrapedEvent format with filtering
    const events = transformEvents(merged.events, params)

    const duration = Date.now() - startTime

    // Un markup cambiato non è un'eccezione: è un risultato che riporta un errore (D-07).
    // merged.error viene propagato qui, senza passare dal ramo catch.
    return {
      events,
      source: 'solosagre',
      duration,
      ...(merged.error ? { error: merged.error } : {})
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

// Legge il totale pagine dal blocco `#paging` ("Pagina X di N"). Se il blocco è assente,
// una sola pagina di risultati è un esito legittimo: restituisce 1, nessuna richiesta
// aggiuntiva. `N` è input remoto non fidato (T-08-16): un valore non intero, minore di 1
// o assurdamente grande viene rifiutato — il tetto SOLOSAGRE_MAX_PAGES è indipendente dal
// valore letto, così un markup mutato non può tradursi in un ciclo che martella il sito.
export function parseSoloSagreTotalPages(html: string): number {
  const $ = cheerio.load(html)
  const paging = $('#paging')
  if (paging.length === 0) return 1

  const match = paging.text().match(/Pagina\s+\d+\s+di\s+(\d+)/)
  if (!match) return 1

  const total = Number(match[1])
  if (!Number.isFinite(total) || !Number.isInteger(total) || total < 1) return 1
  if (total > SOLOSAGRE_MAX_PAGES) return SOLOSAGRE_MAX_PAGES
  return total
}

// Stesso identificativo usato sia dalla deduplicazione fra pagine sia dalla trasformazione
// finale (transformEvents), così che le due non possano divergere. Se l'evento ha un URL,
// l'id resta quello derivato dall'URL (comportamento invariato). Solo per gli eventi privi
// di URL il ripiego cambia: prima era `String(Math.random())` (mai deduplicabile, una riga
// nuova a ogni esecuzione), ora è deterministico da titolo + data di inizio, così lo stesso
// evento senza URL produce sempre lo stesso sourceId.
export function deriveSoloSagreSourceId(data: Pick<ParsedEvent, 'url' | 'title' | 'date_start'>): string {
  const fromUrl = data.url ? data.url.split('/').pop()?.replace('.html', '') : null
  if (fromUrl) return fromUrl
  return `senza-url:${data.title ?? ''}|${data.date_start ?? ''}`
}

// Concatena gli eventi nell'ordine di pagina e poi di documento, deduplicando per
// sourceId (prima occorrenza vince). Un evento che compare su due pagine adiacenti
// (il sito ripagina mentre lo si sta leggendo) esce una volta sola. L'ordine risultante
// è deterministico e identico fra due esecuzioni sugli stessi input. Se una qualunque
// pagina riporta un errore (anchor mancante), quell'errore è propagato nel risultato.
export function mergeSoloSagrePages(outcomes: ParseOutcome[]): ParseOutcome {
  const seen = new Set<string>()
  const events: ParsedEvent[] = []
  let error: string | undefined

  for (const outcome of outcomes) {
    if (outcome.error && error === undefined) {
      error = outcome.error
    }
    for (const event of outcome.events) {
      const id = deriveSoloSagreSourceId(event)
      if (seen.has(id)) continue
      seen.add(id)
      events.push(event)
    }
  }

  return error !== undefined ? { events, error } : { events }
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

    // Stesso identificativo usato dalla deduplicazione fra pagine (mergeSoloSagrePages),
    // così che le due non possano divergere.
    const sourceId = deriveSoloSagreSourceId(data)

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
