import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'

// Come saved/gone/{ref}: una riga di sola istantanea (l'evento e' stato purgato) la toglie
// il suo proprietario. Si toglie SOLO una riga dell'utente della sessione con event_id NULL:
// un id altrui o di un evento vivo non toglie nulla (IDOR). 200 anche con zero righe.
export const dynamic = 'force-dynamic'

const REF = /^\d{1,9}$/

export async function DELETE(req: Request, { params }: { params: Promise<{ ref: string }> }): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const { ref } = await params
  if (!REF.test(ref)) return noStoreJson({ error: 'not-found' }, 404)
  const { count } = await prisma.visitedEvent.deleteMany({ where: { id: Number(ref), userId: ctx.user.id, eventId: null } })
  return noStoreJson({ removed: count })
}
