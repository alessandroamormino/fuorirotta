import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { todayInRome } from '@/lib/dateWindow'
import { prisma } from '@/lib/prisma'
import { ACCOUNT_CAP } from '@/lib/saved/snapshot'
import { visitDayFor } from '@/lib/visited/rules'

// "Ci sono stato" da una riga salvata (D-03). Serve soprattutto per le righe "Passati" il cui
// evento non c'e' piu' (event_id NULL): l'istantanea e' quella della riga salvata, mai un testo
// del client. La riga si cerca SEMPRE con l'utente della sessione (IDOR): quella di un altro 404.
export const dynamic = 'force-dynamic'

const REF = /^\d{1,9}$/

// "YYYY-MM-DD" -> Date a mezzanotte UTC, per la colonna DATE.
const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`)

export async function PUT(req: Request, { params }: { params: Promise<{ ref: string }> }): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const { ref } = await params
  if (!REF.test(ref) || Number(ref) < 1) return noStoreJson({ error: 'not-found' }, 404)
  const userId = ctx.user.id
  const row = await prisma.savedEvent.findFirst({ where: { id: Number(ref), userId } })
  if (!row) return noStoreJson({ error: 'not-found' }, 404)

  // D-02: prima del primo giorno non si segna, e non si scrive nulla.
  const visitDay = visitDayFor(row.dateStart, row.dateEnd, todayInRome())
  if (visitDay === null) return noStoreJson({ error: 'too-early' }, 409)

  // Gia' segnato: 200 anche al tetto, il giorno resta quello della prima volta (D-05).
  const existing = await prisma.visitedEvent.findFirst({
    where: { userId, source: row.source, sourceId: row.sourceId },
    select: { visitDay: true },
  })
  if (existing) return noStoreJson({ visited: true, visitDay: existing.visitDay.toISOString().slice(0, 10) })

  // D-07. Controllato prima dell'inserimento: due richieste insieme a 499 possono dare 501, e va bene.
  if ((await prisma.visitedEvent.count({ where: { userId } })) >= ACCOUNT_CAP) return noStoreJson({ error: 'cap' }, 409)

  // La chiave unica (utente, sorgente, id di sorgente) assorbe il doppio tocco concorrente.
  await prisma.visitedEvent.createMany({
    data: [
      {
        userId,
        eventId: row.eventId,
        title: row.title,
        dateStart: row.dateStart,
        dateEnd: row.dateEnd,
        place: row.place,
        category: row.category,
        source: row.source,
        sourceId: row.sourceId,
        sourceUrl: row.sourceUrl,
        visitDay: dayToDate(visitDay),
      },
    ],
    skipDuplicates: true,
  })
  return noStoreJson({ visited: true, visitDay })
}
