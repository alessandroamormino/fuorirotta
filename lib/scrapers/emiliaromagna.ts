/**
 * Emilia-Romagna OpenData scraper (ROLL-01, Fase 15)
 *
 * Scarica JSON da emiliaromagnaturismo.it/opendata/v1/events — API pubblica
 * senza chiave (schema OpenAPI letto in 15-RESEARCH.md: parametri dichiarati
 * lang, istat, city, prov, page, limit, updated — nessun filtro data lato
 * server, applicato qui lato client come fa gia' transformEvents in
 * solosagre.ts).
 *
 * STATO RED (15-02 Task 1, TDD): questa versione e' uno stub intenzionale che
 * restituisce sempre un risultato vuoto. Il self-check in fondo al file gira
 * sulla fixture salvata e fallisce di proposito finche' l'implementazione
 * vera non sostituisce questi stub (commit GREEN successivo).
 */

import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'

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

export async function scrapeEmiliaRomagna(_params: ScrapeParams = {}): Promise<AdapterResult> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void fetchWithRetry // stub RED: la vera implementazione fa il fetch qui (commit GREEN)
  return { events: [], source: 'emilia-romagna', duration: 0 }
}

export function transformEmiliaRomagnaRecords(
  _records: EmiliaRomagnaRecord[],
  _params: ScrapeParams = {}
): ScrapedEvent[] {
  // Stub RED (15-02 Task 1): sempre vuoto finche' il commit GREEN non
  // implementa la trasformazione reale.
  return []
}

// Self-check: `npx tsx lib/scrapers/emiliaromagna.ts`.
// Non un framework di test, solo un demo() con assert che fallisce
// rumorosamente (stesso idioma di lib/dedup/normalizeTitle.ts e
// lib/territorial/resolve.ts) — con l'aggiunta di un riepilogo in formato TAP
// (# tests/# pass/# fail + ok/not ok) cosi' l'evidenza RED/GREEN del ciclo
// TDD di questo task e' verificabile a macchina senza introdurre un framework
// di test nuovo nel progetto.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')

  let failed = false
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`FAIL: ${msg}`)
      failed = true
    }
  }

  const fixturePath = path.join(__dirname, '__fixtures__', 'emiliaromagna-events.json')
  const fixture: EmiliaRomagnaRecord[] = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))

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
