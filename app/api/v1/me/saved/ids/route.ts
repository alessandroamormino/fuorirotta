import { noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'

// Gli id canonici dei salvati dell'account, per accendere i cuori. Una riga
// salvata su un membro e una sulla sua canonica danno lo stesso id (SAVE-04).
// GET senza controllo di Origin, come l'export: non cambia nulla.
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT DISTINCT COALESCE(e.canonical_event_id, e.id) AS id
    FROM saved_events s JOIN events e ON e.id = s.event_id
    WHERE s.user_id = ${ctx.user.id}`
  return noStoreJson({ ids: rows.map((r) => Number(r.id)) })
}
