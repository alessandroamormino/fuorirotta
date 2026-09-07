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

/**
 * Normalizza a mezzanotte locale. Punto unico in cui l'algoritmo del
 * prototipo si distingue da un banale confronto di timestamp: due istanti
 * nello stesso giorno di calendario ma a ore diverse devono confrontarsi
 * uguali. E' anche l'origine del mismatch di idratazione che la card
 * tampona con suppressHydrationWarning sui nodi che portano il testo del
 * badge (il valore reso lato server e quello lato client possono divergere
 * se la pagina resta aperta a cavallo di mezzanotte) — tampone documentato,
 * non un difetto da chiudere in questa fase.
 */
function toMidnight(value: string | Date): Date {
  const d = new Date(value)
  d.setHours(0, 0, 0, 0)
  return d
}

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
  const start = new Date(dateStart)
  const end = dateEnd != null ? new Date(dateEnd) : start
  const startLabel = format(start, 'd MMM', { locale: it })
  if (toMidnight(start).getTime() === toMidnight(end).getTime()) {
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

  console.log('[eventStatus.ts] self-check OK')
}
