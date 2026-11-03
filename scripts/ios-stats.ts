// check:ios-stats (test:ci): le statistiche di lib/stats/compute.ts e la loro copia Swift
// (Stats.swift) leggono la stessa fixture. La fixture si genera da qui; se il file committato
// differisce, la regola TS e' cambiata e la copia Swift va riallineata (swift test StatsParityTests).
//   npx tsx scripts/ios-stats.ts           confronta
//   npx tsx scripts/ios-stats.ts --write   rigenera
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { HEATMAP_MAX_SPREAD_DAYS, computeStats, type StatItem, type Stats } from '../lib/stats/compute'

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

type Case = { name: string; year: number; saved: StatItem[] }

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
  }
]

type Expect = { saved: Stats }

// perCategory come coppie [nome, conteggio] e days con le chiavi ordinate: l'ordine e' parte del contratto.
const stable = (s: Stats): Stats => ({
  ...s,
  days: Object.fromEntries(Object.entries(s.days).sort(([a], [b]) => (a < b ? -1 : 1)))
})

type Rule = { saved: (items: StatItem[], year: number) => Stats }

function serialise(rule: Rule): string {
  const out = cases.map((c) => {
    const expect: Expect = { saved: stable(rule.saved(c.saved, c.year)) }
    return { name: c.name, year: c.year, saved: c.saved, expect }
  })
  return JSON.stringify({ generatedFrom: 'lib/stats/compute.ts', cases: out }, null, 2) + '\n'
}

const real: Rule = { saved: (i, y) => computeStats(i, y) }
// Regola sbagliata apposta: il tetto dei giorni a 15 invece di 14.
const wrong: Rule = { saved: (i, y) => computeStats(i, y, HEATMAP_MAX_SPREAD_DAYS + 1) }

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
console.log('ok  E2: una regola diversa viene rilevata')
