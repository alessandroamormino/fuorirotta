// check:ios-event-days (test:ci): la regola dei giorni di lib/eventDays.ts e la sua copia Swift
// (Dates.swift) leggono la stessa fixture. La fixture si genera da qui; se il file committato
// differisce, la regola TS e' cambiata e la copia Swift va riallineata.
//   npx tsx scripts/ios-event-days.ts           confronta
//   npx tsx scripts/ios-event-days.ts --write   rigenera
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { eventDays } from '../lib/eventDays'

const FIXTURE = join(__dirname, '../ios/Packages/FuorirottaCore/Tests/FuorirottaCoreTests/Fixtures/event-days.json')

type Rule = (start: string, end: string | null) => { startDay: string; endDay: string }

const pairs: Array<[string, string | null]> = [
  ['2026-10-15T00:00:00.000Z', '2026-10-15T23:59:59.999Z'],
  ['2026-10-18T00:00:00.000Z', '2026-10-19T23:59:59.999Z'],
  ['2026-10-04T00:00:00.000Z', '2026-10-04T00:00:00.000Z'],
  ['2026-10-04T00:00:00.000Z', null],
  ['2026-01-09T23:00:00.000Z', '2026-01-10T22:59:59.999Z'],
  ['2026-09-01T22:00:00.000Z', '2026-09-02T21:59:59.999Z'],
  ['2026-10-15T00:00:00.000Z', '2026-10-14T23:59:59.999Z'],
  ['2026-03-29T00:00:00.000Z', '2026-03-29T23:59:59.999Z'],
  ['2026-03-28T23:00:00.000Z', '2026-03-29T21:59:59.999Z'],
  ['2026-10-25T00:00:00.000Z', '2026-10-25T23:59:59.999Z'],
  ['2026-10-24T22:00:00.000Z', '2026-10-25T22:59:59.999Z'],
  ['2026-12-31T23:00:00.000Z', '2027-01-01T22:59:59.999Z'],
  ['2026-12-31T00:00:00.000Z', '2027-01-02T23:59:59.999Z'],
  ['2019-12-09T00:00:00.000Z', '2029-12-31T23:59:59.999Z'],
  ['2026-11-08T00:00:00Z', '2026-11-08T23:59:59Z'],
  ['2026-11-08T00:00:00Z', null],
]
// Passo orario su entrambi i weekend di cambio ora, fine nulla.
for (const [from, to] of [['2026-03-28T00:00:00.000Z', '2026-03-30T23:00:00.000Z'], ['2026-10-24T00:00:00.000Z', '2026-10-26T23:00:00.000Z']]) {
  for (let t = Date.parse(from); t <= Date.parse(to); t += 3_600_000) pairs.push([new Date(t).toISOString(), null])
}
// Passo orario anche sulle fini (23:59 UTC e il suo vicino), per i due formati.
for (let t = Date.parse('2026-10-24T00:00:00.000Z'); t <= Date.parse('2026-10-26T23:00:00.000Z'); t += 3_600_000) {
  pairs.push(['2026-10-24T00:00:00.000Z', new Date(t + 59 * 60_000 + 59_999).toISOString()])
}

function serialise(rule: Rule): string {
  const cases = pairs.map(([dateStart, dateEnd]) => ({ dateStart, dateEnd, ...rule(dateStart, dateEnd) }))
  return JSON.stringify({ generatedFrom: 'lib/eventDays.ts', cases }, null, 2) + '\n'
}

const real: Rule = (s, e) => eventDays(s, e)
// Regola sbagliata apposta: l'inizio letto in UTC.
const wrong: Rule = (s, e) => ({ ...eventDays(s, e), startDay: s.slice(0, 10) })

const expected = serialise(real)
if (process.argv.includes('--write')) {
  writeFileSync(FIXTURE, expected)
  console.log(`scritta ${FIXTURE} (${pairs.length} casi)`)
  process.exit(0)
}

let committed = ''
try { committed = readFileSync(FIXTURE, 'utf8') } catch { /* mancante: FAIL sotto */ }
if (committed !== expected) {
  console.error('FAIL: E1 la fixture event-days.json non corrisponde a lib/eventDays.ts; rigenera con: npx tsx scripts/ios-event-days.ts --write e rilancia swift test')
  process.exit(1)
}
console.log(`ok  E1: fixture allineata (${pairs.length} casi)`)

if (serialise(wrong) === expected) {
  console.error('FAIL: E2 una regola diversa non viene rilevata')
  process.exit(1)
}
console.log('ok  E2: una regola diversa viene rilevata')
