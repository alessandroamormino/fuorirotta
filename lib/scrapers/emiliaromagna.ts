/**
 * Emilia-Romagna OpenData scraper (ROLL-01, Fase 15)
 *
 * Scarica JSON da emiliaromagnaturismo.it/opendata/v1/events — API pubblica
 * senza chiave (schema OpenAPI letto in 15-RESEARCH.md: parametri dichiarati
 * lang, istat, city, prov, page, limit, updated — nessun filtro data lato
 * server, applicato qui lato client come fa gia' transformEvents in
 * solosagre.ts).
 *
 * L'endpoint /events ha mostrato un comportamento intermittente verificato in
 * ricerca (una risposta piena, quattro identiche successive con
 * meta.total:0, 15-RESEARCH.md Pitfall 3) — per questo il self-check in
 * fondo a questo file gira SOLO sulla fixture salvata, mai sulla rete.
 */

import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'
import { readFileSync } from 'fs'
import { join } from 'path'

export interface EmiliaRomagnaLocation {
  title?: string | null
  city?: string | null
  province?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
}

export interface EmiliaRomagnaCategory {
  id: number
  parent: number
  name: string
}

export interface EmiliaRomagnaRecord {
  id: number
  title?: string | null
  description?: string | null
  permalink?: string | null
  category?: EmiliaRomagnaCategory[]
  locations?: EmiliaRomagnaLocation[]
  dates?: {
    from?: string | null // "YYYY/MM/DD"
    to?: string | null
  }
}

interface EmiliaRomagnaEventsResponse {
  data: EmiliaRomagnaRecord[]
  meta?: { total?: number }
}

export async function scrapeEmiliaRomagna(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    // page/limit sono gli unici parametri di paginazione dichiarati dallo
    // schema OpenAPI (15-RESEARCH.md): nessun filtro data lato server, quindi
    // il periodo richiesto si applica lato client in transformEmiliaRomagnaRecords.
    const url = 'https://emiliaromagnaturismo.it/opendata/v1/events?lang=it&page=1&limit=200'
    const response = await fetchWithRetry(url)
    const body: EmiliaRomagnaEventsResponse = await response.json()

    const events = transformEmiliaRomagnaRecords(body.data ?? [], params)

    const duration = Date.now() - startTime
    // meta.total a zero non e' un errore (15-RESEARCH.md Pitfall 3): un
    // provider che risponde vuoto e' un problema della sorgente, non dello
    // scrape. Propagare un errore fatale qui spegnerebbe la regione per un
    // problema altrui — il meccanismo corretto e' gia' D-01/D-02
    // (lib/coverage/liveRegions.ts): la regione scende sotto soglia e si
    // spegne da sola se il vuoto persiste. Nessun campo `error` qui, per
    // costruzione: questa funzione lo valorizza SOLO nel ramo catch sotto.
    return { events, source: 'emilia-romagna', duration }
  } catch (error) {
    const duration = Date.now() - startTime
    return {
      events: [],
      source: 'emilia-romagna',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// opendata.ts e' l'analogo: strip dei tag di markup + trim + tetto a 500
// caratteri, stesso limite delle altre fonti (T-08-19).
function normalizeDescription(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500)
}

// "2026/03/05" -> Date locale a mezzanotte. La sorgente usa questo formato
// per dates.from/dates.to, diverso dall'ISO 8601 delle altre fonti.
function parseSlashDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const match = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})/)
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return Number.isNaN(date.getTime()) ? null : date
}

export function transformEmiliaRomagnaRecords(
  records: EmiliaRomagnaRecord[],
  params: ScrapeParams = {}
): ScrapedEvent[] {
  // Set default date range (today to 6 months from now) — stesso default di
  // opendata.ts/solosagre.ts.
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

  for (const record of records) {
    const eventStartDate = parseSlashDate(record.dates?.from)
    // Un evento senza data di inizio non e' salvabile con una data inventata
    // (analogo a opendata.ts/solosagre.ts): scartato, non un errore.
    if (!eventStartDate) continue

    const eventEndDate = parseSlashDate(record.dates?.to) ?? new Date(eventStartDate)
    eventEndDate.setHours(23, 59, 59, 999)

    // Filter: event must be active during requested period (stesso criterio
    // di transformEvents in solosagre.ts).
    const isActiveInPeriod = eventStartDate <= dateTo && eventEndDate >= dateFrom
    if (!isActiveInPeriod) continue

    const location = record.locations?.[0]

    results.push({
      source: 'emilia-romagna',
      sourceId: String(record.id),
      title: record.title || 'Evento',
      description: normalizeDescription(record.description),
      dateStart: eventStartDate,
      dateEnd: eventEndDate,
      locationName: location?.city || null,
      address: location?.address || null,
      latitude: typeof location?.lat === 'number' ? location.lat : null,
      longitude: typeof location?.lng === 'number' ? location.lng : null,
      // Solo il primo genere (category[0].name): lo schema porta piu' generi
      // per evento (es. "Cinema" + "Mostre ed Arte"), e CAT-02 vuole una
      // mappatura esplicita a un valore solo, non un'inferenza fra piu' generi.
      category: record.category?.[0]?.name ?? null,
      sourceUrl: record.permalink || 'https://emiliaromagnaturismo.it',
      imageUrl: null, // Nessun campo immagine nello schema osservato
      phone: null // Nessun campo contatto nello schema osservato per /events
    })
  }

  return results
}

// Self-check: `npx tsx lib/scrapers/emiliaromagna.ts`.
// Non un framework di test, solo un demo() con assert che fallisce
// rumorosamente (stesso idioma di lib/dedup/normalizeTitle.ts e
// lib/territorial/resolve.ts) — con l'aggiunta di un riepilogo in formato TAP
// (# tests/# pass/# fail + ok/not ok) cosi' l'evidenza RED/GREEN del ciclo
// TDD di questo task e' verificabile a macchina senza introdurre un framework
// di test nuovo nel progetto.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failed = false
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`)
      failed = true
    }
  }

  const fixturePath = join(__dirname, '__fixtures__', 'emiliaromagna-events.json')
  const fixture: EmiliaRomagnaRecord[] = JSON.parse(readFileSync(fixturePath, 'utf-8'))

  const complete = fixture.find(r => r.id === 67773)
  if (!complete) throw new Error('fixture priva del record id 67773 (Viva Varda!)')
  const missingDate = fixture.find(r => r.id === 900001)
  if (!missingDate) throw new Error('fixture priva del record senza data di inizio (id 900001)')
  const ended = fixture.find(r => r.id === 900002)
  if (!ended) throw new Error('fixture priva del record gia concluso (id 900002)')

  // Record completo -> ScrapedEvent valorizzato (title/dateStart/sourceUrl/category, source corretto)
  const wideWindow = { dateFrom: '2020-01-01', dateTo: '2030-01-01' }
  const transformedComplete = transformEmiliaRomagnaRecords([complete], wideWindow)
  assert(transformedComplete.length === 1, 'un record completo deve produrre esattamente 1 ScrapedEvent')
  if (transformedComplete.length === 1) {
    const ev = transformedComplete[0]
    assert(ev.title === 'Viva Varda!', `atteso title 'Viva Varda!', ottenuto '${ev.title}'`)
    assert(ev.source === 'emilia-romagna', `atteso source 'emilia-romagna', ottenuto '${ev.source}'`)
    assert(ev.dateStart instanceof Date && !Number.isNaN(ev.dateStart.getTime()), 'atteso dateStart valorizzato')
    assert(!!ev.sourceUrl, 'atteso sourceUrl valorizzato')
    assert(ev.category === 'Cinema', `atteso category 'Cinema', ottenuto '${ev.category}'`)
    assert(
      !/[<>]/.test(ev.description ?? ''),
      `la description non deve contenere marcatori HTML, ottenuto '${ev.description}'`
    )
  }

  // Record senza data di inizio -> scartato, non salvato con una data inventata
  const transformedMissing = transformEmiliaRomagnaRecords([missingDate], wideWindow)
  assert(
    transformedMissing.length === 0,
    `un record senza data di inizio non deve produrre eventi, ottenuti ${transformedMissing.length}`
  )

  // Evento gia' concluso nel periodo richiesto -> escluso dal filtro date lato client
  const currentWindow = { dateFrom: '2025-01-01', dateTo: '2030-01-01' }
  const transformedEnded = transformEmiliaRomagnaRecords([ended], currentWindow)
  assert(
    transformedEnded.length === 0,
    `un evento gia concluso nel periodo richiesto deve essere escluso, ottenuti ${transformedEnded.length}`
  )

  // Risposta con lista vuota -> 0 eventi, nessuna eccezione (non un errore fatale)
  const empty = transformEmiliaRomagnaRecords([])
  assert(empty.length === 0, `una lista vuota deve produrre 0 eventi, ottenuti ${empty.length}`)

  const targetTest = 'transformEmiliaRomagnaRecords implements the ROLL-01 adapter behavior (15-02 Task 1)'
  if (failed) {
    console.log(`not ok 1 - ${targetTest}`)
    console.log('# tests 1')
    console.log('# pass 0')
    console.log('# fail 1')
    process.exit(1)
  } else {
    console.log(`ok 1 - ${targetTest}`)
    console.log('# tests 1')
    console.log('# pass 1')
    console.log('# fail 0')
    console.log('[emiliaromagna.ts] self-check OK')
  }
}
