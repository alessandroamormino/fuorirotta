// Regola del feed "Per te" (D-10), pura: nessun database, importa solo tipi e la
// finestra di date. Luoghi in OR fra loro, categorie in OR fra loro, e le due
// famiglie in AND; una sola famiglia seguita vale da sola. Solo eventi
// canonici, disponibili da oggi con la regola unica di lib/dateWindow.ts.
import type { Prisma } from '../generated/prisma/client'
import { availableEventsWhere } from '../dateWindow'
// Solo per il self-check in fondo: questo modulo e' lato server e non entra mai nel bundle del browser.
import assert from 'node:assert'

export type FollowSets = { comuni: string[]; province: string[]; regions: string[]; categories: string[] }

export const FEED_MAX_LIMIT = 24
const DEFAULT_LIMIT = 10
const MAX_OFFSET = 10000

/** Raggruppa le righe per tipo; un tipo sconosciuto si ignora. */
export function splitFollows(rows: readonly { kind: string; key: string }[]): FollowSets {
  const sets: FollowSets = { comuni: [], province: [], regions: [], categories: [] }
  for (const { kind, key } of rows) {
    if (kind === 'comune') sets.comuni.push(key)
    else if (kind === 'province') sets.province.push(key)
    else if (kind === 'region') sets.regions.push(key)
    else if (kind === 'category') sets.categories.push(key)
  }
  return sets
}

/**
 * null = nessun follow (niente da mostrare). Un follow di regione include gli
 * eventi senza comune risolto (stessa clausola della pagina regione); uno di
 * provincia o di comune no (D-05).
 */
export function buildFeedWhere(f: FollowSets, windowStart: Date): Prisma.EventWhereInput | null {
  const places: Prisma.EventWhereInput[] = []
  if (f.comuni.length) places.push({ comune: { istatCode: { in: f.comuni } } })
  if (f.province.length) places.push({ comune: { provinceCode: { in: f.province } } })
  if (f.regions.length) places.push({ region: { in: f.regions } })
  if (places.length === 0 && f.categories.length === 0) return null

  const and: Prisma.EventWhereInput[] = [availableEventsWhere(windowStart)]
  if (places.length) and.push({ OR: places })
  if (f.categories.length) and.push({ canonicalCategory: { in: f.categories } })
  return { canonicalEventId: null, AND: and }
}

function intOr(raw: string | null, fallback: number): number {
  if (raw === null || !/^-?\d+$/.test(raw.trim())) return fallback
  return Number(raw)
}

/** Limiti dell'API: limit 1..24 (default 10), offset 0..10000 (default 0); il resto torna al default. */
export function clampFeedParams(limit: string | null, offset: string | null): { limit: number; offset: number } {
  return {
    limit: Math.min(FEED_MAX_LIMIT, Math.max(1, intOr(limit, DEFAULT_LIMIT))),
    offset: Math.min(MAX_OFFSET, Math.max(0, intOr(offset, 0))),
  }
}

// Self-check: `npx tsx lib/follows/where.ts` (check:follows, in quattro fusi).
// Guardia a tre condizioni come lib/dateWindow.ts.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const ws = new Date('2026-09-10T00:00:00.000Z')
  const date = availableEventsWhere(ws)
  const none: FollowSets = { comuni: [], province: [], regions: [], categories: [] }

  // nessun follow -> nulla da mostrare
  assert.strictEqual(buildFeedWhere(none, ws), null)

  // solo categorie: regola di data + categoria, nessun OR di luoghi
  assert.deepStrictEqual(buildFeedWhere({ ...none, categories: ['Altro'] }, ws), {
    canonicalEventId: null,
    AND: [date, { canonicalCategory: { in: ['Altro'] } }, { canonicalCategory: { in: ['Altro'] } }],
  })

  // solo una regione: l'OR dei luoghi ha UN ramo
  assert.deepStrictEqual(buildFeedWhere({ ...none, regions: ['lombardia'] }, ws), {
    canonicalEventId: null,
    AND: [date, { OR: [{ region: { in: ['lombardia'] } }] }],
  })

  // tutti e quattro: tre rami nell'ordine comune, provincia, regione + categorie
  const all = buildFeedWhere({ comuni: ['016024'], province: ['BG'], regions: ['lombardia'], categories: ['Altro'] }, ws)
  assert.deepStrictEqual(all, {
    canonicalEventId: null,
    AND: [
      date,
      { OR: [{ comune: { istatCode: { in: ['016024'] } } }, { comune: { provinceCode: { in: ['BG'] } } }, { region: { in: ['lombardia'] } }] },
      { canonicalCategory: { in: ['Altro'] } },
    ],
  })

  // splitFollows: raggruppa e ignora i tipi ignoti
  assert.deepStrictEqual(
    splitFollows([
      { kind: 'comune', key: '016024' },
      { kind: 'province', key: 'BG' },
      { kind: 'region', key: 'lombardia' },
      { kind: 'category', key: 'Altro' },
      { kind: 'hacker', key: 'x' },
    ]),
    { comuni: ['016024'], province: ['BG'], regions: ['lombardia'], categories: ['Altro'] }
  )

  // parametri: default, estremi, non numerici
  assert.deepStrictEqual(clampFeedParams(null, null), { limit: 10, offset: 0 })
  assert.deepStrictEqual(clampFeedParams('0', '-5'), { limit: 1, offset: 0 })
  assert.deepStrictEqual(clampFeedParams('999', '20000'), { limit: FEED_MAX_LIMIT, offset: 10000 })
  assert.deepStrictEqual(clampFeedParams('abc', 'x'), { limit: 10, offset: 0 })
  assert.deepStrictEqual(clampFeedParams('5', '30'), { limit: 5, offset: 30 })

  console.log('self-check OK')
}
