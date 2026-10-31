/**
 * Adattatore Lariofiere — polo fieristico di Erba (CO), www.lariofiere.it.
 *
 * Base giuridica: ente privato (consorzio delle Camere di Commercio di Como e
 * Lecco), nessuna licenza dichiarata. robots.txt (Yoast) non vieta nulla e non
 * dichiara Crawl-delay. Si prendono solo FATTI (nome, date, sede) e il link al
 * sito della manifestazione, come fa solosagre: due richieste per esecuzione.
 *
 * DUE PAGINE, perche' nessuna delle due basta da sola:
 *   - la HOMEPAGE ha lo slider con le DATE (`.et_pb_slide`: titolo con link al
 *     sito della fiera, sottotitolo, date in <strong>, sfondo nel CSS inline);
 *   - /nostri-eventi/ ha le DESCRIZIONI ma nessuna data. Il join e' sul dominio
 *     del sito della fiera (www.young.co.it), l'unica chiave comune.
 * Uno slide senza date (Make Como, Lake Como: promozione, non eventi) si scarta.
 *
 * Volume: ~6 manifestazioni future alla volta (2026-10-31). Poche, ma grandi
 * (MOMA, Young, Erba Elettronica) e tutte nello stesso posto, che e' noto:
 * coordinate fisse dal nodo OSM "Centro Lario Fiere".
 *
 * Trappole del dato, viste sulla fixture del 2026-10-31:
 *   1. Date a pezzi: "24 – 25, 30 – 31 Ottobre 2026" + "1 Novembre 2026" in
 *      due <strong>. Mese e anno valgono per i giorni che li precedono. Si
 *      tiene il primo giorno come inizio e l'ultimo come fine.
 *      ponytail: le aperture a weekend alterni diventano un intervallo unico,
 *      il modello Event ha una sola coppia di date.
 *   2. Trattino lungo (U+2013) o corto, con o senza spazi.
 *   3. Nessun id: sourceId = dominio del sito della fiera + anno di inizio,
 *      stabile anche se la fiera viene spostata di qualche giorno.
 *
 * L'HTML si legge con cheerio; l'unica regex su markup e' sul TESTO CSS
 * dello sfondo, che HTML non e'.
 *
 * Self-check: `npx tsx lib/scrapers/lariofiere.ts`.
 */
import * as cheerio from 'cheerio'
import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'
import { readFileSync } from 'fs'
import { join } from 'path'

export const LARIOFIERE_HOME_URL = 'https://www.lariofiere.it/'
export const LARIOFIERE_EVENTI_URL = 'https://www.lariofiere.it/nostri-eventi/'

// Nodo OSM way/1330422970 "Centro Lario Fiere", Viale Resegone, Erba.
const VENUE = {
  locationName: 'Erba',
  address: 'Lariofiere, Viale Resegone, 22036 Erba (CO)',
  latitude: 45.807632,
  longitude: 9.240878
}

const MONTHS: Record<string, number> = {
  gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5,
  luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11
}

/**
 * Trappole 1 e 2. "24 – 25, 30 – 31 Ottobre 2026 1 Novembre 2026" ->
 * { start: 24/10/2026, end: 1/11/2026 }. Null se non c'e' nessuna data intera.
 */
export function parseLariofiereDates(text: string): { start: Date; end: Date | null } | null {
  const re = /\b(\d{1,2})\b(?:\s+([a-zA-Z]+))?(?:\s+(\d{4}))?/g
  const tokens: Array<{ day: number; month?: number; year?: number }> = []
  for (const m of text.matchAll(re)) {
    const month = m[2] ? MONTHS[m[2].toLowerCase()] : undefined
    if (m[2] && month === undefined) continue // "3 padiglioni": non e' una data
    tokens.push({ day: Number(m[1]), month, year: m[3] ? Number(m[3]) : undefined })
  }
  // Mese e anno si propagano all'indietro ai giorni che li precedono.
  let month: number | undefined
  let year: number | undefined
  const dates: Date[] = []
  for (let i = tokens.length - 1; i >= 0; i--) {
    month = tokens[i].month ?? month
    year = tokens[i].year ?? year
    if (month === undefined || year === undefined) continue
    const d = new Date(year, month, tokens[i].day)
    if (d.getDate() === tokens[i].day) dates.push(d)
  }
  if (dates.length === 0) return null
  dates.sort((a, b) => a.getTime() - b.getTime())
  const start = dates[0]
  const end = dates[dates.length - 1]
  return { start, end: end.getTime() === start.getTime() ? null : end }
}

function hostKey(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/** Descrizioni di /nostri-eventi/, indicizzate per dominio del sito della fiera. */
export function parseLariofiereDescriptions(html: string): Map<string, string> {
  const $ = cheerio.load(html)
  const out = new Map<string, string>()
  $('.et_pb_team_member_description').each((_, el) => {
    const box = $(el)
    const key = hostKey(box.find('a[href]').first().attr('href'))
    box.find('a').remove()
    const text = box.find('div').first().text().replace(/\s+/g, ' ').trim()
    if (key && text) out.set(key, text.substring(0, 500))
  })
  return out
}

export function transformLariofiere(
  homeHtml: string,
  eventiHtml: string | null,
  params: ScrapeParams = {}
): ScrapedEvent[] {
  const from = params.dateFrom ? new Date(params.dateFrom) : new Date()
  from.setHours(0, 0, 0, 0)
  const to = params.dateTo ? new Date(params.dateTo) : null

  const $ = cheerio.load(homeHtml)
  const css = $('style').text()
  const descriptions = eventiHtml ? parseLariofiereDescriptions(eventiHtml) : new Map<string, string>()

  const events: ScrapedEvent[] = []
  const seen = new Set<string>()

  $('.et_pb_slide').each((_, el) => {
    const slide = $(el)
    const link = slide.find('.et_pb_slide_title a').first()
    const title = link.text().replace(/\s+/g, ' ').trim()
    const href = link.attr('href')
    const content = slide.find('.et_pb_slide_content')
    const dates = parseLariofiereDates(content.find('strong').map((_, s) => $(s).text()).get().join(' '))
    if (!title || !dates) return

    const effectiveEnd = dates.end ?? dates.start
    if (effectiveEnd < from) return
    if (to && dates.start > to) return

    const host = hostKey(href)
    const sourceId = `${host ?? title.toLowerCase()}|${dates.start.getFullYear()}`
    if (seen.has(sourceId)) return
    seen.add(sourceId)

    content.find('strong').remove()
    const subtitle = content.text().replace(/\s+/g, ' ').trim()
    const slideClass = (slide.attr('class') ?? '').match(/\bet_pb_slide_\d+\b/)?.[0]
    const image = slideClass
      ? new RegExp(`\\.${slideClass}\\{[^}]*background-image:url\\(([^)]+)\\)`).exec(css)?.[1] ?? null
      : null

    const fullTitle = subtitle ? `${title} - ${subtitle}` : title
    events.push({
      source: 'lariofiere',
      sourceId,
      title: fullTitle,
      description: (host && descriptions.get(host)) || subtitle || null,
      dateStart: dates.start,
      dateEnd: dates.end,
      ...VENUE,
      // Tutte fiere per costruzione. Niente categoryFromTitle: "Mostra" in
      // "Mostra Edilizia" la manderebbe in Arte e cultura.
      category: 'Fiere e mercati',
      sourceUrl: href ?? LARIOFIERE_HOME_URL,
      imageUrl: image,
      phone: null
    })
  })

  return events
}

export async function scrapeLariofiere(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()
  try {
    const home = await (await fetchWithRetry(LARIOFIERE_HOME_URL)).text()
    // Le descrizioni sono un di piu': se la seconda pagina cade, gli eventi
    // con le date restano.
    const eventi = await fetchWithRetry(LARIOFIERE_EVENTI_URL).then((r) => r.text()).catch(() => null)
    const events = transformLariofiere(home, eventi, params)
    return { events, source: 'lariofiere', duration: Date.now() - startTime }
  } catch (error) {
    return {
      events: [],
      source: 'lariofiere',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fx = (name: string) => readFileSync(join(__dirname, '__fixtures__', name), 'utf-8')
  const events = transformLariofiere(fx('lariofiere-home.html'), fx('lariofiere-eventi.html'), { dateFrom: '2026-10-01' })

  let pass = 0
  let fail = 0
  const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`ok ${pass + fail} - ${name}`) }
    else { fail++; console.log(`not ok ${pass + fail} - ${name}${detail ? ' # ' + detail : ''}`) }
  }
  const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null)

  const multi = parseLariofiereDates('24 – 25, 30 – 31 Ottobre 2026 1 Novembre 2026')
  check('date a pezzi su due mesi', ymd(multi?.start ?? null) === '2026-10-24' && ymd(multi?.end ?? null) === '2026-11-1', JSON.stringify(multi))
  const dash = parseLariofiereDates('19-20 Dicembre 2026')
  check('trattino corto senza spazi', ymd(dash?.start ?? null) === '2026-12-19' && ymd(dash?.end ?? null) === '2026-12-20')
  const single = parseLariofiereDates('6 Dicembre 2026')
  check('giorno singolo, fine nulla', ymd(single?.start ?? null) === '2026-12-6' && single?.end === null)
  check('testo senza date', parseLariofiereDates('Saper Fare. Far Sapere.') === null)
  check('anno a dicembre, mese a capodanno', ymd(parseLariofiereDates('30 Dicembre 2026 – 2 Gennaio 2027')?.end ?? null) === '2027-1-2')

  check('la fixture produce gli eventi datati', events.length === 6, `prodotti ${events.length}`)
  check('gli slide senza date sono scartati', !events.some((e) => /MAKE COMO/.test(e.title)))
  const moma = events.find((e) => e.title.startsWith('MOMA'))
  check('MOMA: 24 ottobre - 1 novembre', ymd(moma?.dateStart ?? null) === '2026-10-24' && ymd(moma?.dateEnd ?? null) === '2026-11-1')
  const young = events.find((e) => e.title.startsWith('YOUNG'))
  check('descrizione agganciata per dominio', /nuove generazioni/.test(young?.description ?? ''), young?.description ?? 'nessuna')
  check('immagine dallo sfondo dello slide', /young-digital-background\.jpg$/.test(young?.imageUrl ?? ''), young?.imageUrl ?? 'nessuna')
  check('MECI resta una fiera, non arte', events.find((e) => e.title.startsWith('MECI'))?.category === 'Fiere e mercati')
  check('sourceId unici', new Set(events.map((e) => e.sourceId)).size === events.length)
  check('tutti a Erba con coordinate', events.every((e) => e.locationName === 'Erba' && e.latitude !== null))
  check('senza /nostri-eventi/ gli eventi restano', transformLariofiere(fx('lariofiere-home.html'), null, { dateFrom: '2026-10-01' }).length === 6)
  check('dateFrom scarta le fiere concluse', transformLariofiere(fx('lariofiere-home.html'), null, { dateFrom: '2026-12-01' }).length === 2)

  console.log(`1..${pass + fail}`)
  console.log(`# pass ${pass}`)
  console.log(`# fail ${fail}`)
  if (fail > 0) process.exit(1)
}
