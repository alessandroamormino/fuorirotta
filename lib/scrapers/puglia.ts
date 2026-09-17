/**
 * Puglia OpenData scraper (ROLL-02, Fase 15)
 *
 * Scarica in un colpo solo il dump JSON pubblico, non paginato, di
 * osservatorio.dms.puglia.it (15-RESEARCH.md Pattern 3) e lo filtra lato
 * client (tipo_scheda, date) come fa gia' transformEvents in solosagre.ts —
 * la sorgente non filtra per conto tuo.
 *
 * Il campo codice_istat_comune arriva gia' nel dataset: l'aggancio al comune
 * e' per uguaglianza esatta sul codice ISTAT, mai per matching fuzzy — quel
 * percorso (lib/territorial/resolve.ts) esiste per sorgenti che danno solo
 * testo libero, non un codice, e usarlo dove non serve introdurrebbe falsi
 * positivi che l'uguaglianza non ha.
 *
 * VINCOLO DI SICUREZZA NON NEGOZIABILE (T-15-02, threat_model di
 * 15-02-PLAN.md): la verifica del certificato TLS resta nella sua
 * configurazione predefinita di Node in tutto questo file. Se l'host resta
 * irraggiungibile per la catena di certificazione incompleta lato server
 * (verificato in 15-RESEARCH.md Pitfall 2, riverificato in esecuzione), lo
 * scrape fallisce rumorosamente col messaggio della sorgente — cio' che
 * questo file prova e' la trasformazione, non la raggiungibilita' dell'host.
 * Un gate negativo su tutto il repo (scripts/puglia-adapter.test.sh) fallisce
 * se un interruttore di bypass della verifica TLS comparisse ovunque.
 */

import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'
import { readFileSync } from 'fs'
import { join } from 'path'

export interface PugliaRecord {
  tipo_scheda?: string | null
  nm_evento_it?: string | null
  dsc_evento_it?: string | null
  data_inizio?: string | null
  data_fine?: string | null
  comune?: string | null
  codice_istat_comune?: string | null
  categoria?: string | null
  tipologia?: string | null
  latitudine?: string | null
  longitudine?: string | null
  indirizzo?: string | null
}

interface PugliaDumpResponse {
  data: PugliaRecord[]
}

const PUGLIA_DUMP_URL =
  'https://osservatorio.dms.puglia.it/opendata/puglia_eventi_attivita/eventi_attivita.json'

export async function scrapePuglia(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    // Dump JSON unico, non paginato: un solo fetch restituisce tutti i
    // record (15-RESEARCH.md Pattern 3). La verifica del certificato resta
    // nella configurazione predefinita di fetchWithRetry — se l'host non
    // completa la catena TLS lato server, questa chiamata fallisce e cade
    // nel ramo catch sotto, con il messaggio della sorgente propagato cosi'
    // com'e' (mai un errore silenziato o riscritto).
    const response = await fetchWithRetry(PUGLIA_DUMP_URL)
    const body: PugliaDumpResponse = await response.json()

    const events = transformPugliaRecords(body.data ?? [], params)

    const duration = Date.now() - startTime
    return { events, source: 'puglia', duration }
  } catch (error) {
    const duration = Date.now() - startTime
    return {
      events: [],
      source: 'puglia',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

function parseCoordinate(raw: string | null | undefined): number | null {
  // '' e' falsy in JS quindi rientra gia' in !raw: Number('') === 0
  // varrebbe una coordinata plausibile invece di "assente", motivo per cui
  // questo controllo precede la conversione invece di affidarsi solo a
  // Number.isFinite dopo.
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export function transformPugliaRecords(
  records: PugliaRecord[],
  params: ScrapeParams = {}
): ScrapedEvent[] {
  // Set default date range (today to 6 months from now) — stesso default di
  // opendata.ts/solosagre.ts/emiliaromagna.ts. Il dump non filtra per data
  // (copre dal 2012 al 2027): il filtro va applicato qui, lato client, come
  // gia' fa transformEvents in solosagre.ts.
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
    // Solo eventi: il dataset mischia eventi e attivita' commerciali/turistiche
    // permanenti (agriturismi, botteghe) sotto lo stesso schema.
    if (record.tipo_scheda !== 'evento') continue
    if (!record.data_inizio) continue

    const eventStartDate = new Date(record.data_inizio)
    eventStartDate.setHours(0, 0, 0, 0)
    if (Number.isNaN(eventStartDate.getTime())) continue

    const eventEndDate = record.data_fine ? new Date(record.data_fine) : new Date(eventStartDate)
    eventEndDate.setHours(23, 59, 59, 999)

    const isActiveInPeriod = eventStartDate <= dateTo && eventEndDate >= dateFrom
    if (!isActiveInPeriod) continue

    // Nessun campo id univoco nel dataset osservato: sourceId derivato
    // deterministicamente da codice ISTAT + titolo + data di inizio (stesso
    // principio del fallback deterministico di deriveSoloSagreSourceId).
    const sourceId = `${record.codice_istat_comune ?? 'nd'}:${record.nm_evento_it ?? ''}:${record.data_inizio}`

    results.push({
      source: 'puglia',
      sourceId,
      title: record.nm_evento_it || 'Evento',
      description: record.dsc_evento_it?.trim() || '',
      dateStart: eventStartDate,
      dateEnd: eventEndDate,
      locationName: record.comune || null,
      address: record.indirizzo || null,
      latitude: parseCoordinate(record.latitudine),
      longitude: parseCoordinate(record.longitudine),
      // tipologia arriva cosi' com'e', senza inferenza — categoria (il campo
      // grosso "EVENTO") resta volutamente fuori (COVERAGE.md, granularita'
      // inutile: tipologia e' il campo che discrimina davvero).
      category: record.tipologia || null,
      sourceUrl: PUGLIA_DUMP_URL,
      imageUrl: null,
      phone: null,
      // Aggancio esatto al comune (D-03/T-15-09): il livello di persistenza
      // risolve istatCode -> comuneId con un lookup per uguaglianza, mai col
      // matching fuzzy di lib/territorial/resolve.ts.
      istatCode: record.codice_istat_comune || null
    })
  }

  return results
}

// Self-check: `npx tsx lib/scrapers/puglia.ts`.
// Non un framework di test, solo un demo() con assert che fallisce
// rumorosamente (stesso idioma di lib/dedup/normalizeTitle.ts,
// lib/territorial/resolve.ts, lib/scrapers/emiliaromagna.ts) — con
// riepilogo in formato TAP (# tests/# pass/# fail + ok/not ok) per
// l'evidenza RED/GREEN del ciclo TDD di questo task.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failed = false
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`)
      failed = true
    }
  }

  const fixturePath = join(__dirname, '__fixtures__', 'puglia-sample.json')
  const fixture: PugliaRecord[] = JSON.parse(readFileSync(fixturePath, 'utf-8'))

  const massafra = fixture.find(r => r.nm_evento_it?.startsWith('Massafra nel medioevo'))
  if (!massafra) throw new Error('fixture priva del record reale Sagra di Massafra')
  const attivita = fixture.find(r => r.tipo_scheda === 'attivita')
  if (!attivita) throw new Error('fixture priva del record con tipo_scheda attivita')
  const activeEvento = fixture.find(r => r.nm_evento_it === 'Festival delle Sagre di Puglia')
  if (!activeEvento) throw new Error('fixture priva del record evento attivo')
  const badCoords = fixture.find(r => r.nm_evento_it === 'Evento senza coordinate valide')
  if (!badCoords) throw new Error('fixture priva del record con coordinate non numeriche')

  const wideWindow = { dateFrom: '2010-01-01', dateTo: '2030-01-01' }

  // Tutti e quattro insieme, finestra larga: solo i due tipo_scheda='evento'
  // devono comparire (Massafra + Festival), mai l'attivita'.
  const allTransformed = transformPugliaRecords(fixture, wideWindow)
  assert(
    allTransformed.every(ev => ev.title !== attivita.nm_evento_it),
    "un record con tipo_scheda 'attivita' non deve mai comparire fra gli eventi prodotti"
  )
  assert(
    allTransformed.some(ev => ev.title === massafra.nm_evento_it),
    'il record Sagra di Massafra (tipo_scheda evento) deve comparire con finestra larga'
  )

  // codice_istat_comune riportato intatto sullo ScrapedEvent (aggancio esatto).
  const massafraTransformed = allTransformed.find(ev => ev.title === massafra.nm_evento_it)
  assert(
    !!massafraTransformed && massafraTransformed.istatCode === '073015',
    `atteso istatCode '073015' sull'evento Massafra, ottenuto '${massafraTransformed?.istatCode}'`
  )
  assert(
    massafraTransformed?.category === 'Sagra',
    `atteso category 'Sagra' (da tipologia, senza inferenza), ottenuto '${massafraTransformed?.category}'`
  )

  // Evento gia' concluso (Massafra, 2017): escluso da una finestra dell'anno corrente.
  const currentWindow = { dateFrom: '2025-01-01', dateTo: '2030-01-01' }
  const transformedCurrent = transformPugliaRecords([massafra], currentWindow)
  assert(
    transformedCurrent.length === 0,
    `un evento gia concluso nel periodo richiesto deve essere escluso, ottenuti ${transformedCurrent.length}`
  )

  // Evento futuro attivo: entra con finestra corrente.
  const transformedActive = transformPugliaRecords([activeEvento], currentWindow)
  assert(
    transformedActive.length === 1,
    `un evento evento futuro attivo nella finestra deve comparire, ottenuti ${transformedActive.length}`
  )

  // Coordinate non numeriche -> null, mai NaN.
  const transformedBadCoords = transformPugliaRecords([badCoords], wideWindow)
  assert(transformedBadCoords.length === 1, 'atteso 1 evento dal record con coordinate non numeriche')
  if (transformedBadCoords.length === 1) {
    const ev = transformedBadCoords[0]
    assert(ev.latitude === null, `atteso latitude null, ottenuto ${ev.latitude}`)
    assert(ev.longitude === null, `atteso longitude null, ottenuto ${ev.longitude}`)
  }

  const targetTest = 'transformPugliaRecords implements the ROLL-02 adapter behavior (15-02 Task 2)'
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
    console.log('[puglia.ts] self-check OK')
  }
}
