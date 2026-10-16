/**
 * Primo e ultimo giorno di calendario di un evento, indipendenti dal formato
 * con cui la sorgente ha salvato le date. Unica regola del progetto: card,
 * mini-card, badge di stato, riga "Quando", dati strutturati per Google e (nei
 * piani successivi) .ics, link del calendario e testo di condivisione passano
 * tutti da qui. Nessuna seconda copia della logica del "giorno di fine".
 *
 * Modulo puro: nessun DOM, nessun React, nessuna API solo-Node. Importato da
 * componenti "use client", quindi sicuro nel bundle browser.
 *
 * PERCHE' ESISTE (misurato su produzione, 2026-10-16): le sorgenti salvano le
 * date in DUE formati diversi.
 *  - Formato UTC (produzione): inizio 00:00:00.000Z, fine 23:59:59.999Z per
 *    in-lombardia, solosagre, opendata, puglia, emilia-romagna; fine
 *    00:00:00.000Z per altoadige, firenze, roma, torino; fine nulla per 4
 *    righe di torino.
 *  - Formato Roma (DB locale e una riga storica): inizio 22:00Z/23:00Z del
 *    giorno prima, fine 21:59:59.999Z/22:59:59.999Z.
 * Leggere come giorno di Roma una fine 23:59:59.999Z da' il giorno SUCCESSIVO:
 * l'evento 1100954 (concerto di un giorno, 15 ottobre) compariva con un
 * intervallo di due giorni e il giorno dopo il badge diceva "In corso".
 *
 * LA REGOLA: l'inizio e' il giorno di Roma dell'istante. La fine, se cade alle
 * 23:59 UTC, e' una fine-giornata in formato UTC e vale la sua data UTC; in
 * ogni altro caso vale il giorno di Roma. Non c'e' ambiguita': una fine-giornata
 * in formato Roma e' 21:59Z (CEST) o 22:59Z (CET), mai le 23:59 UTC.
 */

const romeDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })

export interface EventDays {
  /** Primo giorno, "YYYY-MM-DD" a Roma. */
  startDay: string
  /** Ultimo giorno (incluso), "YYYY-MM-DD" a Roma. */
  endDay: string
}

export function eventDays(dateStart: string | Date, dateEnd?: string | Date | null): EventDays {
  const startDay = romeDayFormat.format(new Date(dateStart))
  if (dateEnd == null) return { startDay, endDay: startDay }
  const end = new Date(dateEnd)
  const endDay =
    end.getUTCHours() === 23 && end.getUTCMinutes() === 59
      ? end.toISOString().slice(0, 10)
      : romeDayFormat.format(end)
  // Sorgenti incoerenti (fine prima dell'inizio): vale l'inizio.
  return { startDay, endDay: endDay < startDay ? startDay : endDay }
}

/**
 * Le cifre di un giorno "YYYY-MM-DD" rimesse in un Date locale del processo.
 * Stesso trucco di romeCalendarDate: date-fns formatta e confronta uguale in
 * qualunque fuso, server in UTC compreso (React error 418, 2026-10-16).
 */
export function dayToLocalDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Self-check: `npx tsx lib/eventDays.ts`, lanciato da scripts/calendar.test.sh
// sotto quattro fusi orari. Il DB locale e' in formato Roma, quindi un run
// verde in locale non dice nulla sul formato di produzione: le fixture qui
// sotto portano entrambi i formati.
//
// La guardia su `typeof` non e' cerimonia: il modulo e' importato da componenti
// "use client" e nel bundle browser `module` non esiste (stessa forma di
// lib/dateWindow.ts, richiesta da check:browser-bundle).
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  const check = (label: string, start: string, end: string | null, expStart: string, expEnd: string) => {
    const got = eventDays(start, end)
    assertCheck(
      got.startDay === expStart && got.endDay === expEnd,
      `${label}: ${start} / ${end} atteso ${expStart} / ${expEnd}, ottenuto ${got.startDay} / ${got.endDay}`
    )
  }

  check('produzione, un giorno', '2026-10-15T00:00:00.000Z', '2026-10-15T23:59:59.999Z', '2026-10-15', '2026-10-15')
  check('produzione, intervallo', '2026-10-18T00:00:00.000Z', '2026-10-19T23:59:59.999Z', '2026-10-18', '2026-10-19')
  check('produzione, fine a mezzanotte', '2026-10-04T00:00:00.000Z', '2026-10-04T00:00:00.000Z', '2026-10-04', '2026-10-04')
  check('produzione, fine nulla', '2026-10-04T00:00:00.000Z', null, '2026-10-04', '2026-10-04')
  check('storico Roma CET', '2026-01-09T23:00:00.000Z', '2026-01-10T22:59:59.999Z', '2026-01-10', '2026-01-10')
  check('locale Roma CEST', '2026-09-01T22:00:00.000Z', '2026-09-02T21:59:59.999Z', '2026-09-02', '2026-09-02')
  check('fine ora legale, formato UTC', '2026-10-25T00:00:00.000Z', '2026-10-25T23:59:59.999Z', '2026-10-25', '2026-10-25')
  check('inizio ora legale, formato UTC', '2027-03-28T00:00:00.000Z', '2027-03-28T23:59:59.999Z', '2027-03-28', '2027-03-28')

  // Fine prima dell'inizio: vale l'inizio per entrambi.
  check('fine prima dell\'inizio', '2026-10-15T00:00:00.000Z', '2026-10-14T23:59:59.999Z', '2026-10-15', '2026-10-15')

  // Un Date da' lo stesso risultato della stringa ISO.
  const fromDate = eventDays(new Date('2026-10-15T00:00:00.000Z'), new Date('2026-10-15T23:59:59.999Z'))
  assertCheck(
    fromDate.startDay === '2026-10-15' && fromDate.endDay === '2026-10-15',
    `input Date: atteso 2026-10-15 / 2026-10-15, ottenuto ${fromDate.startDay} / ${fromDate.endDay}`
  )

  // dayToLocalDate: le cifre restano quelle in qualunque fuso del processo.
  const local = dayToLocalDate('2026-10-15')
  assertCheck(
    local.getDate() === 15 && local.getMonth() === 9 && local.getFullYear() === 2026,
    `dayToLocalDate: atteso 15/10/2026, ottenuto ${local.getDate()}/${local.getMonth() + 1}/${local.getFullYear()}`
  )

  if (failures > 0) {
    console.error(`[eventDays.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[eventDays.ts] self-check OK')
}
