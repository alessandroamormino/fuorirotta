import { noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'

// Gli id canonici dei visitati dell'account, per accendere il bottone "Ci sono stato".
// Una riga su un membro e una sulla sua canonica danno lo stesso id.
// GET senza controllo di Origin, come /me/saved/ids: non cambia nulla.
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const rows = await prisma.$queryRaw<{ id: number }[]>`
    SELECT DISTINCT COALESCE(e.canonical_event_id, e.id) AS id
    FROM visited_events v JOIN events e ON e.id = v.event_id
    WHERE v.user_id = ${ctx.user.id}`
  return noStoreJson({ ids: rows.map((r) => Number(r.id)) })
}
