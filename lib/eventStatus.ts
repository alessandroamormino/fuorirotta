/**
 * Badge di stato di un evento (criterio di successo 10, Fase 12).
 *
 * Modulo puro: nessun accesso al DOM, nessun import React, sicuro sia lato
 * server sia nel bundle client — stesso profilo di lib/categories/taxonomy.ts
 * e lib/territorial/distance.ts.
 *
 * Algoritmo di riferimento: .planning/sketches/003-mobile-redesign/assets/
 * eventi-data.js righe 205-214 (funzione status() del prototipo adottato),
 * riportato riga per riga. dateStart/dateEnd arrivano al client come
 * stringhe ISO (serializeEvent le converte da Date Prisma), quindi la
 * funzione accetta entrambe le forme.
 */
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { eventDays, dayToLocalDate } from './eventDays'
import { romeMidnightUTC } from './dateWindow'

export type EventStatusTone = 'live' | 'soon' | 'later'

export interface EventStatus {
  label: string
  tone: EventStatusTone
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

const romeDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' })

/**
 * Il giorno di calendario A ROMA dell'istante, come mezzanotte locale del
 * processo che gira. Gli scraper scrivono mezzanotte di Roma (2 settembre =
 * 2026-09-01T22:00Z, vedi lib/dateWindow.ts): `setHours(0)` sul server in UTC
 * dava "1 set", nel browser a Roma "2 set" — React #418 su ogni card in
 * produzione (2026-10-16). Le cifre di Roma, rimesse in un Date locale, si
 * formattano e si confrontano uguali in qualunque fuso.
 */
export function romeCalendarDate(value: string | Date): Date {
  const [y, m, d] = romeDayFormat.format(new Date(value)).split('-').map(Number)
  return new Date(y, m - 1, d)
}

const toMidnight = romeCalendarDate

/** Differenza in giorni di calendario fra due date gia' a mezzanotte locale. */
function dayDiff(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY)
}

/**
 * Stessa formattazione che la card gia' usa: `d MMM` per un giorno solo,
 * `d MMM – d MMM` per un intervallo. Esportata a se' perche' il ramo
 * "range" del badge e la meta della card la condividono — un solo formato,
 * non due copie da tenere allineate.
 */
export function formatEventRange(dateStart: string | Date, dateEnd?: string | Date | null): string {
  // Il giorno di fine dipende dal formato in cui la sorgente salva le date:
  // lo decide solo eventDays (lib/eventDays.ts), non c'e' un'altra copia.
  const { startDay, endDay } = eventDays(dateStart, dateEnd)
  const startLabel = format(dayToLocalDate(startDay), 'd MMM', { locale: it })
  if (startDay === endDay) {
    return startLabel
  }
  return `${startLabel} – ${format(dayToLocalDate(endDay), 'd MMM', { locale: it })}`
}

/**
 * I sei rami del contratto (12-UI-SPEC.md, sezione "Badge di stato"):
 * Oggi / In corso / Domani / Fra N giorni / Concluso / il range formattato
 * oltre i 7 giorni — quest'ultimo e' il testo `dd MMM` che oggi la card
 * espone gia', diventato il badge stesso invece di un secondo elemento.
 *
 * `now` esiste per rendere la funzione testabile senza congelare
 * l'orologio: il default e' `new Date()`.
 */
export function eventStatus(
  dateStart: string | Date,
  dateEnd?: string | Date | null,
  now: Date = new Date()
): EventStatus {
  const today = toMidnight(now)
  const start = toMidnight(dateStart)
  // dateEnd nullo -> dateStart fa anche da fine (evento di un solo giorno).
  const end = dateEnd != null ? toMidnight(dateEnd) : start
  const days = dayDiff(start, today)

  if (days === 0) return { label: 'Oggi', tone: 'live' }
  if (start < today && end >= today) return { label: 'In corso', tone: 'live' }
  if (days === 1) return { label: 'Domani', tone: 'soon' }
  if (days > 1 && days <= 7) return { label: `Fra ${days} giorni`, tone: 'soon' }
  if (end < today) return { label: 'Concluso', tone: 'later' }
  return { label: formatEventRange(dateStart, dateEnd), tone: 'later' }
}

// Self-check: `npx tsx lib/eventStatus.ts`, lanciato da scripts/calendar.test.sh
// sotto quattro fusi orari. Nessun accesso al DOM/DB: il modulo e' puro e il
// suo self-check deve restare eseguibile senza container, stesso stile di
// lib/territorial/distance.ts.
//
// Le fixture NON dipendono dal fuso del processo (con setHours locale il test
// sbagliava sotto TZ=Asia/Tokyo) e NON dipendono dall'orologio: `now` e' fisso
// e passato esplicitamente, i giorni si costruiscono da giorni di Roma. Il DB
// locale e' in formato Roma, la produzione in formato UTC: servono entrambi.
//
// La guardia su `typeof` non e' cerimonia: questo modulo e' importato da
// componenti "use client" (EventCard, StatusBadge, MiniEventCard), e nel
// bundle browser `module` non esiste — `require.main === module` da solo
// esplode con "module is not defined" al momento della valutazione del
// modulo, prima ancora che la pagina renda.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }

  // 12:00 a Roma del 16 ottobre 2026.
  const NOW = new Date('2026-10-16T10:00:00.000Z')
  const TODAY = '2026-10-16'
  const addDays = (day: string, n: number): string => {
    const [y, m, d] = day.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
  }
  const day = (n: number) => addDays(TODAY, n)
  // Formato Roma (DB locale): inizio = mezzanotte di Roma, fine = un attimo prima di quella del giorno dopo.
  const romeStart = (n: number) => romeMidnightUTC(day(n))
  const romeEnd = (n: number) => new Date(romeMidnightUTC(day(n + 1)).getTime() - 1)

  const label = (s: Date | string, e?: Date | string | null) => eventStatus(s, e, NOW).label

  assertCheck(label(romeStart(0)) === 'Oggi', 'atteso Oggi per dateStart di oggi')
  assertCheck(
    label(romeStart(-2), romeEnd(3)) === 'In corso' && eventStatus(romeStart(-2), romeEnd(3), NOW).tone === 'live',
    'atteso In corso per un evento iniziato e non ancora finito'
  )
  assertCheck(label(romeStart(1)) === 'Domani', 'atteso Domani per dateStart di domani')
  assertCheck(label(romeStart(4)) === 'Fra 4 giorni', 'atteso Fra 4 giorni')
  assertCheck(label(romeStart(7)) === 'Fra 7 giorni', 'atteso Fra 7 giorni al limite superiore')
  assertCheck(
    eventStatus(romeStart(8), null, NOW).tone === 'later' && label(romeStart(8)) !== 'Fra 8 giorni',
    'atteso ramo range (non "Fra 8 giorni") a 8 giorni esatti'
  )
  assertCheck(label(romeStart(-9), romeEnd(-3)) === "Concluso", "atteso Concluso per evento gia' finito")
  assertCheck(
    label(romeStart(0), romeEnd(30)) === 'Oggi',
    'un evento che parte oggi e finisce fra un mese deve restare Oggi, non In corso'
  )
  assertCheck(label(romeStart(-5), null) === 'Concluso', 'dateEnd nullo usa dateStart come fine')

  // React error 418 (2026-10-16): mezzanotte di Roma del 2/9 scritta come cifre UTC
  // del 1/9 sera (evento 22720). Deve dire "2 set" in QUALUNQUE fuso.
  assertCheck(
    formatEventRange('2026-09-01T22:00:00.000Z', '2026-09-02T21:59:59.999Z') === '2 set',
    `atteso "2 set" anche fuori da Roma, ottenuto "${formatEventRange('2026-09-01T22:00:00.000Z', '2026-09-02T21:59:59.999Z')}"`
  )

  // Formato UTC di produzione: l'evento 1100954 compariva come "15 ott – 16 ott".
  const range = (s: string, e: string | null) => formatEventRange(s, e)
  assertCheck(
    range('2026-10-15T00:00:00.000Z', '2026-10-15T23:59:59.999Z') === '15 ott',
    `formato UTC, un giorno: atteso "15 ott", ottenuto "${range('2026-10-15T00:00:00.000Z', '2026-10-15T23:59:59.999Z')}"`
  )
  assertCheck(
    range('2026-10-18T00:00:00.000Z', '2026-10-19T23:59:59.999Z') === '18 ott – 19 ott',
    `formato UTC, intervallo: atteso "18 ott – 19 ott", ottenuto "${range('2026-10-18T00:00:00.000Z', '2026-10-19T23:59:59.999Z')}"`
  )
  assertCheck(
    range('2026-10-31T00:00:00.000Z', '2026-11-01T23:59:59.999Z') === '31 ott – 1 nov',
    `formato UTC, cambio mese: atteso "31 ott – 1 nov", ottenuto "${range('2026-10-31T00:00:00.000Z', '2026-11-01T23:59:59.999Z')}"`
  )

  if (failures > 0) {
    console.error(`[eventStatus.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[eventStatus.ts] self-check OK')
}
