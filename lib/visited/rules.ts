import { eventDays } from '../eventDays'
import { GUEST_CAP, isDate, validateSnap, type Snap } from '../saved/snapshot'

/**
 * Regola di "Ci sono stato" (Fase 27.1, D-02 e D-05) in un posto solo.
 *
 * Ritorna il giorno di visita "YYYY-MM-DD" (Roma) da salvare, oppure null se
 * l'evento non e' ancora iniziato (D-02: dal primo giorno in poi, per sempre).
 *  - evento in corso oggi (primo giorno <= oggi <= ultimo giorno): oggi;
 *  - evento gia' finito: il suo primo giorno.
 * Il giorno si sceglie una volta sola, al primo segno (D-05).
 *
 * Modulo puro, importato anche da componenti "use client": solo ../eventDays,
 * nessuna API solo-Node.
 */
export function visitDayFor(dateStart: string | Date, dateEnd: string | Date | null, today: string): string | null {
  const { startDay, endDay } = eventDays(dateStart, dateEnd)
  if (startDay > today) return null
  return today <= endDay ? today : startDay
}

/** Una voce dei visitati sul dispositivo (ospite, D-07): il segno resta nel browser finche' non si accede. */
export interface VisitedDeviceEntry {
  id: number
  /** L'istante del segno (il nome e' quello della voce dei salvati, riusato apposta: lo legge il merge). */
  savedAt: string
  visitDay: string
  /** Testo dell'evento per il caso che sparisca prima dell'unione; il server lo rivalida. */
  snap?: Snap
}

const MAX_ID = 999_999_999
const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Legge la lista dei visitati del dispositivo: dati altrui o scritti a mano (T-27.1-23).
 * Scarta voce per voce quella con id, data del segno o giorno malformati, i doppi (vince
 * il primo) e oltre GUEST_CAP; un'istantanea non valida si toglie ma la voce resta.
 * Mai un'eccezione. Modulo puro, importato anche da componenti "use client".
 */
export function parseVisitedDevice(raw: string | null): VisitedDeviceEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<number>()
  const out: VisitedDeviceEntry[] = []
  for (const e of parsed as unknown[]) {
    if (typeof e !== 'object' || e === null) continue
    const { id, savedAt, visitDay, snap } = e as Record<string, unknown>
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > MAX_ID || seen.has(id)) continue
    if (!isDate(savedAt) || typeof visitDay !== 'string' || !DAY.test(visitDay)) continue
    const valid = snap === undefined || snap === null ? null : validateSnap(snap)
    seen.add(id)
    out.push(valid ? { id, savedAt, visitDay, snap: valid } : { id, savedAt, visitDay })
    if (out.length === GUEST_CAP) break
  }
  return out
}

// Self-check: `npx tsx lib/visited/rules.ts`. Stessa guardia su `typeof` di
// lib/eventDays.ts: nel bundle browser `module` non esiste.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const check = (label: string, got: string | null, want: string | null) => {
    if (got !== want) {
      console.error(`  FAIL: ${label}: atteso ${want}, ottenuto ${got}`)
      failures++
    } else console.log(`ok  ${label}`)
  }
  const today = '2026-11-03'

  check('inizia domani -> null', visitDayFor('2026-11-04T00:00:00.000Z', '2026-11-04T23:59:59.999Z', today), null)
  check('un giorno, oggi -> oggi', visitDayFor('2026-11-03T00:00:00.000Z', '2026-11-03T23:59:59.999Z', today), today)
  check('iniziato ieri, finisce domani -> oggi', visitDayFor('2026-11-02T00:00:00.000Z', '2026-11-04T23:59:59.999Z', today), today)
  check('tre giorni finiti la settimana scorsa -> primo giorno', visitDayFor('2026-10-24T00:00:00.000Z', '2026-10-26T23:59:59.999Z', today), '2026-10-24')
  // Formato Roma (DB locale): inizio 23:00Z del giorno prima, fine 22:59:59.999Z.
  check('formato Roma, domani -> null', visitDayFor('2026-11-03T23:00:00.000Z', '2026-11-04T22:59:59.999Z', today), null)
  check('formato Roma, finito -> primo giorno', visitDayFor('2026-10-23T23:00:00.000Z', '2026-10-24T22:59:59.999Z', today), '2026-10-24')
  check('fine nulla, passato -> primo giorno', visitDayFor('2026-10-01T00:00:00.000Z', null, today), '2026-10-01')

  // parseVisitedDevice
  const same = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got), JSON.stringify(want))
  same('parse: null -> []', parseVisitedDevice(null), [])
  same('parse: non JSON -> []', parseVisitedDevice('not json'), [])
  same('parse: non array -> []', parseVisitedDevice('{"a":1}'), [])
  const snap = {
    title: 'Sagra',
    dateStart: '2026-10-18T00:00:00.000Z',
    dateEnd: null,
    place: null,
    category: 'Sagre e feste',
    source: 'x',
    sourceId: '1',
    sourceUrl: null,
  }
  const good = { id: 5, savedAt: '2026-11-03T10:00:00.000Z', visitDay: '2026-10-18', snap }
  same('parse: voce valida con snap invariata', parseVisitedDevice(JSON.stringify([good])), [good])
  const noSnap = { id: 6, savedAt: '2026-11-03T10:00:00.000Z', visitDay: '2026-10-18' }
  same('parse: snap opzionale', parseVisitedDevice(JSON.stringify([noSnap])), [noSnap])
  same('parse: snap non valida tolta, voce tenuta', parseVisitedDevice(JSON.stringify([{ ...noSnap, snap: { title: 'x' } }])), [noSnap])
  same(
    'parse: id non intero / fuori range, data e giorno malformati scartati',
    parseVisitedDevice(
      JSON.stringify([
        { ...noSnap, id: 1.5 },
        { ...noSnap, id: 0 },
        { ...noSnap, id: 1_000_000_000 },
        { ...noSnap, id: '7' },
        { ...noSnap, savedAt: 'ieri' },
        { ...noSnap, visitDay: '18/10/2026' },
        { ...noSnap, visitDay: undefined },
        null,
        noSnap,
      ])
    ),
    [noSnap]
  )
  same('parse: doppi, vince il primo', parseVisitedDevice(JSON.stringify([noSnap, { ...noSnap, visitDay: '2026-10-19' }])), [noSnap])
  const many = Array.from({ length: 150 }, (_, i) => ({ ...noSnap, id: i + 1 }))
  check('parse: oltre 100 si tengono le prime 100', String(parseVisitedDevice(JSON.stringify(many)).length), '100')

  if (failures > 0) {
    console.error(`[visited/rules.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
}
