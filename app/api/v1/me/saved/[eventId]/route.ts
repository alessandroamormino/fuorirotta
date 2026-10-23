import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { clusterIds, snapshotForEvent } from '@/lib/saved/resolve'
import { ACCOUNT_CAP } from '@/lib/saved/snapshot'

// Salva e togli un evento dalla lista dell'account (SAVE-01). Il browser manda
// solo l'id nel percorso: l'istantanea la costruisce il server dalla riga viva
// (T-22-10). Ogni query porta l'utente della sessione (T-22-08, IDOR).
export const dynamic = 'force-dynamic'

// Stessa porta di /api/v1/saved/resolve: da 1 a 999999999.
const EVENT_ID = /^\d{1,9}$/

type Params = { params: Promise<{ eventId: string }> }

// Ordine delle guardie: Origin, sessione, id. Nessuna query prima.
async function guard(req: Request, params: Params['params']) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const { eventId } = await params
  const id = Number(eventId)
  if (!EVENT_ID.test(eventId) || id < 1) return noStoreJson({ error: 'not-found' }, 404)
  return { ctx, id }
}

export async function PUT(req: Request, { params }: Params): Promise<Response> {
  const g = await guard(req, params)
  if (g instanceof Response) return g
  const { ctx, id } = g
  const resolved = await snapshotForEvent(id)
  if (!resolved) return noStoreJson({ error: 'not-found' }, 404)
  const { canonicalId, snap } = resolved
  const userId = ctx.user.id

  // Gia' salvato (anche da un tocco su un membro prima di una fusione): 200 anche al tetto.
  const existing = await prisma.savedEvent.findFirst({
    where: { userId, source: snap.source, sourceId: snap.sourceId },
    select: { id: true },
  })
  if (existing) return noStoreJson({ saved: true })

  // D-15. Controllato prima dell'inserimento: due richieste insieme a 499 possono dare 501, e va bene.
  if ((await prisma.savedEvent.count({ where: { userId } })) >= ACCOUNT_CAP) return noStoreJson({ error: 'cap' }, 409)

  // La chiave unica (utente, sorgente, id di sorgente) assorbe il doppio tocco concorrente.
  await prisma.savedEvent.createMany({
    data: [
      {
        userId,
        eventId: canonicalId,
        title: snap.title,
        dateStart: new Date(snap.dateStart),
        dateEnd: snap.dateEnd === null ? null : new Date(snap.dateEnd),
        place: snap.place,
        category: snap.category,
        source: snap.source,
        sourceId: snap.sourceId,
        sourceUrl: snap.sourceUrl,
      },
    ],
    skipDuplicates: true,
  })
  return noStoreJson({ saved: true })
}

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  const g = await guard(req, params)
  if (g instanceof Response) return g
  const { ctx, id } = g
  // Si toglie tutto il gruppo: una riga salvata sul membro e una sulla canonica sono un salvato solo.
  const row = await prisma.event.findUnique({ where: { id }, select: { canonicalEventId: true } })
  const ids = row ? await clusterIds(row.canonicalEventId ?? id) : [id]
  const { count } = await prisma.savedEvent.deleteMany({ where: { userId: ctx.user.id, eventId: { in: ids } } })
  // 200 anche con zero righe: il secondo tocco di un doppio tocco non e' un errore.
  return noStoreJson({ removed: count })
}
