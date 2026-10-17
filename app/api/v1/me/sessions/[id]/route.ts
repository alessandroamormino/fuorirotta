import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'

// Esci da UN altro dispositivo. Mai per solo id (IDOR, T-21-20): l'id deve
// appartenere all'utente della sessione.
export const dynamic = 'force-dynamic'

const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const { id } = await params
  if (!SESSION_ID.test(id)) return noStoreJson({ error: 'not-found' }, 404)
  // Uscire da questo dispositivo e' POST /api/auth/sign-out, non questa rotta.
  if (id === ctx.session.id) return noStoreJson({ error: 'current' }, 400)
  const { count } = await prisma.session.deleteMany({ where: { id, userId: ctx.user.id } })
  return count === 0 ? noStoreJson({ error: 'not-found' }, 404) : noStoreJson({ revoked: 1 })
}
