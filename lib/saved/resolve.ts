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
import { snapFromEvent, type ResolvedItem } from '@/lib/saved/snapshot'

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
