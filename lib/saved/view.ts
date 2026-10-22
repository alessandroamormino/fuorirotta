/**
 * Vista di /salvati: dagli elementi risolti a "In arrivo" e "Passati". Modulo
 * puro e sicuro nel bundle browser. TUTTI i confronti fra giorni passano da
 * eventDays / isEventOver (lib/eventDays.ts, lib/eventStatus.ts): le date si
 * salvano in due formati (UTC in produzione, Roma nel DB locale) e un
 * confronto fra timestamp grezzi sbaglia di un giorno in uno dei due.
 */
import { format } from 'date-fns'
import { it } from 'date-fns/locale'
import { dayToLocalDate, eventDays } from '../eventDays'
import { isEventOver } from '../eventStatus'
import type { Snap } from './snapshot'
import type { Sibling } from './series'

export interface SavedItemData {
  /** L'id salvato sul dispositivo. */
  ref: number
  /** Id canonico risolto dal server, null se la riga non esiste piu'. */
  eventId: number | null
  savedAt: string
  /** Istantanea tenuta sul dispositivo (puo' mancare se il salvataggio e' avvenuto offline). */
  snap: Snap | null
  /** Istantanea costruita ora dal server dalla riga viva. */
  live: Snap | null
  /** Altre date future della stessa serie, dal server (SAVE-06). */
  siblings: Sibling[]
}

export interface SavedRow {
  key: string
  ref: number
  eventId: number | null
  title: string
  place: string | null
  dateStart: string
  dateEnd: string | null
  /** La riga dell'evento non c'e' piu': solo istantanea, niente link. */
  gone: boolean
  /** Il primo o l'ultimo GIORNO dell'evento vivo e' diverso da quello salvato (SAVE-05, D-10). */
  dateChanged: boolean
  /** "anche il 14, 21 set": altre date future della serie non ancora salvate, null se non ce ne sono (D-09). */
  otherDays: string | null
}

interface Entry {
  row: SavedRow
  savedAt: string
  startDay: string
  endDay: string
}

/**
 * "anche il 14, 21 set" (D-09). `days` sono "YYYY-MM-DD" in ordine crescente. Al piu'
 * tre date, poi " e altre N"; i giorni dello stesso mese condividono il mese:
 * "anche il 28 set, 5 ott". Nessuna data, nessuna riga (null).
 */
export function otherDaysLabel(days: string[]): string | null {
  if (days.length === 0) return null
  const shown = days.slice(0, 3)
  const groups: Array<{ key: string; month: string; nums: string[] }> = []
  for (const day of shown) {
    const date = dayToLocalDate(day)
    const month = format(date, 'MMM', { locale: it })
    const last = groups[groups.length - 1]
    // Stesso mese E stesso anno (la chiave e' "YYYY-MM"), cosi' set 2026 e set 2027 non si fondono.
    if (last && last.key === day.slice(0, 7)) last.nums.push(format(date, 'd'))
    else groups.push({ key: day.slice(0, 7), month, nums: [format(date, 'd')] })
  }
  const text = groups.map((g) => `${g.nums.join(', ')} ${g.month}`).join(', ')
  return `anche il ${text}${days.length > 3 ? ` e altre ${days.length - 3}` : ''}`
}

const bySavedAt = (a: Entry, b: Entry): number =>
  a.savedAt < b.savedAt ? -1 : a.savedAt > b.savedAt ? 1 : a.row.ref - b.row.ref

export function buildSavedView(items: SavedItemData[], now: Date): { upcoming: SavedRow[]; past: SavedRow[] } {
  // Due salvataggi dello stesso evento canonico sono una riga sola, quella piu' vecchia (SAVE-04).
  const kept = new Map<string, SavedItemData>()
  for (const item of items) {
    if (!(item.live ?? item.snap)) continue
    const key = item.eventId !== null ? `e${item.eventId}` : `r${item.ref}`
    const prev = kept.get(key)
    if (!prev || item.savedAt < prev.savedAt || (item.savedAt === prev.savedAt && item.ref < prev.ref)) kept.set(key, item)
  }

  // Le date che l'utente ha gia' salvato hanno una riga propria: non si ripetono in "anche il ...".
  const savedEventIds = new Set<number>()
  for (const item of items) if (item.eventId !== null) savedEventIds.add(item.eventId)

  const upcoming: Entry[] = []
  const past: Entry[] = []
  for (const [key, item] of kept) {
    // Le date mostrate sono quelle vive se ci sono, altrimenti quelle dell'istantanea.
    const data = (item.live ?? item.snap) as Snap
    const { startDay, endDay } = eventDays(data.dateStart, data.dateEnd)
    // D-10: conta solo il giorno di calendario, letto con eventDays su entrambi i lati. Un cambio di
    // sola ora, o del formato UTC/Roma con gli stessi giorni, non e' una data cambiata.
    let dateChanged = false
    if (item.snap && item.live) {
      const was = eventDays(item.snap.dateStart, item.snap.dateEnd)
      dateChanged = was.startDay !== startDay || was.endDay !== endDay
    }
    const otherStartDays = new Set<string>()
    for (const sib of item.siblings) {
      if (savedEventIds.has(sib.id) || isEventOver(sib.dateStart, sib.dateEnd, now)) continue
      const day = eventDays(sib.dateStart, sib.dateEnd).startDay
      if (day !== startDay) otherStartDays.add(day)
    }
    const entry: Entry = {
      row: {
        key,
        ref: item.ref,
        eventId: item.eventId,
        title: data.title,
        place: data.place,
        dateStart: data.dateStart,
        dateEnd: data.dateEnd,
        gone: item.live === null,
        dateChanged,
        otherDays: otherDaysLabel([...otherStartDays].sort()),
      },
      savedAt: item.savedAt,
      startDay,
      endDay,
    }
    ;(isEventOver(data.dateStart, data.dateEnd, now) ? past : upcoming).push(entry)
  }

  // I giorni sono "YYYY-MM-DD": l'ordine lessicografico e' quello cronologico.
  upcoming.sort((a, b) => (a.startDay < b.startDay ? -1 : a.startDay > b.startDay ? 1 : bySavedAt(a, b)))
  past.sort((a, b) => (a.endDay > b.endDay ? -1 : a.endDay < b.endDay ? 1 : bySavedAt(a, b)))
  return { upcoming: upcoming.map((e) => e.row), past: past.map((e) => e.row) }
}

// Self-check: `npx tsx lib/saved/view.ts`, lanciato da scripts/saved.test.sh
// sotto quattro fusi orari. `now` e' fisso (12:00 a Roma del 16 ottobre 2026) e le
// fixture portano ENTRAMBI i formati di data. La guardia su `typeof` non e'
// cerimonia: il modulo e' raggiungibile da componenti "use client".
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  const NOW = new Date('2026-10-16T10:00:00.000Z')
  const snap = (title: string, dateStart: string, dateEnd: string | null, place: string | null = 'Bergamo (BG)'): Snap => ({
    title,
    dateStart,
    dateEnd,
    place,
    category: 'Sagra',
    source: 'x',
    sourceId: title,
    sourceUrl: null,
  })
  const item = (
    ref: number,
    eventId: number | null,
    savedAt: string,
    live: Snap | null,
    kept: Snap | null = null,
    siblings: Sibling[] = []
  ): SavedItemData => ({
    ref,
    eventId,
    savedAt,
    snap: kept,
    live,
    siblings,
  })
  const keys = (rows: SavedRow[]) => rows.map((r) => r.key).join(',')

  // Il confine del giorno, nei due formati: finisce oggi -> in arrivo, finito ieri -> passato.
  const utcToday = snap('utc-oggi', '2026-10-14T00:00:00.000Z', '2026-10-16T23:59:59.999Z')
  const utcYesterday = snap('utc-ieri', '2026-10-15T00:00:00.000Z', '2026-10-15T23:59:59.999Z')
  const romeToday = snap('roma-oggi', '2026-10-14T22:00:00.000Z', '2026-10-16T21:59:59.999Z')
  const romeYesterday = snap('roma-ieri', '2026-10-14T22:00:00.000Z', '2026-10-15T21:59:59.999Z')
  const edge = buildSavedView(
    [
      item(1, 1, '2026-10-01T00:00:00.000Z', utcToday),
      item(2, 2, '2026-10-01T00:00:00.000Z', utcYesterday),
      item(3, 3, '2026-10-01T00:00:00.000Z', romeToday),
      item(4, 4, '2026-10-01T00:00:00.000Z', romeYesterday),
    ],
    NOW
  )
  assertCheck(keys(edge.upcoming) === 'e1,e3', `in arrivo (finisce oggi, UTC e Roma): atteso e1,e3, ottenuto ${keys(edge.upcoming)}`)
  assertCheck(keys(edge.past) === 'e2,e4', `passati (finito ieri, UTC e Roma): atteso e2,e4, ottenuto ${keys(edge.past)}`)

  // Ordine: in arrivo per primo giorno crescente, a parita' per salvataggio; passati per ultimo giorno decrescente.
  const ord = buildSavedView(
    [
      item(10, 10, '2026-10-05T00:00:00.000Z', snap('b', '2026-10-20T00:00:00.000Z', '2026-10-20T23:59:59.999Z')),
      item(11, 11, '2026-10-03T00:00:00.000Z', snap('a', '2026-10-18T00:00:00.000Z', '2026-10-18T23:59:59.999Z')),
      item(12, 12, '2026-10-02T00:00:00.000Z', snap('c', '2026-10-20T00:00:00.000Z', '2026-10-21T23:59:59.999Z')),
      item(13, 13, '2026-09-01T00:00:00.000Z', snap('p1', '2026-10-01T00:00:00.000Z', '2026-10-01T23:59:59.999Z')),
      item(14, 14, '2026-09-02T00:00:00.000Z', snap('p2', '2026-10-10T00:00:00.000Z', '2026-10-10T23:59:59.999Z')),
      item(15, 15, '2026-09-03T00:00:00.000Z', snap('p3', '2026-10-10T00:00:00.000Z', '2026-10-10T23:59:59.999Z')),
    ],
    NOW
  )
  assertCheck(keys(ord.upcoming) === 'e11,e12,e10', `ordine in arrivo: atteso e11,e12,e10, ottenuto ${keys(ord.upcoming)}`)
  assertCheck(keys(ord.past) === 'e14,e15,e13', `ordine passati: atteso e14,e15,e13, ottenuto ${keys(ord.past)}`)

  // Collasso sul canonico: resta il salvataggio piu' vecchio; a parita', il ref piu' basso.
  const dup = snap('dup', '2026-10-20T00:00:00.000Z', '2026-10-20T23:59:59.999Z')
  const col = buildSavedView(
    [item(21, 7, '2026-10-05T00:00:00.000Z', dup), item(20, 7, '2026-10-02T00:00:00.000Z', dup), item(22, 8, '2026-10-02T00:00:00.000Z', dup), item(23, 8, '2026-10-02T00:00:00.000Z', dup)],
    NOW
  )
  assertCheck(col.upcoming.length === 2 && col.upcoming[0].ref === 20 && col.upcoming[1].ref === 22, 'collasso: due righe, ref 20 (piu\' vecchio) e 22 (stesso istante, ref piu\' basso)')

  // Date vive se presenti, altrimenti istantanea; senza nessuna delle due la voce si salta; riga sparita = gone.
  const moved = buildSavedView(
    [
      item(30, 30, '2026-10-01T00:00:00.000Z', snap('nuovo', '2026-10-25T00:00:00.000Z', null), snap('vecchio', '2026-10-01T00:00:00.000Z', null)),
      item(31, null, '2026-10-01T00:00:00.000Z', null, snap('sparito', '2026-10-30T00:00:00.000Z', null, null)),
      item(32, null, '2026-10-01T00:00:00.000Z', null, null),
    ],
    NOW
  )
  assertCheck(moved.upcoming.length === 2, `una voce senza dati si salta: attese 2 righe, ottenute ${moved.upcoming.length}`)
  const live = moved.upcoming.find((r) => r.ref === 30)
  assertCheck(!!live && live.title === 'nuovo' && live.dateStart === '2026-10-25T00:00:00.000Z' && !live.gone, 'le date mostrate sono le vive')
  const gone = moved.upcoming.find((r) => r.ref === 31)
  assertCheck(!!gone && gone.gone && gone.key === 'r31' && gone.title === 'sparito' && gone.place === null, 'riga sparita: gone, chiave r31, campi dell\'istantanea')

  // "Data cambiata" (SAVE-05, D-10): conta il giorno di calendario, mai l'ora ne' il formato UTC/Roma.
  const changed = (kept: Snap | null, live: Snap | null) => buildSavedView([item(40, 40, '2026-10-01T00:00:00.000Z', live, kept)], NOW).upcoming[0]?.dateChanged
  const utc14 = snap('x', '2026-11-14T00:00:00.000Z', '2026-11-14T23:59:59.999Z')
  const rome14 = snap('x', '2026-11-13T23:00:00.000Z', '2026-11-14T22:59:59.999Z')
  assertCheck(changed(utc14, rome14) === false, 'cambio di formato UTC -> Roma con gli stessi giorni: non e\' una data cambiata')
  assertCheck(changed(rome14, utc14) === false, 'cambio di formato Roma -> UTC con gli stessi giorni: non e\' una data cambiata')
  assertCheck(changed(utc14, snap('x', '2026-11-21T00:00:00.000Z', '2026-11-21T23:59:59.999Z')) === true, 'primo giorno spostato (UTC): data cambiata')
  assertCheck(changed(rome14, snap('x', '2026-11-20T23:00:00.000Z', '2026-11-21T22:59:59.999Z')) === true, 'primo giorno spostato (Roma): data cambiata')
  const two = snap('x', '2026-11-14T00:00:00.000Z', '2026-11-15T23:59:59.999Z')
  assertCheck(changed(two, snap('x', '2026-11-14T00:00:00.000Z', '2026-11-16T23:59:59.999Z')) === true, 'solo l\'ultimo giorno spostato: data cambiata')
  assertCheck(changed(snap('x', '2026-11-14T08:00:00.000Z', null), snap('x', '2026-11-14T10:30:00.000Z', null)) === false, 'solo l\'ora cambia nello stesso giorno: nessun badge')
  assertCheck(changed(null, utc14) === false && changed(utc14, null) === false, 'istantanea o riga viva mancante: nessun badge')

  // "anche il ..." (D-09)
  assertCheck(otherDaysLabel(['2026-09-14', '2026-09-21']) === 'anche il 14, 21 set', `stesso mese: ${otherDaysLabel(['2026-09-14', '2026-09-21'])}`)
  assertCheck(otherDaysLabel(['2026-09-28', '2026-10-05']) === 'anche il 28 set, 5 ott', `mesi diversi: ${otherDaysLabel(['2026-09-28', '2026-10-05'])}`)
  assertCheck(otherDaysLabel(['2026-09-14']) === 'anche il 14 set', 'una data sola')
  const five = otherDaysLabel(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'])
  assertCheck(five === 'anche il 14, 21, 28 set e altre 2', `cinque date: ${five}`)
  assertCheck(otherDaysLabel([]) === null, 'nessuna data: nessuna riga')

  // otherDays: niente giorno proprio, niente date finite, niente date che l'utente ha gia' salvato.
  const sib = (id: number, start: string): Sibling => ({ id, dateStart: `${start}T00:00:00.000Z`, dateEnd: `${start}T23:59:59.999Z` })
  const series = buildSavedView(
    [
      item(50, 50, '2026-10-01T00:00:00.000Z', utc14, null, [sib(51, '2026-11-14'), sib(52, '2026-11-21'), sib(53, '2026-10-01'), sib(54, '2026-11-28'), sib(55, '2026-12-05')]),
      item(54, 54, '2026-10-02T00:00:00.000Z', snap('y', '2026-11-28T00:00:00.000Z', '2026-11-28T23:59:59.999Z')),
      item(56, 56, '2026-10-01T00:00:00.000Z', utc14),
    ],
    NOW
  )
  const withSeries = series.upcoming.find((r) => r.ref === 50)
  assertCheck(withSeries?.otherDays === 'anche il 21 nov, 5 dic', `otherDays: atteso 'anche il 21 nov, 5 dic', ottenuto ${withSeries?.otherDays}`)
  assertCheck(series.upcoming.find((r) => r.ref === 56)?.otherDays === null, 'senza siblings: otherDays null')

  if (failures > 0) {
    console.error(`[view.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[view.ts] self-check OK')
}
