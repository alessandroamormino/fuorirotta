/**
 * Vista di /salvati: dagli elementi risolti a "In arrivo" e "Passati". Modulo
 * puro e sicuro nel bundle browser. TUTTI i confronti fra giorni passano da
 * eventDays / isEventOver (lib/eventDays.ts, lib/eventStatus.ts): le date si
 * salvano in due formati (UTC in produzione, Roma nel DB locale) e un
 * confronto fra timestamp grezzi sbaglia di un giorno in uno dei due.
 */
import { eventDays } from '../eventDays'
import { isEventOver } from '../eventStatus'
import type { Snap } from './snapshot'

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
}

interface Entry {
  row: SavedRow
  savedAt: string
  startDay: string
  endDay: string
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

  const upcoming: Entry[] = []
  const past: Entry[] = []
  for (const [key, item] of kept) {
    // Le date mostrate sono quelle vive se ci sono, altrimenti quelle dell'istantanea.
    const data = (item.live ?? item.snap) as Snap
    const { startDay, endDay } = eventDays(data.dateStart, data.dateEnd)
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
  const item = (ref: number, eventId: number | null, savedAt: string, live: Snap | null, kept: Snap | null = null): SavedItemData => ({
    ref,
    eventId,
    savedAt,
    snap: kept,
    live,
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

  if (failures > 0) {
    console.error(`[view.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[view.ts] self-check OK')
}
