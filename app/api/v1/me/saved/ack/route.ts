import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'

// "Data cambiata" una volta sola (SAVE-05, D-10): /salvati, DOPO aver mostrato il
// badge, chiede di riallineare le date dell'istantanea a quelle vive. E' una
// chiamata esplicita e mai un effetto del GET della lista: un refetch o il doppio
// render di StrictMode brucerebbero il badge prima che qualcuno lo veda.
// Tocca solo le righe dell'utente della sessione (T-22-21): l'ack di un altro
// utente aggiorna 0 righe. Idempotente: la seconda volta le date sono gia' uguali.
export const dynamic = 'force-dynamic'

const MAX_IDS = 500
const MAX_ID = 999_999_999

export async function POST(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return noStoreJson({ error: 'bad-request' }, 400)
  }
  const ids = (body as { eventIds?: unknown } | null)?.eventIds
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > MAX_IDS ||
    !ids.every((n) => Number.isSafeInteger(n) && n >= 1 && n <= MAX_ID)
  ) {
    return noStoreJson({ error: 'bad-request' }, 400)
  }

  // La riga salvata punta alla canonica (o, prima di una fusione, a un membro): COALESCE porta
  // entrambe alla canonica, di cui si copiano le date. Parametri legati, nessuna concatenazione.
  const updated = await prisma.$executeRaw`
    UPDATE saved_events s
    SET date_start = c.date_start, date_end = c.date_end
    FROM events e
    JOIN events c ON c.id = COALESCE(e.canonical_event_id, e.id)
    WHERE s.user_id = ${ctx.user.id}
      AND s.event_id = e.id
      AND c.id = ANY(${ids as number[]}::int[])
  `
  return noStoreJson({ updated })
}
