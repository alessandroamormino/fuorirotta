// Il feed "Per te" (Fase 23), solo lato server: gli eventi che l'utente segue,
// nell'ordine della lista (rilevanza clampata a oggi). Pagina in due passi come
// /api/events: prima id e data di tutte le righe che combaciano (leggero),
// poi le righe intere solo della pagina. Niente N+1: una query per passo.
import { prisma } from '@/lib/prisma'
import { windowStartToday } from '@/lib/dateWindow'
import { compareByWindowRelevance } from '@/lib/eventOrdering'
import { composeEvent, groupMembersByCanonical } from '@/lib/dedup/compose'
import { serializeEvent } from '@/lib/serializeEvent'
import type { Event } from '@/lib/types'
import { buildFeedWhere, splitFollows } from './where'

export async function feedPage(
  userId: string,
  limit: number,
  offset: number
): Promise<{ items: Event[]; total: number; follows: number }> {
  const rows = await prisma.userFollow.findMany({ where: { userId }, select: { kind: true, key: true } })
  const windowStart = windowStartToday()
  const where = buildFeedWhere(splitFollows(rows), windowStart)
  if (!where) return { items: [], total: 0, follows: rows.length }

  const matching = await prisma.event.findMany({ where, select: { id: true, dateStart: true } })
  matching.sort(compareByWindowRelevance(windowStart))
  const pageIds = matching.slice(offset, offset + limit).map((e) => e.id)
  if (pageIds.length === 0) return { items: [], total: matching.length, follows: rows.length }

  const [events, members] = await Promise.all([
    prisma.event.findMany({
      where: { id: { in: pageIds } },
      include: { comune: { select: { name: true, provinceCode: true } } },
    }),
    prisma.event.findMany({ where: { canonicalEventId: { in: pageIds } }, orderBy: { id: 'asc' } }),
  ])
  const membersByCanonical = groupMembersByCanonical(members)
  const byId = new Map(events.map((e) => [e.id, e]))
  // `in` non conserva l'ordine: si rimette quello della pagina.
  const items = pageIds.flatMap((id) => {
    const e = byId.get(id)
    return e ? [serializeEvent(composeEvent(e, membersByCanonical.get(id) ?? []) as typeof e)] : []
  })
  return { items, total: matching.length, follows: rows.length }
}
