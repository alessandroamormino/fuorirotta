// check:ios-stats (test:ci): le statistiche di lib/stats/compute.ts e la loro copia Swift
// (Stats.swift) leggono la stessa fixture. La fixture si genera da qui; se il file committato
// differisce, la regola TS e' cambiata e la copia Swift va riallineata (swift test StatsParityTests).
//   npx tsx scripts/ios-stats.ts           confronta
//   npx tsx scripts/ios-stats.ts --write   rigenera
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  HEATMAP_MAX_SPREAD_DAYS,
  computeStats,
  computeVisitedStats,
  statsTiles,
  type StatItem,
  type Stats,
  type VisitedStatItem
} from '../lib/stats/compute'
import { eventDays } from '../lib/eventDays'
import { visitDayFor } from '../lib/visited/rules'

const FIXTURE = join(__dirname, '../ios/Packages/FuorirottaCore/Tests/FuorirottaCoreTests/Fixtures/stats.json')

// Due formati di data: fine-giornata UTC (produzione) e mezzanotte di Roma (DB locale).
const utc = (start: string, end: string | null, category: string | null): StatItem => ({
  dateStart: `${start}T00:00:00.000Z`,
  dateEnd: end ? `${end}T23:59:59.999Z` : null,
  category
})
const rome = (startUtc: string, endUtc: string, category: string | null): StatItem => ({
  dateStart: startUtc,
  dateEnd: endUtc,
  category
})

type Case = { name: string; year: number; saved: StatItem[]; visited?: VisitedStatItem[] }
const v = (visitDay: string, category: string | null): VisitedStatItem => ({ visitDay, category })

const cases: Case[] = [
  { name: 'vuoto', year: 2026, saved: [] },
  { name: 'un giorno, formato UTC', year: 2026, saved: [utc('2026-10-15', '2026-10-15', 'Sagre e feste')] },
  { name: 'un giorno, formato Roma', year: 2026, saved: [rome('2026-10-14T22:00:00.000Z', '2026-10-15T21:59:59.999Z', 'Sagre e feste')] },
  { name: 'fine nulla', year: 2026, saved: [utc('2026-10-04', null, 'Arte e cultura')] },
  { name: '14 giorni: tutti accesi', year: 2026, saved: [utc('2026-06-01', '2026-06-14', 'Fiere e mercati')] },
  { name: '15 giorni: solo il primo', year: 2026, saved: [utc('2026-06-01', '2026-06-15', 'Fiere e mercati')] },
  { name: 'a cavallo di fine mese', year: 2026, saved: [utc('2026-07-30', '2026-08-02', 'Musica e spettacolo')] },
  { name: 'a cavallo di fine anno, anno 2026', year: 2026, saved: [utc('2026-12-30', '2027-01-02', 'Sport e outdoor')] },
  { name: 'a cavallo di fine anno, anno 2027', year: 2027, saved: [utc('2026-12-30', '2027-01-02', 'Sport e outdoor')] },
  {
    name: 'categoria sconosciuta e nulla vanno in Altro',
    year: 2026,
    saved: [utc('2026-05-01', '2026-05-01', 'Inventata'), utc('2026-05-02', '2026-05-02', null), utc('2026-05-03', '2026-05-03', 'Altro')]
  },
  {
    name: 'pari conteggio: ordine della tassonomia',
    year: 2026,
    saved: [
      utc('2026-04-01', '2026-04-01', 'Food & Wine'),
      utc('2026-04-02', '2026-04-02', 'Sagre e feste'),
      utc('2026-04-03', '2026-04-03', 'Musica e spettacolo'),
      utc('2026-04-04', '2026-04-04', 'Musica e spettacolo')
    ]
  },
  {
    name: 'piu eventi nello stesso giorno e in anni diversi',
    year: 2026,
    saved: [
      utc('2026-03-01', '2026-03-02', 'Sagre e feste'),
      utc('2026-03-02', '2026-03-02', 'Arte e cultura'),
      utc('2025-03-02', '2025-03-02', 'Arte e cultura')
    ]
  },
  // D-05, D-09, D-11: visitati con il loro giorno di visita.
  {
    name: 'visitati: due nello stesso giorno, categoria nulla, anno prima',
    year: 2026,
    saved: [utc('2026-03-01', '2026-03-01', 'Sagre e feste'), utc('2025-12-30', '2026-01-01', 'Arte e cultura'), utc('2025-05-05', '2025-05-05', 'Altro')],
    visited: [v('2026-03-01', 'Musica e spettacolo'), v('2026-03-01', 'Altro'), v('2026-07-14', null), v('2025-12-31', 'Sagre e feste')]
  },
  {
    name: 'visitati: pari conteggio e categoria sconosciuta',
    year: 2026,
    saved: [],
    visited: [v('2026-01-31', 'Food & Wine'), v('2026-02-01', 'Sagre e feste'), v('2026-02-02', 'Inventata'), v('2026-02-02', 'Sport e outdoor')]
  },
  {
    name: 'visitati senza salvati, anno senza visite',
    year: 2024,
    saved: [],
    visited: [v('2026-06-06', 'Arte e cultura')]
  }
]

// Regola del giorno di visita (D-02, D-05): stessi casi per TS e Swift. Oggi e' sempre 2026-11-03.
const TODAY = '2026-11-03'
const visitDayCases: Array<{ dateStart: string; dateEnd: string | null }> = [
  { dateStart: '2026-11-04T00:00:00.000Z', dateEnd: '2026-11-04T23:59:59.999Z' }, // inizia domani
  { dateStart: '2026-11-05T00:00:00.000Z', dateEnd: null }, // fra due giorni, fine nulla
  { dateStart: '2026-11-03T00:00:00.000Z', dateEnd: '2026-11-03T23:59:59.999Z' }, // un giorno, oggi
  { dateStart: '2026-11-03T00:00:00.000Z', dateEnd: null }, // fine nulla, oggi
  { dateStart: '2026-11-02T00:00:00.000Z', dateEnd: '2026-11-04T23:59:59.999Z' }, // in corso
  { dateStart: '2026-11-03T00:00:00.000Z', dateEnd: '2026-11-06T23:59:59.999Z' }, // primo giorno, in corso
  { dateStart: '2026-10-30T00:00:00.000Z', dateEnd: '2026-11-03T23:59:59.999Z' }, // ultimo giorno oggi
  { dateStart: '2026-10-24T00:00:00.000Z', dateEnd: '2026-10-26T23:59:59.999Z' }, // finito -> primo giorno
  { dateStart: '2026-10-01T00:00:00.000Z', dateEnd: null }, // finito, fine nulla
  { dateStart: '2026-11-03T23:00:00.000Z', dateEnd: '2026-11-04T22:59:59.999Z' }, // formato Roma, domani
  { dateStart: '2026-11-02T23:00:00.000Z', dateEnd: '2026-11-03T22:59:59.999Z' }, // formato Roma, oggi
  { dateStart: '2026-10-23T23:00:00.000Z', dateEnd: '2026-10-24T22:59:59.999Z' }, // formato Roma, finito
  { dateStart: '2023-08-10T00:00:00.000Z', dateEnd: '2023-08-12T23:59:59.999Z' }, // 3 anni fa: nessun limite (D-02)
  { dateStart: '2019-12-09T00:00:00.000Z', dateEnd: '2029-12-31T23:59:59.999Z' } // lunghissimo, in corso
]
type VisitDayRule = (dateStart: string, dateEnd: string | null, today: string) => string | null

type Tiles = ReturnType<typeof statsTiles>
type Expect = { saved: Stats; visited: Stats; tilesAlways: Tiles; tilesYear: Tiles }

// perCategory come coppie [nome, conteggio] e days con le chiavi ordinate: l'ordine e' parte del contratto.
const stable = (s: Stats): Stats => ({
  ...s,
  days: Object.fromEntries(Object.entries(s.days).sort(([a], [b]) => (a < b ? -1 : 1)))
})

type Rule = {
  visitDay: VisitDayRule
  saved: (items: StatItem[], year: number) => Stats
  visited: (items: VisitedStatItem[], year: number) => Stats
  tiles: (visited: VisitedStatItem[], saved: StatItem[], year: number | null) => Tiles
}

function serialise(rule: Rule): string {
  const out = cases.map((c) => {
    const visited = c.visited ?? []
    const expect: Expect = {
      saved: stable(rule.saved(c.saved, c.year)),
      visited: stable(rule.visited(visited, c.year)),
      tilesAlways: rule.tiles(visited, c.saved, null),
      tilesYear: rule.tiles(visited, c.saved, c.year)
    }
    return { name: c.name, year: c.year, saved: c.saved, visited, expect }
  })
  const visitDay = visitDayCases.map((c) => ({ ...c, today: TODAY, expect: rule.visitDay(c.dateStart, c.dateEnd, TODAY) }))
  return JSON.stringify({ generatedFrom: 'lib/stats/compute.ts e lib/visited/rules.ts', cases: out, visitDay }, null, 2) + '\n'
}

const real: Rule = { visitDay: visitDayFor, saved: (i, y) => computeStats(i, y), visited: computeVisitedStats, tiles: statsTiles }
// Regola sbagliata apposta: il tetto dei giorni a 15 invece di 14.
const wrong: Rule = { ...real, saved: (i, y) => computeStats(i, y, HEATMAP_MAX_SPREAD_DAYS + 1) }
// Seconda regola sbagliata: Giorni fuori conta i visitati invece dei giorni distinti.
// Terza regola sbagliata: un evento in corso segna il suo primo giorno invece di oggi.
const wrongVisitDay: Rule = {
  ...real,
  visitDay: (s, e, t) => (visitDayFor(s, e, t) === null ? null : eventDays(s, e).startDay)
}
const wrongTiles: Rule = { ...real, tiles: (vis, sav, y) => ({ ...statsTiles(vis, sav, y), daysOut: vis.length }) }

const expected = serialise(real)
if (process.argv.includes('--write')) {
  writeFileSync(FIXTURE, expected)
  console.log(`scritta ${FIXTURE} (${cases.length} casi)`)
  process.exit(0)
}

let committed = ''
try {
  committed = readFileSync(FIXTURE, 'utf8')
} catch {
  /* mancante: FAIL sotto */
}
if (committed !== expected) {
  console.error('FAIL: E1 la fixture stats.json non corrisponde a lib/stats/compute.ts; rigenera con: npx tsx scripts/ios-stats.ts --write e rilancia swift test')
  process.exit(1)
}
console.log(`ok  E1: fixture allineata (${cases.length} casi)`)

if (serialise(wrong) === expected) {
  console.error('FAIL: E2 una regola diversa non viene rilevata')
  process.exit(1)
}
if (serialise(wrongTiles) === expected) {
  console.error('FAIL: E2 una tessera calcolata male non viene rilevata')
  process.exit(1)
}
if (serialise(wrongVisitDay) === expected) {
  console.error('FAIL: E2 un giorno di visita sbagliato non viene rilevato')
  process.exit(1)
}
console.log('ok  E2: una regola diversa viene rilevata')
