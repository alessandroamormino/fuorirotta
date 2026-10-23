import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { newFeedToken } from '@/lib/saved/feed'

// Il link del feed dell'account: lo stesso a ogni apertura finche' non si
// rigenera (D-11, D-13). Si crea alla prima richiesta.
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const userId = ctx.user.id

  let row = await prisma.calendarFeed.findUnique({ where: { userId } })
  if (!row) {
    try {
      row = await prisma.calendarFeed.create({ data: { userId, token: newFeedToken() } })
    } catch {
      // Due richieste insieme: l'altra ha creato la riga (chiave primaria userId).
      row = await prisma.calendarFeed.findUnique({ where: { userId } })
      if (!row) return noStoreJson({ error: 'server' }, 500)
    }
  }
  return noStoreJson({ path: `/cal/${row.token}.ics` })
}
