import { assertSameOrigin, listUserSessions, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'

// Sessioni attive dell'utente (AUTH-06, D-08). Non si inoltra la lista della
// libreria: contiene i valori segreti delle sessioni. Qui una select esplicita.
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  return noStoreJson({ sessions: await listUserSessions(ctx.user.id, ctx.session.id) })
}

// Esci da tutti gli altri dispositivi: resta solo la sessione corrente.
export async function DELETE(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const { count } = await prisma.session.deleteMany({
    where: { userId: ctx.user.id, id: { not: ctx.session.id } },
  })
  return noStoreJson({ revoked: count })
}
