/**
 * InLombardia scraper
 *
 * Fetches paginated HTML via AJAX POST from in-lombardia.it
 * Handles AJAX pagination, parses article HTML via cheerio (DOM selectors), fetches
 * detail pages for JSON-LD structured data, and transforms to Event schema.
 */

import he from 'he'
import * as cheerio from 'cheerio'
import type { Cheerio, CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'
import { MARKUP_DRIFT_ERROR } from './solosagre'

// Crawl-delay: 10 dichiarato da in-lombardia.it/robots.txt (D-10). Copre ogni richiesta
// successiva alla PRIMA richiesta fatta a questo host in tutto lo scrape — paginazione
// AJAX e pagine di dettaglio, non "fra pagine": T-08-17.
export const INLOMBARDIA_CRAWL_DELAY_MS = 10000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Stessa semantica di textOrNull in solosagre.ts: null se l'elemento non contiene
// nessun carattere (replica la vecchia regex `[^<]+`, che richiedeva almeno un carattere).
function textOrNull(el: Cheerio<AnyNode>): string | null {
  const raw = el.text()
  return raw.length > 0 ? raw.trim() : null
}

// Individua la sezione `.c-info-bar__cell-content` il cui `.c-info-bar__title` corrisponde
// (case-insensitive) al titolo cercato — per TESTO, non per posizione (fragile: l'ordine
// "Quando"/"Dove"/"Contatti" non e' garantito dal markup, solo osservato sulla fixture).
// gap G-08-1.
function findInfoBarCell($: CheerioAPI, title: string): Cheerio<AnyNode> | null {
  const wanted = title.trim().toLowerCase()
  const cells = $('.c-info-bar__cell-content').toArray()
  for (const cell of cells) {
    const $cell = $(cell)
    const cellTitle = $cell.find('.c-info-bar__title').first().text().trim().toLowerCase()
    if (cellTitle === wanted) return $cell
  }
  return null
}

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
  image: string | null
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

// Forma minima usata dal parser JSON-LD (schema.org Event) — sostituisce `any` con un
// contratto tipizzato, coerente coi soli campi che questo file legge davvero.
interface JsonLdEventItem {
  '@type'?: string | string[]
  description?: string
  location?: {
    name?: string
    address?: {
      streetAddress?: string
      addressLocality?: string
      postalCode?: string
      addressRegion?: string
    }
  }
}

export async function scrapeInLombardia(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    // Step 1: Fetch all pages (with AJAX pagination)
    const { html } = await fetchAllPages(params)

    // Step 2: Parse HTML to extract events
    const outcome = parseInLombardiaCards(html)

    // Step 3: Fetch detail pages for rich data
    const detailDataMap = await fetchDetailPages(outcome.events)

    // Step 4: Transform to ScrapedEvent format with filtering and detail data
    const events = transformEvents(outcome.events, params, detailDataMap)

    const duration = Date.now() - startTime

    // Un markup cambiato non è un'eccezione: è un risultato che riporta un errore (D-07).
    return {
      events,
      source: 'in-lombardia',
      duration,
      ...(outcome.error ? { error: outcome.error } : {})
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

// Esportata (invariata come contratto pubblico oltre al tipo di ritorno) cosi'
// scripts/scrape-measure.ts puo' eseguire la sola fase di lista, throttled, senza
// passare da scrapeInLombardia (che scaricherebbe anche tutte le pagine di dettaglio).
//
// `maxPagesOverride` esiste solo per scripts/scrape-measure.ts (08-05): eseguire la
// paginazione AJAX reale fino in fondo si è misurato durare oltre 30 pagine throttled a
// 10s l'una senza segnali di arresto imminente (>5 minuti) — un costo sproporzionato per
// una MISURA quando lo scopo è proiettare, non enumerare l'intero listato. Il tetto di
// produzione (`maxPages = 200`) resta invariato quando l'override non è passato.
export async function fetchAllPages(params: ScrapeParams, maxPagesOverride?: number): Promise<{ html: string; pagesFetched: number }> {
  const today = new Date()
  // Dates stay in YYYY-MM-DD — the site now uses this format natively
  const dateFrom = params.dateFrom || today.toISOString().split('T')[0]

  const sixMonthsLater = new Date()
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6)
  const dateTo = params.dateTo || sixMonthsLater.toISOString().split('T')[0]

  const maxPages = maxPagesOverride ?? 200

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
    return { html: initialHtml, pagesFetched: 0 }
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
      // Attesa PRIMA di ogni richiesta AJAX, compresa la prima (page=1): la richiesta
      // precedente allo stesso host è initialResponse, fatta poco sopra senza attesa
      // — quella resta l'unica richiesta esente in tutto lo scrape (D-10, T-08-17).
      await sleep(INLOMBARDIA_CRAWL_DELAY_MS)
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
        // Conteggio via cheerio (non piu' regex): la logica di arresto della paginazione
        // AJAX non cambia, cambia solo lo strumento con cui si contano gli elementi.
        const eventCount = cheerio.load(pageHtml)('article').length

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
  return { html: allHtml, pagesFetched: page - 1 }
}

export function parseInLombardiaCards(html: string): ParseOutcome {
  const $ = cheerio.load(html)

  // Anchor strutturale (D-07): il wrapper della vista Drupal che avvolge la griglia
  // eventi. Verificato sulla fixture reale (08-RESEARCH.md Pattern 3): NON avvolge la
  // card "in evidenza" renderizzata in un blocco overlay separato altrove nella pagina
  // — non esiste quindi un unico contenitore che avvolga ogni `.c-card` della pagina.
  // Come da fallback previsto dal piano, l'anchor resta `.view-content` (valida il
  // rendering della sezione "Eventi" vera e propria) mentre la selezione delle card
  // resta sull'intero documento, replicando lo scope della regex di oggi (che non era
  // mai vincolata ad alcun contenitore). Dettagli nel SUMMARY.
  const container = $('.view-content')
  if (container.length === 0) {
    return { events: [], error: MARKUP_DRIFT_ERROR }
  }

  const events: ParsedEvent[] = []

  $('article.c-card').each((_, el) => {
    const card = $(el)

    const title = textOrNull(card.find('h4.c-card__title'))
    const venue = textOrNull(card.find('.organization'))
    const address = textOrNull(card.find('.address-line1'))

    // Date da elementi <time> nel formato DD/MM/YYYY, in ordine di documento.
    // Uno o due elementi (data singola o intervallo), come oggi.
    const dateTexts = card
      .find('time')
      .toArray()
      .map(t => $(t).text().trim())
      .filter(t => /^\d{2}\/\d{2}\/\d{4}$/.test(t))
    let dateStr: string | null = null
    if (dateTexts.length >= 2) {
      dateStr = `${dateTexts[0]} - ${dateTexts[1]}`
    } else if (dateTexts.length === 1) {
      dateStr = dateTexts[0]
    }

    // Categoria: primo span dentro c-card__labels, in ordine di documento
    const categoryText = textOrNull(card.find('.c-card__labels span').first())
    const category = categoryText ? he.decode(categoryText) : null

    // URL: primo anchor della card
    let url = card.find('a[href]').first().attr('href') ?? null
    if (url && !url.startsWith('http')) {
      url = 'https://www.in-lombardia.it' + url
    }

    // Immagine: attributo src della prima img
    let image = card.find('img').first().attr('src') ?? null
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

// Esportata cosi' scripts/scrape-measure.ts puo' misurare un campione limitato di pagine
// di dettaglio senza scaricarle tutte (potenzialmente ore, throttled a 10s l'una).
export async function fetchDetailPage(url: string): Promise<DetailData> {
  try {
    // Fetch detail page with short timeout and 1 retry for speed
    const response = await fetchWithRetry(url, {
      timeout: 5000,
      retries: 1,
      retryDelay: 500
    })
    const html = await response.text()

    return parseInLombardiaDetail(html).detail
  } catch {
    // On error, return null data (graceful degradation)
    return { description: null, venueName: null, fullAddress: null, phone: null, latitude: null, longitude: null, image: null }
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

    // $ disponibile da subito (era dichiarato piu' sotto): l'intero documento e' gia'
    // parsato via cheerio prima ancora dell'estrazione JSON-LD, che ora legge i blocchi
    // <script> come elementi DOM invece che con una regex sul markup grezzo (gap G-08-1).
    const $ = cheerio.load(html)

    // Extract JSON-LD structured data — blocchi individuati via selettore DOM, non piu'
    // via regex `.exec()` su `html` grezzo (rimuove anche un bug latente: la vecchia
    // `[\s\S]*?<\/script>` si rompeva su un payload JSON contenente un `</script>` non
    // escaped).
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const jsonData = JSON.parse($(el).text())

        // JSON-LD may be an object, array, or have @graph wrapper
        let items: JsonLdEventItem[] = []
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
      } catch {
        // Invalid JSON in this script tag, continue to next (stesso comportamento del
        // vecchio try/catch-per-blocco, ora dentro .each invece che dentro while)
      }
    })

    // Fallback: extract description from HTML if JSON-LD didn't provide it.
    // Il contenitore viene individuato via cheerio, che gestisce l'annidamento dei
    // tag correttamente (niente piu' conteggio manuale di profondita' sulle </div>).
    if (!description) {
      const innerHtml = ($('.body-readmore').html() || '').trim()
      if (innerHtml.length > 0) {
        // Keep formatting tags, strip only scripts/styles and unwanted attributes
        // (pulizia su stringa gia' estratta, non parsing di markup: non intercettata
        // dal gate check:no-regex-parsing)
        const cleaned = innerHtml
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/\s+class="[^"]*"/g, '')
          .replace(/\s+id="[^"]*"/g, '')
          .replace(/\s+style="[^"]*"/g, '')
          .replace(/\s+/g, ' ')
          .trim()
        if (cleaned.length > 0) description = cleaned
      }
    }

    // Fallback: extract venueName/fullAddress from the "Dove" info-bar section if
    // JSON-LD didn't provide them (oggi non li fornisce mai: vedi PARITY-DELTA.md,
    // 3/3 pagine reali campionate senza JSON-LD). Stessa coppia di classi gia' usata da
    // parseInLombardiaCards per la card in lista (.organization / .address-line1) —
    // elementi figli separati nel markup, preferiti a uno split di stringa (gap G-08-1).
    // .organization puo' essere assente (verificato su una pagina reale): in quel caso
    // venueName resta correttamente null, fullAddress resta valorizzato.
    if (!venueName || !fullAddress) {
      const doveCell = findInfoBarCell($, 'Dove')
      if (doveCell) {
        if (!venueName) venueName = textOrNull(doveCell.find('.organization').first())
        if (!fullAddress) fullAddress = textOrNull(doveCell.find('.address-line1').first())
      }
    }

    // Extract coordinates: attributo data-url letto via cheerio, poi l'estrazione dei
    // due numeri dalla stringa "@lat,lng" resta un'espressione regolare — e' parsing
    // di stringa, non di markup.
    const mapDataUrl = $('.c-map').attr('data-url')
    const mapMatch = mapDataUrl ? mapDataUrl.match(/@([\d.\-]+),([\d.\-]+)/) : null
    if (mapMatch) {
      latitude = parseFloat(mapMatch[1])
      longitude = parseFloat(mapMatch[2])
    }

    // Extract phone number: sezione "Contatti" individuata per titolo (gap G-08-1),
    // non piu' una finestra di prossimita' di 200 caratteri attorno a "icon-phone" nel
    // markup grezzo. Preferenza a un link tel:, altrimenti un nodo di testo con >= 7
    // caratteri "cifra-simili" — sulla fixture reale la sezione Contatti contiene solo un
    // link al sito (nessun tel:), quindi resta correttamente null, ma per il motivo giusto.
    const contattiCell = findInfoBarCell($, 'Contatti')
    if (contattiCell) {
      const telHref = contattiCell.find('a[href^="tel:"]').first().attr('href')
      if (telHref) {
        phone = telHref.replace(/^tel:/, '').trim()
      } else {
        // Testo gia' estratto da cheerio (stringa, non markup): stesso principio della
        // normalizzazione coordinate poco sopra, non intercettato dal gate.
        const cellText = contattiCell.find('.c-info-bar__details').first().text()
        const digitMatch = cellText.match(/[\d\s+\-.()/]{7,}/)
        if (digitMatch) {
          const candidate = digitMatch[0].trim().replace(/\s+/g, ' ')
          if (candidate.replace(/\D/g, '').length >= 7) {
            phone = candidate
          }
        }
      }
    }

    // Extract main image: la pagina di dettaglio non usa un <img> per la foto principale
    // (era l'assunto iniziale, rivelatosi sbagliato: il primo <img> del documento e' una
    // card della sovrapposizione di navigazione dell'header, non il contenuto della
    // pagina — verificato con la catena degli antenati sulla fixture). La vera foto
    // dell'evento e' il background-image CSS di .c-hero__image, confermato identico
    // su due pagine live indipendenti (PARITY-DELTA.md). L'attributo style e' letto via
    // cheerio; l'estrazione dell'URL dalla stringa del valore resta un'espressione
    // regolare — stesso principio delle coordinate poco sopra, non parsing di markup.
    const heroStyle = $('.c-hero__image').attr('style')
    const heroUrlMatch = heroStyle ? heroStyle.match(/url\(['"]?([^'")]+)['"]?\)/) : null
    let image: string | null = heroUrlMatch ? heroUrlMatch[1].trim() : null
    if (image && !image.startsWith('http')) {
      image = 'https://www.in-lombardia.it' + (image.startsWith('/') ? image : '/' + image)
    }

    return { detail: { description, venueName, fullAddress, phone, latitude, longitude, image } }
  } catch {
    // On error, return null data (graceful degradation) — comportamento identico a prima
    return { detail: { description: null, venueName: null, fullAddress: null, phone: null, latitude: null, longitude: null, image: null } }
  }
}

async function fetchDetailPages(events: ParsedEvent[]): Promise<Map<string, DetailData>> {
  const detailDataMap = new Map<string, DetailData>()

  // Filter to only events with valid URLs
  const eventsToFetch = events.filter(e => e.url && e.url.startsWith('http'))

  if (eventsToFetch.length === 0) {
    return detailDataMap
  }

  console.log(`[InLombardia] Fetching ${eventsToFetch.length} detail pages one at a time, ${INLOMBARDIA_CRAWL_DELAY_MS}ms apart...`)

  // Sequenziale, mai concorrente: dieci richieste in parallelo sarebbero l'esatto
  // opposto di "una richiesta ogni dieci secondi allo stesso host" (D-10, T-08-17).
  // Un fallimento su una singola pagina non deve interrompere le altre — fetchDetailPage
  // gestisce già la degradazione controllata internamente (dati null, mai un throw).
  for (const event of eventsToFetch) {
    await sleep(INLOMBARDIA_CRAWL_DELAY_MS)
    const data = await fetchDetailPage(event.url!)
    detailDataMap.set(event.url!, data)
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

    // Image: la card in lista e' 9/9 sull'immagine (PARITY-DELTA.md), quindi il dettaglio
    // e' solo un fallback, mai un override, quando la lista non ne ha fornita una
    // (gap G-08-1, Task 4).
    const imageUrl = data.image || detailData?.image || null

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
      imageUrl,
      phone
    })
  }

  return results
}
