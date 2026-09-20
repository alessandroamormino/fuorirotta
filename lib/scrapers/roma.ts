/**
 * Adattatore Comune di Roma — `www.comune.roma.it`.
 *
 * Base giuridica: il Comune e' una PA, quindi art. 52 comma 2 CAD (dati
 * pubblicati senza licenza espressa = dati aperti). Il sito NON serve un
 * robots.txt: `https://www.comune.roma.it/robots.txt` risponde 302 verso
 * l'SSO (sso.comune.roma.it), cioe' nessuna regola e nessun Crawl-delay
 * dichiarato. La pausa fra le pagine di dettaglio qui sotto e' volontaria.
 *
 * COME SI LEGGE, e perche' non e' ovvio:
 *
 * Il portale e' un CMS custom: niente feed, niente API, niente JSON-LD. La
 * lista paginata `/web/it/eventi.page?pagina=N` esiste (205 pagine) ma e'
 * ordinata per data di PUBBLICAZIONE e risale ad anni fa: l'archivio, non gli
 * eventi vivi. La data dell'evento non c'e' proprio, nelle card della lista.
 *
 * Quello che serve sta altrove, nella stessa pagina: il calendario in cima
 * monta su un array JavaScript inline, `var events = [...]`, con `date`
 * (inizio), `dateto` (fine), `title` e `id` (il percorso della scheda). E'
 * gia' filtrato agli eventi in corso o futuri — `isOnlyForFutureDays` — ed e'
 * IDENTICO su ogni pagina della lista: leggerne una sola basta, misurato il
 * 2026-09-20 confrontando le pagine 1, 2, 3 e 10. Sono 39 righe per 31
 * schede, perche' un evento con piu' sedi compare una volta per sede.
 *
 * Il `title` dell'array porta l'indirizzo appiccicato in coda dopo DUE spazi
 * e un trattino ("Titolo  - Via Tale 1"): e' l'unica forma di indirizzo che
 * la lista offre, presente su 38 righe su 39.
 *
 * La scheda di dettaglio aggiunge descrizione, immagine e — cosa che Torino
 * non ha — le COORDINATE: ogni sede e' un marker Leaflet con `latLng`,
 * `text` (l'indirizzo, dentro <strong>) e `group` (la categoria dichiarata
 * dal sito). 39 marker per 39 righe di calendario, corrispondenza piena
 * misurata sulle 31 schede reali. Le schede si scaricano solo per gli eventi
 * il cui dettaglio non e' gia' in database (ScrapeParams.detailCachedUrls).
 *
 * L'HTML si legge con cheerio, MAI con espressioni regolari (gate S2 di
 * scripts/roma-adapter.test.sh). Le uniche regex qui applicate sono sul
 * TESTO JAVASCRIPT gia' estratto da cheerio, che HTML non e'.
 *
 * Self-check: `npx tsx lib/scrapers/roma.ts`.
 */
import * as cheerio from 'cheerio'
import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'
import { categoryFromTitle } from '../categories/fromTitle'
import { readFileSync } from 'fs'
import { join } from 'path'

export const ROMA_BASE = 'https://www.comune.roma.it'
export const ROMA_LIST_URL = `${ROMA_BASE}/web/it/eventi.page`

/** Pausa volontaria fra le schede: il sito non dichiara un Crawl-delay. */
const ROMA_DETAIL_DELAY_MS = 700

/**
 * Tetto difensivo sulle schede di dettaglio. Il calendario ne porta 31 oggi;
 * se un giorno la sorgente cambiasse filtro e ne servisse l'archivio intero,
 * questo impedisce di scaricare migliaia di pagine in una notte.
 */
export const ROMA_MAX_DETAIL_PAGES = 150

/**
 * Categorie-contenitore del sito: non dicono nulla sul tipo di evento (sotto
 * "Eventi" stanno mostre, teatro e festival insieme, 10 righe su 39). Per
 * queste si usa il ripiego dal titolo, come per una sorgente che la categoria
 * non la dichiara affatto.
 */
const ROMA_GENERIC_GROUPS = new Set(['Eventi', 'Iniziative', 'Progetti'])

export interface RomaRecord {
  /** Data di PUBBLICAZIONE, non dell'evento: qui non si usa. */
  shortDate?: string
  /** Fine dell'evento, ISO. */
  dateto?: string
  /** Inizio dell'evento, ISO. */
  date?: string
  /** Titolo con l'indirizzo appiccicato in coda, entita' HTML comprese. */
  title?: string
  /** Percorso della scheda, es. `/web/it/evento/qualcosa.page`. */
  id?: string
  ctype?: string
}

export interface RomaMarker {
  address: string
  latitude: number
  longitude: number
  group: string | null
}

export interface RomaDetail {
  description: string | null
  imageUrl: string | null
  markers: RomaMarker[]
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Decodifica le entita' HTML di una stringa usando cheerio, mai a mano. */
function decodeEntities(raw: string): string {
  return cheerio.load(`<span>${raw}</span>`)('span').text().replace(/\s+/g, ' ').trim()
}

/** Chiave di confronto fra l'indirizzo della lista e quello del marker. */
function addressKey(raw: string): string {
  return decodeEntities(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Estrae `var events = [...]` dalla pagina lista.
 *
 * Cheerio trova il tag script; l'array e' un literal JavaScript (chiavi senza
 * virgolette, valori fra apici singoli, entita' HTML dentro) e non JSON,
 * quindi si legge a coppie chiave/valore invece di passarlo a JSON.parse.
 * Nessun apice singolo grezzo puo' comparire nei valori: la sorgente li
 * pubblica gia' come `&#39;`.
 */
export function parseRomaCalendar(html: string): RomaRecord[] {
  const $ = cheerio.load(html)
  const scripts = $('script')
    .map((_, el) => $(el).contents().text())
    .get()
  const holder = scripts.find((code) => code.includes('var events = ['))
  if (!holder) return []

  const open = holder.indexOf('var events = [')
  const body = holder.slice(open + 'var events = ['.length)
  const close = body.indexOf('];')
  if (close < 0) return []

  const records: RomaRecord[] = []
  for (const block of body.slice(0, close).split('}')) {
    const pairs = block.matchAll(/(\w+)\s*:\s*'([^']*)'/g)
    const record: Record<string, string> = {}
    for (const [, key, value] of pairs) record[key] = value
    if (record.id && record.title) records.push(record as RomaRecord)
  }
  return records
}

/** Titolo e indirizzo, separati dai DUE spazi prima del trattino. */
export function splitRomaTitle(raw: string): { title: string; address: string | null } {
  const cut = raw.lastIndexOf('  - ')
  if (cut < 0) return { title: decodeEntities(raw), address: null }
  const title = decodeEntities(raw.slice(0, cut))
  const address = decodeEntities(raw.slice(cut + 4))
  return { title, address: address.length > 0 ? address : null }
}

/** Data ISO `YYYY-MM-DD` -> Date locale a mezzanotte, o null se non e' una data. */
function parseIsoDay(raw: string | undefined): Date | null {
  if (!raw) return null
  const parts = raw.split('-').map(Number)
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null
  const date = new Date(parts[0], parts[1] - 1, parts[2])
  return Number.isNaN(date.getTime()) ? null : date
}

/** `/web/it/evento/x.page` -> `x`; `/web/it/evento.page?contentId=EVE1` -> `EVE1`. */
export function romaSlug(path: string): string {
  const query = path.indexOf('?')
  if (query >= 0) {
    const value = path.slice(query + 1).split('=').pop()
    if (value) return value
  }
  const last = path.split('/').pop() ?? path
  return last.replace(/\.page$/, '')
}

export function transformRomaRecords(
  records: RomaRecord[],
  params: ScrapeParams = {}
): ScrapedEvent[] {
  const from = params.dateFrom ? new Date(params.dateFrom) : new Date()
  from.setHours(0, 0, 0, 0)
  const to = params.dateTo ? new Date(params.dateTo) : null

  const events: ScrapedEvent[] = []
  const seen = new Set<string>()

  for (const record of records) {
    // Il calendario monta un solo tipo di contenuto oggi ('eve'); il filtro
    // esiste perche' il giorno in cui ne comparisse un altro non finisca in
    // catalogo come evento senza che nessuno se ne accorga.
    if (record.ctype && record.ctype !== 'eve') continue
    if (!record.id || !record.title) continue

    const start = parseIsoDay(record.date)
    if (!start) continue
    const rawEnd = parseIsoDay(record.dateto)
    // Una fine precedente all'inizio e' un dato incoerente (la sorgente ne
    // pubblica: OperaCamion, Municipio VII, dateto 2026-08-20 su date
    // 2026-09-12): si scarta la fine invece di scrivere un intervallo
    // rovesciato che romperebbe ogni query per data.
    const end = rawEnd && rawEnd >= start ? rawEnd : null

    if ((end ?? start) < from) continue
    if (to && start > to) continue

    const { title, address } = splitRomaTitle(record.title)
    if (!title) continue

    // La scheda NON e' una chiave sufficiente: un evento con piu' sedi o piu'
    // serate compare una volta per (sede, giorno) e condivide un solo URL.
    // Giorno e indirizzo sono il discriminante, ed essendo testo della
    // sorgente sono deterministici fra due esecuzioni.
    const sourceId = [
      romaSlug(record.id),
      start.toISOString().slice(0, 10),
      address ? addressKey(address).replace(/ /g, '-').slice(0, 40) : 'na'
    ].join('#')
    if (seen.has(sourceId)) continue
    seen.add(sourceId)

    events.push({
      source: 'roma',
      sourceId,
      title,
      description: null,
      dateStart: start,
      dateEnd: end,
      // La lista da' l'indirizzo, mai il nome della sede. Qui ci va il
      // COMUNE, come fa firenze.ts: e' l'unico campo che l'aggancio
      // territoriale legge per questa sorgente (namesToTry, strategia
      // 'location_name'), e senza di esso i 37 eventi restavano a
      // comuneId null — misurato, non temuto. Che siano tutti a Roma non e'
      // un'inferenza: e' la definizione della sorgente.
      locationName: 'Roma',
      address,
      // Le coordinate arrivano dalla scheda: vedi applyRomaDetail.
      latitude: null,
      longitude: null,
      category: categoryFromTitle(title),
      sourceUrl: `${ROMA_BASE}${record.id}`,
      imageUrl: null,
      phone: null
    })
  }

  return events
}

/**
 * Legge una scheda di dettaglio: descrizione, immagine e i marker della
 * mappa (indirizzo, coordinate, categoria dichiarata).
 *
 * I marker vivono in uno script inline. Cheerio estrae il TESTO dello script
 * e solo li' si applica una regex: l'HTML della pagina non viene mai toccato
 * da un'espressione regolare.
 */
export function parseRomaDetail(html: string): RomaDetail {
  const $ = cheerio.load(html)
  const main = $('#main')

  const paragraphs = main
    .find('p')
    .not('.List-category')
    .not('.List-date')
    .map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter((text) => text.length > 0)
  const description = paragraphs.join(' ').trim().substring(0, 500)

  const imageUrl = main.find('img').first().attr('src') ?? null

  const code = main
    .find('script')
    .map((_, el) => $(el).contents().text())
    .get()
    .join('\n')

  const markers: RomaMarker[] = []
  const found = code.matchAll(
    /text:\s*'([^']*)'[\s\S]{0,600}?latLng:\s*\[\s*([-0-9.]+)\s*,\s*([-0-9.]+)\s*\][\s\S]{0,600}?group:\s*'([^']*)'/g
  )
  for (const [, rawText, lat, lon, group] of found) {
    const latitude = Number(lat)
    const longitude = Number(lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    markers.push({
      address: decodeEntities(rawText),
      latitude,
      longitude,
      group: group.trim().length > 0 ? group.trim() : null
    })
  }

  return { description: description.length > 0 ? description : null, imageUrl, markers }
}

/**
 * Fonde una scheda su un evento gia' estratto dalla lista. Il marker si
 * sceglie per indirizzo; con una sede sola non c'e' ambiguita' e si prende
 * quella, altrimenti l'evento resta senza coordinate invece di ereditare il
 * punto sbagliato di un'altra sede.
 */
export function applyRomaDetail(event: ScrapedEvent, detail: RomaDetail): ScrapedEvent {
  const wanted = event.address ? addressKey(event.address) : null
  const marker =
    (wanted ? detail.markers.find((m) => addressKey(m.address) === wanted) : undefined) ??
    (detail.markers.length === 1 ? detail.markers[0] : undefined)

  const group = marker?.group ?? null
  const declared = group && !ROMA_GENERIC_GROUPS.has(group) ? group : null

  return {
    ...event,
    description: detail.description ?? event.description,
    imageUrl: detail.imageUrl ?? event.imageUrl,
    latitude: marker?.latitude ?? event.latitude,
    longitude: marker?.longitude ?? event.longitude,
    // La categoria dichiarata dal sito vince sul titolo quando dice qualcosa;
    // i contenitori generici lasciano il campo al ripiego dal titolo, e solo
    // se nemmeno quello riconosce nulla tornano buoni loro (mappano ad
    // 'Altro'): meglio dichiarare Altro che lasciare il campo vuoto.
    category: declared ?? event.category ?? group
  }
}

export async function scrapeRoma(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    const listResponse = await fetchWithRetry(ROMA_LIST_URL)
    const events = transformRomaRecords(parseRomaCalendar(await listResponse.text()), params)

    // Una scheda sola per URL, anche quando serve piu' eventi (sedi o serate
    // diverse): il dettaglio e' identico per tutti.
    const byUrl = new Map<string, ScrapedEvent[]>()
    for (const event of events) {
      if (!event.sourceUrl) continue
      const bucket = byUrl.get(event.sourceUrl)
      if (bucket) bucket.push(event)
      else byUrl.set(event.sourceUrl, [event])
    }

    const enriched: ScrapedEvent[] = []
    let fetched = 0
    for (const [url, group] of byUrl) {
      if (params.detailCachedUrls?.has(url) || fetched >= ROMA_MAX_DETAIL_PAGES) {
        // Dettaglio non scaricato: description/coordinate/immagine restano
        // null e `saveEvents` NON deve sovrascrivere quelli gia' salvati.
        for (const event of group) enriched.push({ ...event, detailSkipped: true })
        continue
      }

      if (fetched > 0) await sleep(ROMA_DETAIL_DELAY_MS)
      fetched++
      try {
        const detailResponse = await fetchWithRetry(url)
        const detail = parseRomaDetail(await detailResponse.text())
        for (const event of group) enriched.push(applyRomaDetail(event, detail))
      } catch {
        // Una scheda irraggiungibile non deve far cadere la regione: l'evento
        // resta quello della lista, con titolo, date e indirizzo.
        for (const event of group) enriched.push({ ...event, detailSkipped: true })
      }
    }

    return { events: enriched, source: 'roma', duration: Date.now() - startTime }
  } catch (error) {
    return {
      events: [],
      source: 'roma',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const listHtml = readFileSync(join(__dirname, '__fixtures__', 'roma-events.html'), 'utf-8')
  const detailHtml = readFileSync(join(__dirname, '__fixtures__', 'roma-detail.html'), 'utf-8')

  let pass = 0
  let fail = 0
  const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`ok ${pass + fail} - ${name}`) }
    else { fail++; console.log(`not ok ${pass + fail} - ${name}${detail ? ' # ' + detail : ''}`) }
  }

  const records = parseRomaCalendar(listHtml)
  check('il calendario inline si legge dalla pagina lista', records.length >= 30, `trovati ${records.length}`)
  check('ogni riga porta id e titolo', records.every((r) => Boolean(r.id && r.title)))

  // Finestra ancorata al giorno di cattura della fixture (2026-09-20), non a
  // "oggi": altrimenti il gate darebbe un numero diverso ogni giorno e
  // finirebbe a zero quando la fixture invecchia.
  const events = transformRomaRecords(records, { dateFrom: '2026-09-20' })
  check('estrae eventi futuri dalla fixture', events.length >= 30, `estratti ${events.length} su ${records.length}`)

  check('ogni evento ha un titolo non vuoto', events.every((e) => e.title.length > 0))
  check(
    'nessun titolo contiene entita HTML non decodificate',
    events.every((e) => !/&#\d+;|&[a-z]+;/i.test(e.title)),
    events.find((e) => /&#\d+;|&[a-z]+;/i.test(e.title))?.title ?? ''
  )
  check(
    'il titolo non si porta appresso l indirizzo',
    events.every((e) => !e.address || !e.title.includes(e.address)),
    events.find((e) => e.address && e.title.includes(e.address))?.title ?? ''
  )
  const withAddress = events.filter((e) => e.address)
  check('quasi tutti gli eventi portano un indirizzo', withAddress.length >= events.length * 0.9,
    `${withAddress.length}/${events.length}`)

  const ids = new Set(events.map((e) => e.sourceId))
  check('i sourceId sono unici', ids.size === events.length, `${ids.size} per ${events.length}`)

  const again = transformRomaRecords(records, { dateFrom: '2026-09-20' })
  check(
    'i sourceId sono deterministici fra due esecuzioni',
    JSON.stringify(again.map((e) => e.sourceId)) === JSON.stringify(events.map((e) => e.sourceId))
  )

  check(
    'nessun intervallo rovesciato (dateEnd sempre >= dateStart)',
    events.every((e) => e.dateEnd === null || e.dateEnd >= e.dateStart)
  )

  // Lo stesso URL con piu' sedi produce piu' eventi: se cosi' non fosse, il
  // discriminante (giorno + indirizzo) del sourceId sarebbe sparito.
  const multi = new Map<string, number>()
  for (const e of events) multi.set(e.sourceUrl!, (multi.get(e.sourceUrl!) ?? 0) + 1)
  check('una scheda con piu sedi produce piu eventi',
    Array.from(multi.values()).some((n) => n > 1),
    `max ${Math.max(...multi.values())} eventi per scheda`)

  const detail = parseRomaDetail(detailHtml)
  check('la scheda porta i marker della mappa', detail.markers.length >= 5, `${detail.markers.length} marker`)
  check('ogni marker ha coordinate dentro il Lazio',
    detail.markers.every((m) => m.latitude > 41 && m.latitude < 43 && m.longitude > 11 && m.longitude < 14),
    JSON.stringify(detail.markers[0] ?? null))
  check('nessun indirizzo di marker contiene markup', detail.markers.every((m) => !m.address.includes('strong')))
  check('la scheda porta una descrizione', (detail.description?.length ?? 0) > 50)

  // La trappola del multi-sede: senza l aggancio per indirizzo tutti e sei
  // gli eventi OperaCamion finirebbero sullo stesso punto.
  const operacamion = events.filter((e) => e.sourceUrl!.includes('operacamion'))
  check('la fixture contiene il caso multi-sede', operacamion.length >= 5, `${operacamion.length} sedi`)
  const merged = operacamion.map((e) => applyRomaDetail(e, detail))
  check('ogni sede prende le proprie coordinate',
    merged.every((e) => e.latitude !== null && e.longitude !== null),
    `${merged.filter((e) => e.latitude === null).length} senza coordinate`)
  check('le coordinate delle sedi sono distinte',
    new Set(merged.map((e) => `${e.latitude},${e.longitude}`)).size === merged.length)
  check('il merge porta descrizione e categoria',
    merged.every((e) => e.description !== null && e.category !== null))

  console.log(`1..${pass + fail}`)
  console.log(`# pass ${pass}`)
  console.log(`# fail ${fail}`)
  if (fail > 0) process.exit(1)
}
