/**
 * Istantanea di un evento salvato: cio' che /salvati mostra quando la riga
 * sorgente e' stata cancellata dal purge dei 7 giorni (D1). La costruisce
 * SEMPRE il server dalla riga viva, mai un client con testo suo: i titoli
 * arrivano da siti di terzi e finirebbero in una tabella e in un file .ics.
 *
 * Modulo puro: nessun DOM, nessun React, nessun Prisma. Importato da componenti
 * "use client" (store, lista), quindi sicuro nel bundle browser. Anche per
 * questo `ResolvedItem` vive qui e non in resolve.ts: check:browser-bundle
 * segue pure le righe `import type`, e un file client che importa un tipo da un
 * modulo che importa lib/prisma fallisce il gate.
 */

import { CANONICAL_CATEGORIES } from '../categories/taxonomy'
import { eventDays } from '../eventDays'

/**
 * Per quanto un evento finito resta in "Passati" (D-01). E' il numero che
 * /privacy dichiara: la lista sul dispositivo e il purge lato server lo
 * condividono, cosi' non possono divergere dal testo.
 */
export const SAVED_RETENTION_MONTHS = 12

/** Tetto della lista sul dispositivo (D-06): oltre, il cuore resta spento e compare l'avviso. */
export const GUEST_CAP = 100

/** Tetto della lista di un account (D-15): guardia contro la crescita senza fine, non una quota esatta. */
export const ACCOUNT_CAP = 500

export interface Snap {
  title: string
  /** ISO 8601, le stesse cifre della colonna: eventDays() legge entrambi i formati. */
  dateStart: string
  dateEnd: string | null
  place: string | null
  category: string
  source: string
  sourceId: string
  sourceUrl: string | null
}

/** Una riga della risposta di POST /api/v1/saved/resolve, una per id richiesto. */
export interface ResolvedItem {
  /** L'id richiesto, cosi' il client riconosce la risposta anche se l'ordine cambiasse. */
  ref: number
  /** canonicalEventId ?? id della riga viva, null se la riga non esiste piu'. */
  eventId: number | null
  live: Snap | null
}

interface SnapSource {
  title: string
  dateStart: Date | string
  dateEnd?: Date | string | null
  locationName?: string | null
  comune?: { name: string; provinceCode: string } | null
  canonicalCategory: string
  source: string
  sourceId: string
  sourceUrl?: string | null
}

const iso = (d: Date | string): string => new Date(d).toISOString()

export function snapFromEvent(e: SnapSource): Snap {
  // Stessa regola del segmento luogo di EventCard: comune "Nome (PR)", poi il luogo scritto dalla sorgente.
  const location = (e.locationName ?? '').trim()
  const place = e.comune ? `${e.comune.name} (${e.comune.provinceCode})` : location || null
  return {
    title: e.title,
    dateStart: iso(e.dateStart),
    dateEnd: e.dateEnd == null ? null : iso(e.dateEnd),
    place,
    category: e.canonicalCategory,
    source: e.source,
    sourceId: e.sourceId,
    // Solo http(s), come calendarFields: un "javascript:" non deve finire in un link.
    sourceUrl: e.sourceUrl && /^https?:\/\//i.test(e.sourceUrl) ? e.sourceUrl : null,
  }
}

export interface DeviceEntry {
  /** L'id dell'evento come lo mostrava la superficie al momento del tocco (D-08: quella data). */
  id: number
  savedAt: string
  /** Riempita dal server (resolve) dopo il salvataggio; null finche' non e' arrivata. */
  snap: Snap | null
  /** Id canonico risolto dal server: due salvataggi dello stesso gruppo accendono lo stesso cuore. */
  c?: number
}

// Larghezze delle colonne di SavedEvent: un'istantanea piu' larga non entrerebbe nella tabella (22-04).
const MAX_ID = 999_999_999
const isId = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= MAX_ID
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max
const isDate = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v))

/**
 * Dati altrui, corrotti o scritti a mano (T-22-05): restituisce l'istantanea
 * ripulita se ogni campo e' ammesso, altrimenti null. Mai un'eccezione.
 */
export function validateSnap(input: unknown): Snap | null {
  if (typeof input !== 'object' || input === null) return null
  const x = input as Record<string, unknown>
  const { title, dateStart, dateEnd, place, category, source, sourceId, sourceUrl } = x
  if (!str(title, 500) || title === '') return null
  if (!isDate(dateStart) || !(dateEnd === null || isDate(dateEnd))) return null
  if (!(place === null || str(place, 255))) return null
  if (typeof category !== 'string' || !(CANONICAL_CATEGORIES as readonly string[]).includes(category)) return null
  if (!str(source, 50) || !str(sourceId, 255)) return null
  if (!(sourceUrl === null || (str(sourceUrl, 1000) && /^https?:\/\//i.test(sourceUrl)))) return null
  return { title, dateStart, dateEnd, place, category, source, sourceId, sourceUrl }
}

/** "YYYY-MM-DD" meno N mesi di calendario, con il giorno ridotto al fine mese (29/02 -> 28/02). */
function minusMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = y * 12 + (m - 1) - months
  const ty = Math.floor(t / 12)
  const tm = t % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** D-02: un evento finito da piu' di SAVED_RETENTION_MONTHS mesi, contati dal giorno di Roma di oggi, si dimentica. */
export function isExpired(snap: Snap, now: Date): boolean {
  const cutoff = minusMonths(eventDays(now).startDay, SAVED_RETENTION_MONTHS)
  return eventDays(snap.dateStart, snap.dateEnd).endDay < cutoff
}

/** Legge la lista del dispositivo: scarta ogni voce non valida, doppia o scaduta e tiene le prime GUEST_CAP. */
export function parseDeviceList(raw: string | null, now: Date): DeviceEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const seen = new Set<number>()
  const out: DeviceEntry[] = []
  for (const e of parsed as unknown[]) {
    if (typeof e !== 'object' || e === null) continue
    const { id, savedAt, snap, c } = e as Record<string, unknown>
    if (!isId(id) || seen.has(id) || !isDate(savedAt) || !(c === undefined || isId(c))) continue
    const valid = snap === null ? null : validateSnap(snap)
    if (snap !== null && (valid === null || isExpired(valid, now))) continue
    seen.add(id)
    out.push(c === undefined ? { id, savedAt, snap: valid } : { id, savedAt, snap: valid, c })
    if (out.length === GUEST_CAP) break
  }
  return out
}

// Self-check: `npx tsx lib/saved/snapshot.ts`, lanciato da scripts/saved.test.sh
// sotto quattro fusi orari. La guardia su `typeof` non e' cerimonia: il modulo
// e' raggiungibile da componenti "use client" e nel bundle browser `module`
// non esiste (check:browser-bundle).
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const assertCheck = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  const base = {
    title: 'Sagra',
    dateStart: '2026-10-18T00:00:00.000Z',
    canonicalCategory: 'Sagra',
    source: 'x',
    sourceId: '1',
  }

  assertCheck(
    snapFromEvent({ ...base, comune: { name: 'Bergamo', provinceCode: 'BG' }, locationName: 'Piazza' }).place === 'Bergamo (BG)',
    'il comune vince sul luogo'
  )
  assertCheck(snapFromEvent({ ...base, locationName: '  Piazza Vecchia ' }).place === 'Piazza Vecchia', 'senza comune vale il luogo, tagliato')
  assertCheck(snapFromEvent({ ...base, locationName: '   ' }).place === null, 'luogo vuoto -> null')
  assertCheck(snapFromEvent(base).place === null, 'nessun luogo -> null')
  assertCheck(snapFromEvent({ ...base, sourceUrl: 'javascript:alert(1)' }).sourceUrl === null, 'sourceUrl javascript: scartato')
  assertCheck(snapFromEvent({ ...base, sourceUrl: 'HTTPS://example.it/e' }).sourceUrl === 'HTTPS://example.it/e', 'sourceUrl https tenuto')
  const a = snapFromEvent({ ...base, dateEnd: '2026-10-19T23:59:59.999Z' })
  const b = snapFromEvent({ ...base, dateStart: new Date(base.dateStart), dateEnd: new Date('2026-10-19T23:59:59.999Z') })
  assertCheck(a.dateStart === b.dateStart && a.dateEnd === b.dateEnd, 'Date e stringa danno le stesse stringhe ISO')
  assertCheck(a.dateStart === '2026-10-18T00:00:00.000Z' && snapFromEvent(base).dateEnd === null, 'ISO invariato, fine nulla resta nulla')

  // Codec del dispositivo (D-02, D-06, T-22-05), nei due formati di data salvati.
  const NOW = new Date('2026-10-23T10:00:00.000Z') // Roma: 2026-10-23, taglio 2025-10-23
  const good: Snap = {
    title: 'Sagra',
    dateStart: '2026-10-18T00:00:00.000Z',
    dateEnd: '2026-10-19T23:59:59.999Z',
    place: 'Bergamo (BG)',
    category: 'Sagre e feste',
    source: 'x',
    sourceId: '1',
    sourceUrl: 'https://example.it/e',
  }
  const entry = (id: number, snap: Snap | null = good, extra: object = {}) => ({ id, savedAt: '2026-10-20T08:00:00.000Z', snap, ...extra })
  const parse = (v: unknown, now = NOW) => parseDeviceList(typeof v === 'string' ? v : JSON.stringify(v), now)
  assertCheck(JSON.stringify(validateSnap(good)) === JSON.stringify(good), 'validateSnap: istantanea valida invariata')
  assertCheck(validateSnap({ ...good, sourceUrl: 'javascript:alert(1)' }) === null, 'validateSnap: javascript: rifiutato')
  assertCheck(validateSnap({ ...good, sourceUrl: null, place: null, dateEnd: null }) !== null, 'validateSnap: campi nulli ammessi')
  assertCheck(validateSnap({ ...good, category: 'Inventata' }) === null, 'validateSnap: categoria fuori tassonomia')
  assertCheck(validateSnap({ ...good, title: 'x'.repeat(501) }) === null, 'validateSnap: titolo di 501 caratteri')
  assertCheck(validateSnap({ ...good, title: 'x'.repeat(500) }) !== null, 'validateSnap: titolo di 500 caratteri ammesso')
  assertCheck(validateSnap({ ...good, dateStart: 'non una data' }) === null, 'validateSnap: dateStart illeggibile')
  assertCheck(validateSnap(null) === null && validateSnap('x') === null && validateSnap([]) === null, 'validateSnap: non oggetti')

  assertCheck(parseDeviceList(null, NOW).length === 0, 'parse: null -> vuota')
  assertCheck(parseDeviceList('not json', NOW).length === 0, 'parse: JSON rotto -> vuota')
  assertCheck(parse({ a: 1 }).length === 0, 'parse: non un array -> vuota')
  const bad = [0, -1, 1.5, '7', 1_000_000_000].map((id) => ({ ...entry(1), id }))
  assertCheck(parse([...bad, { id: 2, snap: null }, entry(3, { ...good, title: '' }), entry(4, good, { c: 'x' }), null, 5]).length === 0, 'parse: id, savedAt, snap e c non validi scartati')
  const dup = parse([entry(5, null), { ...entry(5), savedAt: '2026-10-21T08:00:00.000Z' }, entry(6)])
  assertCheck(dup.length === 2 && dup[0].snap === null, 'parse: il duplicato tiene la prima voce')
  assertCheck(parse(Array.from({ length: 120 }, (_, i) => entry(i + 1))).length === GUEST_CAP, 'parse: 120 valide -> le prime 100')
  assertCheck(parse(Array.from({ length: 120 }, (_, i) => entry(i + 1)))[99].id === 100, 'parse: restano le PRIME 100')
  assertCheck(parse([entry(7, null, { c: 70 })])[0].c === 70, 'parse: id canonico tenuto')

  // Scadenza: giorno di Roma di oggi meno 12 mesi di calendario.
  const ended = (start: string, end: string | null): Snap => ({ ...good, dateStart: start, dateEnd: end })
  const utcFrame = (day: string) => ended(`${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`)
  const romeFrame = (day: string) => {
    const prev = new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10)
    return ended(`${prev}T22:00:00.000Z`, `${day}T21:59:59.999Z`)
  }
  assertCheck(isExpired(utcFrame('2025-10-22'), NOW), 'scaduta: finita 12 mesi e un giorno fa (formato UTC)')
  assertCheck(!isExpired(utcFrame('2025-10-23'), NOW), 'tenuta: finita esattamente 12 mesi fa (formato UTC)')
  assertCheck(isExpired(romeFrame('2025-10-22'), NOW), 'scaduta: finita 12 mesi e un giorno fa (formato Roma)')
  assertCheck(!isExpired(romeFrame('2025-10-23'), NOW), 'tenuta: finita esattamente 12 mesi fa (formato Roma)')
  assertCheck(parse([entry(1, utcFrame('2025-10-22')), entry(2, utcFrame('2025-10-23')), entry(3, null)]).map((e) => e.id).join() === '2,3', 'parse: scadute via, snap nullo tenuto')
  // 23:30 UTC del 22 e' gia' il 23 a Roma: il taglio segue Roma, non il fuso del processo.
  assertCheck(isExpired(utcFrame('2025-10-22'), new Date('2026-10-22T23:30:00.000Z')), 'taglio sul giorno di Roma, non su quello UTC')
  assertCheck(minusMonths('2028-02-29', 12) === '2027-02-28', 'meno 12 mesi dal 29/02 -> 28/02')
  assertCheck(minusMonths('2026-03-31', 1) === '2026-02-28', 'meno 1 mese dal 31/03 -> 28/02')
  assertCheck(minusMonths('2026-01-15', 12) === '2025-01-15', 'meno 12 mesi attraversa l\'anno')

  if (failures > 0) {
    console.error(`[snapshot.ts] ${failures} verifiche fallite`)
    process.exit(1)
  }
  console.log('[snapshot.ts] self-check OK')
}
