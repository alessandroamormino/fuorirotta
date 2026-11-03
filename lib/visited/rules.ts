import { eventDays } from '../eventDays'

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

  if (failures > 0) {
    console.error(`[visited/rules.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
}
