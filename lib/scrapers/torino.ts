/**
 * Adattatore Comune di Torino — `eventi.comune.torino.it`.
 *
 * Base giuridica: il Comune e' una PA, quindi art. 52 comma 2 CAD (dati
 * pubblicati senza licenza espressa = dati aperti). Il `robots.txt` del sito
 * vieta solo `/wp-admin/` e non dichiara alcun Crawl-delay; `/wp-json/` e'
 * consentito. La pausa fra le pagine qui sotto e' comunque volontaria.
 *
 * COME SI LEGGE, e perche' non e' ovvio:
 *
 * Il sito e' WordPress con la REST pubblica aperta e un tipo di contenuto
 * dedicato, `event`. `X-WP-Total` dichiara ~6.750 elementi, ma quello e'
 * l'ARCHIVIO STORICO: contando i futuri sulle prime 600 pubblicazioni la curva
 * converge (39, 16, 8, 0, 0, 3), cioe' **~70-90 eventi ancora da venire**.
 * Scaricare 68 pagine per trovarne ottanta sarebbe assurdo, e il numero
 * grande non e' il numero utile — errore commesso e corretto il 2026-09-20.
 *
 * Il campo `date` del record e' la data di PUBBLICAZIONE, non dell'evento: la
 * data vera vive dentro `content.rendered`, in markup pulito con un selettore
 * per campo (`.entry-date`, `.entry-location`, `.entry-address`,
 * `.entry-category`). Si legge con cheerio, MAI con espressioni regolari — il
 * gate `check:no-regex-parsing` vieta esattamente quello, e a ragione.
 *
 * La sorgente NON porta coordinate: resta l'indirizzo, e l'aggancio al punto
 * lo fa il backfill territoriale (lib/territorial/backfill.ts) come per
 * in-lombardia. E' la differenza con Firenze, che le coordinate ce le ha.
 *
 * Self-check: `npx tsx lib/scrapers/torino.ts`.
 */
import * as cheerio from 'cheerio'
import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'
import { categoryFromTitle } from '../categories/fromTitle'
import { readFileSync } from 'fs'
import { join } from 'path'

export const TORINO_API = 'https://eventi.comune.torino.it/wp-json/wp/v2/event'

/** Il massimo che l'API accetta per pagina. */
const TORINO_PER_PAGE = 100

/**
 * Tetto difensivo: 12 pagine = 1.200 pubblicazioni piu' recenti, ben oltre le
 * 6 in cui i futuri si esauriscono. Indipendente dall'arresto anticipato
 * sotto — se quello non scattasse per un cambio di comportamento della
 * sorgente, questo impedisce comunque di scaricare l'intero archivio.
 */
export const TORINO_MAX_PAGES = 12

/**
 * Le pagine si ordinano per data di PUBBLICAZIONE decrescente, non per data
 * evento (che l'API non conosce), quindi i futuri non sono tutti in testa: la
 * misura reale ha dato 39, 16, 8, 0, 0, 3. Fermarsi al primo buco perderebbe
 * quei 3. Tre pagine consecutive a secco sono il compromesso fra "non
 * scaricare l'archivio" e "non perdere la coda".
 */
const TORINO_EMPTY_PAGES_BEFORE_STOP = 3

/** Pausa volontaria fra le pagine: il sito non dichiara un Crawl-delay. */
const TORINO_PAGE_DELAY_MS = 1000

export interface TorinoRecord {
  id?: number
  date?: string
  link?: string
  title?: { rendered?: string }
  content?: { rendered?: string }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function scrapeTorino(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    const events: ScrapedEvent[] = []
    const seen = new Set<string>()
    let emptyStreak = 0

    for (let page = 1; page <= TORINO_MAX_PAGES; page++) {
      if (page > 1) await sleep(TORINO_PAGE_DELAY_MS)

      const url = `${TORINO_API}?per_page=${TORINO_PER_PAGE}&page=${page}&orderby=date&order=desc`
      const response = await fetchWithRetry(url)
      const records = (await response.json()) as TorinoRecord[]
      if (!Array.isArray(records) || records.length === 0) break

      const pageEvents = transformTorinoRecords(records, params)
      let added = 0
      for (const event of pageEvents) {
        if (seen.has(event.sourceId)) continue
        seen.add(event.sourceId)
        events.push(event)
        added++
      }

      emptyStreak = added === 0 ? emptyStreak + 1 : 0
      if (emptyStreak >= TORINO_EMPTY_PAGES_BEFORE_STOP) break
      if (records.length < TORINO_PER_PAGE) break
    }

    return { events, source: 'torino', duration: Date.now() - startTime }
  } catch (error) {
    return {
      events: [],
      source: 'torino',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * `.entry-date` porta forme come "20/09/2026 - 15:00 - 19:00" oppure
 * "Dal 01/10/2026 al 05/10/2026". Si prende la PRIMA data come inizio e, se
 * ce n'e' una seconda, quella come fine — gli orari si ignorano: il progetto
 * ragiona su giorni, non su fasce orarie.
 */
export function parseTorinoDates(raw: string): { start: Date; end: Date | null } | null {
  const found = raw.match(/\d{2}\/\d{2}\/\d{4}/g)
  if (!found || found.length === 0) return null
  const toDate = (s: string) => {
    const [d, m, y] = s.split('/').map(Number)
    const date = new Date(y, m - 1, d)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const start = toDate(found[0])
  if (!start) return null
  const end = found.length > 1 ? toDate(found[found.length - 1]) : null
  // Una "fine" precedente all'inizio e' un dato incoerente: si scarta la fine
  // invece di scrivere un intervallo rovesciato che romperebbe ogni query.
  return { start, end: end && end >= start ? end : null }
}

export function transformTorinoRecords(
  records: TorinoRecord[],
  params: ScrapeParams = {}
): ScrapedEvent[] {
  const from = params.dateFrom ? new Date(params.dateFrom) : new Date()
  from.setHours(0, 0, 0, 0)
  const to = params.dateTo ? new Date(params.dateTo) : null

  const events: ScrapedEvent[] = []

  for (const record of records) {
    const html = record.content?.rendered
    const rawTitle = record.title?.rendered
    if (!html || !rawTitle) continue

    // cheerio anche per il titolo: `title.rendered` di WordPress porta entita'
    // HTML (&#8217; per l'apostrofo). Decodificarle a mano sarebbe la solita
    // regex su HTML che il progetto vieta.
    const title = cheerio.load(`<span>${rawTitle}</span>`)('span').text().trim()
    if (!title) continue

    const $ = cheerio.load(html)
    const dateText = $('.entry-date').first().text().trim()
    if (!dateText) continue
    const dates = parseTorinoDates(dateText)
    if (!dates) continue

    const effectiveEnd = dates.end ?? dates.start
    if (effectiveEnd < from) continue
    if (to && dates.start > to) continue

    // `.entry-address` e' annidato DENTRO `.entry-location`: letto per primo e
    // poi rimosso, altrimenti il nome della sede se lo porterebbe appresso.
    const locationNode = $('.entry-location').first()
    const address = locationNode.find('.entry-address').first().text().trim() || null
    locationNode.find('.entry-address').remove()
    const locationName = locationNode.text().replace(/\s+/g, ' ').trim() || null

    const rawCategory = $('.entry-category').first().text().trim() || null

    const description = $('.description').first().text().replace(/\s+/g, ' ').trim().substring(0, 500)

    const imageUrl = $('.imgevent img').first().attr('src') || null

    // L'id numerico di WordPress e' stabile e presente su ogni record: non
    // serve costruire una chiave dal titolo come per Firenze. La data entra
    // comunque nella chiave perche' un evento ricorrente ha un solo post ma
    // piu' occorrenze, e senza la data la seconda sovrascriverebbe la prima.
    const sourceId = `${record.id ?? title.toLowerCase()}#${dates.start.toISOString().slice(0, 10)}`

    events.push({
      source: 'torino',
      sourceId,
      title,
      description: description.length > 0 ? description : null,
      dateStart: dates.start,
      dateEnd: dates.end,
      locationName,
      address,
      // La sorgente non porta coordinate: ci pensa il backfill territoriale.
      latitude: null,
      longitude: null,
      // La categoria dichiarata dal sito vince sul titolo quando c'e'; il
      // titolo e' il ripiego, come per l'Alto Adige.
      category: rawCategory || categoryFromTitle(title),
      sourceUrl: record.link ?? null,
      imageUrl,
      phone: null
    })
  }

  return events
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fixture = JSON.parse(
    readFileSync(join(__dirname, '__fixtures__', 'torino-events.json'), 'utf-8')
  ) as TorinoRecord[]

  let pass = 0
  let fail = 0
  const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`ok ${pass + fail} - ${name}`) }
    else { fail++; console.log(`not ok ${pass + fail} - ${name}${detail ? ' # ' + detail : ''}`) }
  }

  check('la fixture porta record', fixture.length > 0, `trovati ${fixture.length}`)

  // Finestra ancorata al giorno di cattura della fixture (2026-09-19), non a
  // "oggi": altrimenti il gate darebbe un numero diverso ogni giorno e
  // finirebbe a zero quando la fixture invecchia.
  const events = transformTorinoRecords(fixture, { dateFrom: '2026-09-19' })
  check('estrae eventi futuri dalla fixture', events.length >= 30, `estratti ${events.length} su ${fixture.length}`)

  check('ogni evento ha un titolo non vuoto', events.every((e) => e.title.length > 0))
  check(
    'nessun titolo contiene entita HTML non decodificate',
    events.every((e) => !/&#\d+;|&[a-z]+;/i.test(e.title)),
    events.find((e) => /&#\d+;|&[a-z]+;/i.test(e.title))?.title ?? ''
  )

  const ids = new Set(events.map((e) => e.sourceId))
  check('i sourceId sono unici', ids.size === events.length, `${ids.size} per ${events.length}`)

  const again = transformTorinoRecords(fixture, { dateFrom: '2026-09-19' })
  check(
    'i sourceId sono deterministici fra due esecuzioni',
    JSON.stringify(again.map((e) => e.sourceId)) === JSON.stringify(events.map((e) => e.sourceId))
  )

  check(
    'nessun intervallo rovesciato (dateEnd sempre >= dateStart)',
    events.every((e) => e.dateEnd === null || e.dateEnd >= e.dateStart)
  )

  // La trappola dell'annidamento: se `.entry-address` non fosse rimosso dal
  // nodo location, il nome della sede conterrebbe anche l'indirizzo.
  const withBoth = events.filter((e) => e.locationName && e.address)
  check(
    'il nome della sede non ingloba l indirizzo',
    withBoth.every((e) => !e.locationName!.includes(e.address!)),
    withBoth.find((e) => e.locationName!.includes(e.address!))?.locationName ?? ''
  )
  check('una quota reale di eventi porta una sede', withBoth.length >= events.length * 0.5,
    `${withBoth.length}/${events.length} con sede+indirizzo`)

  const categorized = events.filter((e) => e.category !== null)
  check('quasi tutti gli eventi hanno una categoria', categorized.length >= events.length * 0.9,
    `${categorized.length}/${events.length}`)

  console.log(`1..${pass + fail}`)
  console.log(`# pass ${pass}`)
  console.log(`# fail ${fail}`)
  if (fail > 0) process.exit(1)
}
