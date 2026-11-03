/**
 * La lista dei visitati dell'account (Fase 27.1): una voce per riga, con
 * l'istantanea presa al momento del segno. Solo server, solo lettura.
 * ref = id della riga visitata (e' il parametro di DELETE gone/{ref});
 * eventId = id canonico dell'evento vivo, null se la riga e' stata purgata.
 * Niente `live` ne' `siblings`: l'evento era gia' iniziato quando e' stato
 * segnato, l'istantanea non va confrontata con altro.
 */
import { prisma } from '@/lib/prisma'
import { resolveIds } from '@/lib/saved/resolve'
import type { Snap } from '@/lib/saved/snapshot'

export interface VisitedItemData {
  ref: number
  eventId: number | null
  visitedAt: string
  /** "YYYY-MM-DD" (Roma), dalla colonna DATE. */
  visitDay: string
  snap: Snap
  imageUrl: string | null
}

export async function listVisitedItems(userId: string): Promise<VisitedItemData[]> {
  const rows = await prisma.visitedEvent.findMany({ where: { userId }, orderBy: [{ visitDay: 'desc' }, { id: 'desc' }] })
  const live = new Map(
    (await resolveIds([...new Set(rows.flatMap((r) => (r.eventId === null ? [] : [r.eventId])))])).map((i) => [i.ref, i])
  )
  return rows.map((r) => {
    const hit = r.eventId === null ? undefined : live.get(r.eventId)
    return {
      ref: r.id,
      eventId: hit?.eventId ?? null,
      visitedAt: r.visitedAt.toISOString(),
      visitDay: r.visitDay.toISOString().slice(0, 10),
      snap: {
        title: r.title,
        dateStart: r.dateStart.toISOString(),
        dateEnd: r.dateEnd === null ? null : r.dateEnd.toISOString(),
        place: r.place,
        category: r.category,
        source: r.source,
        sourceId: r.sourceId,
        sourceUrl: r.sourceUrl,
      },
      imageUrl: hit?.imageUrl ?? null,
    }
  })
}
