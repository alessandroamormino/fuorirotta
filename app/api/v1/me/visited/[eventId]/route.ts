import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { todayInRome } from '@/lib/dateWindow'
import { prisma } from '@/lib/prisma'
import { clusterIds, snapshotForEvent } from '@/lib/saved/resolve'
import { ACCOUNT_CAP } from '@/lib/saved/snapshot'
import { visitDayFor } from '@/lib/visited/rules'

// "Ci sono stato" per un evento (Fase 27.1). Come i salvati: il browser manda
// solo l'id nel percorso, l'istantanea la costruisce il server dalla riga viva.
// Ogni query porta l'utente della sessione (IDOR).
export const dynamic = 'force-dynamic'

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

// "YYYY-MM-DD" -> Date a mezzanotte UTC, per la colonna DATE.
const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`)
const dateToDay = (d: Date) => d.toISOString().slice(0, 10)

export async function PUT(req: Request, { params }: Params): Promise<Response> {
  const g = await guard(req, params)
  if (g instanceof Response) return g
  const { ctx, id } = g
  const resolved = await snapshotForEvent(id)
  if (!resolved) return noStoreJson({ error: 'not-found' }, 404)
  const { canonicalId, snap } = resolved
  const userId = ctx.user.id

  // D-02: prima del primo giorno non si segna, e non si scrive nulla.
  const visitDay = visitDayFor(snap.dateStart, snap.dateEnd, todayInRome())
  if (visitDay === null) return noStoreJson({ error: 'too-early' }, 409)

  // Gia' segnato: 200 anche al tetto, il giorno resta quello della prima volta (D-05).
  const existing = await prisma.visitedEvent.findFirst({
    where: { userId, source: snap.source, sourceId: snap.sourceId },
    select: { visitDay: true },
  })
  if (existing) return noStoreJson({ visited: true, visitDay: dateToDay(existing.visitDay) })

  // D-07. Controllato prima dell'inserimento: due richieste insieme a 499 possono dare 501, e va bene.
  if ((await prisma.visitedEvent.count({ where: { userId } })) >= ACCOUNT_CAP) return noStoreJson({ error: 'cap' }, 409)

  // La chiave unica (utente, sorgente, id di sorgente) assorbe il doppio tocco concorrente.
  await prisma.visitedEvent.createMany({
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
        visitDay: dayToDate(visitDay),
      },
    ],
    skipDuplicates: true,
  })
  return noStoreJson({ visited: true, visitDay })
}

export async function DELETE(req: Request, { params }: Params): Promise<Response> {
  const g = await guard(req, params)
  if (g instanceof Response) return g
  const { ctx, id } = g
  // Si toglie tutto il gruppo: una riga sul membro e una sulla canonica sono una visita sola.
  // D-04: questo handler tocca solo i visitati, mai la lista dei salvati.
  const row = await prisma.event.findUnique({ where: { id }, select: { canonicalEventId: true } })
  const ids = row ? await clusterIds(row.canonicalEventId ?? id) : [id]
  const { count } = await prisma.visitedEvent.deleteMany({ where: { userId: ctx.user.id, eventId: { in: ids } } })
  // 200 anche con zero righe: il secondo tocco di un doppio tocco non e' un errore.
  return noStoreJson({ removed: count })
}
