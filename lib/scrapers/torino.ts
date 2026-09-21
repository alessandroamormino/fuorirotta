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

/**
 * 20, non il massimo che l'API accetterebbe: la sorgente va in **HTTP 500 con
 * corpo vuoto** sulle risposte grandi. Misurato dal server di produzione il
 * 2026-09-21, dopo che l'adattatore ha fallito due notti di fila:
 *
 *   per_page=5   -> 200,  28 KB
 *   per_page=20  -> 200, 132 KB   <- otto pagine su otto, 125-198 KB
 *   per_page=50  -> 500, 0 byte
 *   per_page=100 -> 500, 0 byte
 *
 * E' un errore fatale di PHP lato loro (torna in 1,4s con corpo vuoto), non
 * un timeout. Non e' nemmeno una soglia netta: a `per_page=100` la pagina 5
 * ha risposto 200 con 665 KB mentre 1, 2, 3, 4 e 6 davano 500. Da qui il
 * valore basso E la tolleranza alle pagine cadute nel ciclo sotto: la
 * sorgente e' instabile, non solo limitata. Quando la fixture e' stata
 * catturata, il 2026-09-19, `per_page=100` funzionava ancora.
 */
export const TORINO_PER_PAGE = 20

/**
 * I due tetti sono in PUBBLICAZIONI, non in pagine, di proposito.
 *
 * Erano "12 pagine" e "3 pagine a secco" tarati su pagine da 100. Abbassare
 * `TORINO_PER_PAGE` a 20 lasciandoli in pagine avrebbe significato leggere
 * 240 pubblicazioni invece di 1.200 e arrendersi dopo 60 vuote invece di 300
 * — cioe' fermarsi DENTRO il buco che la misura reale documenta (39, 16, 8,
 * 0, 0, 3 futuri sulle prime sei pagine da 100) e perdere la coda, in
 * silenzio. In pubblicazioni il ragionamento non va rifatto la prossima volta
 * che la sorgente cambia idea sulla dimensione massima.
 */
export const TORINO_MAX_RECORDS = 1200
const TORINO_EMPTY_RECORDS_BEFORE_STOP = 300

/** Derivati, mai digitati a mano: e' il punto dei due tetti qui sopra. */
export const TORINO_MAX_PAGES = Math.ceil(TORINO_MAX_RECORDS / TORINO_PER_PAGE)
const TORINO_EMPTY_PAGES_BEFORE_STOP = Math.ceil(
  TORINO_EMPTY_RECORDS_BEFORE_STOP / TORINO_PER_PAGE
)

/**
 * Quante pagine consecutive cadute prima di arrendersi. Con sessanta pagine
 * da tentare, insistere su una sorgente davvero giu' significherebbe due
 * minuti di richieste inutili ad ogni giro notturno.
 */
const TORINO_MAX_FAIL_STREAK = 5

/** Pausa volontaria fra le pagine: il sito non dichiara un Crawl-delay. */
const TORINO_PAGE_DELAY_MS = 500

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
    let okPages = 0
    let failedPages = 0
    let failStreak = 0

    for (let page = 1; page <= TORINO_MAX_PAGES; page++) {
      if (page > 1) await sleep(TORINO_PAGE_DELAY_MS)

      const url = `${TORINO_API}?per_page=${TORINO_PER_PAGE}&page=${page}&orderby=date&order=desc`

      let records: TorinoRecord[]
      try {
        const response = await fetchWithRetry(url)
        records = (await response.json()) as TorinoRecord[]
      } catch (pageError) {
        // Una pagina caduta NON butta via le precedenti. Prima il try/catch
        // stava attorno all'intero ciclo, quindi un solo HTTP 500 azzerava
        // anche cio' che era gia' stato raccolto — con una sorgente che va in
        // 500 a caso (vedi TORINO_PER_PAGE) e sessanta pagine da scaricare,
        // era la differenza fra funzionare quasi sempre e non funzionare mai.
        failedPages++
        failStreak++
        console.warn(
          `[torino] pagina ${page} saltata: ${pageError instanceof Error ? pageError.message : pageError}`
        )
        // Una pagina caduta e' SCONOSCIUTA, non vuota: non tocca emptyStreak,
        // o un tratto di 500 farebbe credere all'arresto anticipato di essere
        // arrivato in fondo all'archivio.
        if (failStreak >= TORINO_MAX_FAIL_STREAK) {
          console.warn(`[torino] ${failStreak} pagine consecutive cadute: mi fermo qui`)
          break
        }
        continue
      }
      failStreak = 0

      if (!Array.isArray(records) || records.length === 0) break
      okPages++

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

    // Nessuna pagina letta = la sorgente e' giu', e va detto. Qualche pagina
    // persa su molte riuscite NON e' un fallimento: il raccolto ridotto si
    // vede da solo nel conteggio di scrape_runs, che e' cio' che
    // computeSourceHealth confronta con la propria baseline.
    if (okPages === 0) {
      return {
        events: [],
        source: 'torino',
        duration: Date.now() - startTime,
        error: `nessuna pagina leggibile: ${failedPages} cadute su ${TORINO_MAX_PAGES} tentate`
      }
    }
    if (failedPages > 0) {
      console.warn(`[torino] ${okPages} pagine lette, ${failedPages} saltate`)
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

  // La trappola dell'abbassamento di per_page: i tetti sono in PUBBLICAZIONI e
  // le pagine si derivano. Se qualcuno tornasse a scriverli in pagine, o
  // abbassasse ancora per_page senza rifare il conto, la portata crollerebbe
  // in SILENZIO — e l'adattatore si fermerebbe dentro il buco misurato (39,
  // 16, 8, 0, 0, 3 futuri sulle prime sei pagine da 100) perdendo la coda.
  // I due numeri qui sono scritti a mano apposta: se coincidessero per
  // costruzione con quelli del modulo, l'asserzione non proverebbe nulla.
  check(
    'la portata resta di almeno 1.200 pubblicazioni',
    TORINO_MAX_PAGES * TORINO_PER_PAGE >= 1200,
    `${TORINO_MAX_PAGES} pagine x ${TORINO_PER_PAGE} = ${TORINO_MAX_PAGES * TORINO_PER_PAGE}`
  )
  check(
    'l arresto anticipato tollera almeno 300 pubblicazioni a secco',
    TORINO_EMPTY_PAGES_BEFORE_STOP * TORINO_PER_PAGE >= 300,
    `${TORINO_EMPTY_PAGES_BEFORE_STOP} pagine x ${TORINO_PER_PAGE} = ${TORINO_EMPTY_PAGES_BEFORE_STOP * TORINO_PER_PAGE}`
  )

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
