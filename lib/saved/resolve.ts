/**
 * Da id di eventi a id canonici e istantanee vive, per la lista degli ospiti
 * (/salvati). Solo server e SOLO LETTURA: nessuna scrittura, nessun log degli
 * id (AUTH-09: la lista di un ospite non esiste sul server prima dell'accesso).
 *
 * Al piu' tre query qualunque sia la lunghezza della lista: le righe chieste,
 * le canoniche non chieste, i membri delle canoniche. Stessa composizione di
 * app/eventi/[id]/page.tsx (getComposedEvent), cosi' il titolo qui e' quello
 * che la pagina evento mostra.
 */
import { prisma } from '@/lib/prisma'
import { composeEvent, groupMembersByCanonical } from '@/lib/dedup/compose'
import { snapFromEvent, type ResolvedItem, type Snap } from '@/lib/saved/snapshot'
import type { SavedItemData } from '@/lib/saved/view'

export async function resolveIds(ids: number[]): Promise<ResolvedItem[]> {
  const comune = { select: { name: true, provinceCode: true } }
  const requested = await prisma.event.findMany({ where: { id: { in: ids } }, include: { comune } })
  const rows = new Map(requested.map((r) => [r.id, r]))

  // Un membro non ha pagina propria (D-15): si salta alla canonica, che puo' non essere fra gli id chiesti.
  const canonicalIds = [...new Set(requested.map((r) => r.canonicalEventId ?? r.id))]
  const missing = canonicalIds.filter((id) => !rows.has(id))
  if (missing.length > 0) {
    for (const r of await prisma.event.findMany({ where: { id: { in: missing } }, include: { comune } })) rows.set(r.id, r)
  }
  const members = groupMembersByCanonical(
    await prisma.event.findMany({ where: { canonicalEventId: { in: canonicalIds } }, orderBy: { id: 'asc' } })
  )

  return ids.map((ref) => {
    const row = rows.get(ref)
    const canonical = row && rows.get(row.canonicalEventId ?? row.id)
    if (!canonical) return { ref, eventId: null, live: null }
    // composeEvent copia la riga canonica ({ ...canonical }): `comune` resta.
    const composed = composeEvent(canonical, members.get(canonical.id) ?? [])
    return { ref, eventId: canonical.id, live: snapFromEvent({ ...composed, comune: canonical.comune }) }
  })
}

/** Un solo evento: id canonico e istantanea viva, o null se la riga non esiste (stessa composizione di resolveIds). */
export async function snapshotForEvent(id: number): Promise<{ canonicalId: number; snap: Snap } | null> {
  const [item] = await resolveIds([id])
  return item?.eventId != null && item.live ? { canonicalId: item.eventId, snap: item.live } : null
}

/** Per ogni id la cui riga esiste: id canonico e istantanea viva (stessa composizione di resolveIds, nessuna query in piu'). */
export async function snapshotsForIds(ids: number[]): Promise<Map<number, { canonicalId: number; snap: Snap }>> {
  const out = new Map<number, { canonicalId: number; snap: Snap }>()
  for (const item of await resolveIds(ids)) {
    if (item.eventId !== null && item.live) out.set(item.ref, { canonicalId: item.eventId, snap: item.live })
  }
  return out
}

/**
 * La lista dell'account per /salvati: una voce per riga, con l'istantanea salvata
 * e, se la riga dell'evento c'e' ancora, quella viva. ref = id della riga salvata
 * (non dell'evento): e' il parametro di DELETE gone/{ref}.
 */
export async function listAccountItems(userId: string): Promise<SavedItemData[]> {
  const rows = await prisma.savedEvent.findMany({ where: { userId }, orderBy: { id: 'asc' } })
  const live = new Map(
    (await resolveIds([...new Set(rows.flatMap((r) => (r.eventId === null ? [] : [r.eventId])))])).map((i) => [i.ref, i])
  )
  return rows.map((r) => {
    const hit = r.eventId === null ? undefined : live.get(r.eventId)
    return {
      ref: r.id,
      eventId: hit?.eventId ?? null,
      savedAt: r.savedAt.toISOString(),
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
      live: hit?.live ?? null,
    }
  })
}

/** La canonica e tutti i suoi membri: le righe salvate su uno qualunque contano come un salvato solo (SAVE-04). */
export async function clusterIds(canonicalId: number): Promise<number[]> {
  const members = await prisma.event.findMany({ where: { canonicalEventId: canonicalId }, select: { id: true } })
  return [canonicalId, ...members.map((m) => m.id)]
}
