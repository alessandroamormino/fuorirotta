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
  const start = toMidnight(dateStart)
  const end = dateEnd != null ? toMidnight(dateEnd) : start
  const startLabel = format(start, 'd MMM', { locale: it })
  if (start.getTime() === end.getTime()) {
    return startLabel
  }
  return `${startLabel} – ${format(end, 'd MMM', { locale: it })}`
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

// Self-check: `npx tsx lib/eventStatus.ts`. Nessun accesso al DOM/DB: il
// modulo e' puro e il suo self-check deve restare eseguibile senza
// container, stesso stile di lib/territorial/distance.ts.
//
// La guardia su `typeof` non e' cerimonia: questo modulo e' importato da
// componenti "use client" (EventCard, StatusBadge, MiniEventCard), e nel
// bundle browser `module` non esiste — `require.main === module` da solo
// esplode con "module is not defined" al momento della valutazione del
// modulo, prima ancora che la pagina renda.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const at = (n: number, from = today) => {
    const d = new Date(from)
    d.setDate(d.getDate() + n)
    return d
  }

  console.assert(eventStatus(at(0)).label === 'Oggi', 'atteso Oggi per dateStart di oggi')
  console.assert(
    eventStatus(at(-2), at(3)).label === 'In corso' && eventStatus(at(-2), at(3)).tone === 'live',
    'atteso In corso per un evento iniziato e non ancora finito'
  )
  console.assert(eventStatus(at(1)).label === 'Domani', 'atteso Domani per dateStart di domani')
  console.assert(eventStatus(at(4)).label === 'Fra 4 giorni', 'atteso Fra 4 giorni')
  console.assert(eventStatus(at(7)).label === 'Fra 7 giorni', 'atteso Fra 7 giorni al limite superiore')
  console.assert(
    eventStatus(at(8)).tone === 'later' && eventStatus(at(8)).label !== 'Fra 8 giorni',
    'atteso ramo range (non "Fra 8 giorni") a 8 giorni esatti'
  )
  console.assert(eventStatus(at(-9), at(-3)).label === 'Concluso', 'atteso Concluso per evento gia\' finito')
  console.assert(
    eventStatus(at(0), at(30)).label === 'Oggi',
    'un evento che parte oggi e finisce fra un mese deve restare Oggi, non In corso'
  )
  console.assert(eventStatus(at(-5), null).label === 'Concluso', 'dateEnd nullo usa dateStart come fine')

  // React #418 (2026-10-16): mezzanotte di Roma del 2/9 scritta come cifre UTC
  // del 1/9 sera (evento 22720). Deve dire "2 set" in QUALUNQUE fuso: lancia
  // il self-check anche con TZ=UTC, il fuso del container in produzione.
  console.assert(
    formatEventRange('2026-09-01T22:00:00.000Z', '2026-09-02T21:59:59.999Z') === '2 set',
    `atteso "2 set" anche fuori da Roma, ottenuto "${formatEventRange('2026-09-01T22:00:00.000Z', '2026-09-02T21:59:59.999Z')}"`
  )

  console.log('[eventStatus.ts] self-check OK')
}
