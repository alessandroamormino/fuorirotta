import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { newFeedToken } from '@/lib/saved/feed'

// Rigenera il link del feed: il vecchio token smette di esistere subito (D-13),
// quindi il vecchio URL risponde lo stesso 404 di un token mai esistito.
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const userId = ctx.user.id

  const token = newFeedToken()
  const row = await prisma.calendarFeed.upsert({
    where: { userId },
    create: { userId, token, rotatedAt: new Date() },
    update: { token, rotatedAt: new Date() },
  })
  return noStoreJson({ path: `/cal/${row.token}.ics` })
}
