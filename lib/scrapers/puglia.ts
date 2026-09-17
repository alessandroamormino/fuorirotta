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

export async function scrapePuglia(_params: ScrapeParams = {}): Promise<AdapterResult> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  void fetchWithRetry // stub RED: la vera implementazione fa il fetch qui (commit GREEN)
  void PUGLIA_DUMP_URL
  return { events: [], source: 'puglia', duration: 0 }
}

export function transformPugliaRecords(
  _records: PugliaRecord[],
  _params: ScrapeParams = {}
): ScrapedEvent[] {
  // Stub RED (15-02 Task 2): sempre vuoto finche' il commit GREEN non
  // implementa la trasformazione reale.
  return []
}

// Self-check: `npx tsx lib/scrapers/puglia.ts`.
// Non un framework di test, solo un demo() con assert che fallisce
// rumorosamente (stesso idioma di lib/dedup/normalizeTitle.ts,
// lib/territorial/resolve.ts, lib/scrapers/emiliaromagna.ts) — con
// riepilogo in formato TAP (# tests/# pass/# fail + ok/not ok) per
// l'evidenza RED/GREEN del ciclo TDD di questo task.
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

  const fixturePath = path.join(__dirname, '__fixtures__', 'puglia-sample.json')
  const fixture: PugliaRecord[] = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'))

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
