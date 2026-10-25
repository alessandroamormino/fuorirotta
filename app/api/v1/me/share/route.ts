import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { listSharedEvents, newShareToken } from '@/lib/saved/share'

// Il link di condivisione della lista (Fase 24, D-02): NON si crea da solo. GET legge
// soltanto; il link nasce con un POST esplicito. L'utente viene sempre dalla sessione,
// mai dal corpo o dalla query.
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const userId = ctx.user.id

  const row = await prisma.shareLink.findUnique({ where: { userId }, select: { token: true, showName: true } })
  // N e' quello che vedrebbe la pagina pubblica: stessa funzione (listSharedEvents).
  const upcoming = (await listSharedEvents(userId)).length
  return noStoreJson({ link: row ? { path: `/l/${row.token}`, showName: row.showName } : null, upcoming })
}

export async function POST(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const userId = ctx.user.id

  let row = await prisma.shareLink.findUnique({ where: { userId }, select: { token: true, showName: true } })
  if (!row) {
    try {
      row = await prisma.shareLink.create({ data: { userId, token: newShareToken() }, select: { token: true, showName: true } })
    } catch {
      // Due richieste insieme: l'altra ha creato la riga (chiave primaria userId).
      row = await prisma.shareLink.findUnique({ where: { userId }, select: { token: true, showName: true } })
      if (!row) return noStoreJson({ error: 'server' }, 500)
    }
  }
  return noStoreJson({ path: `/l/${row.token}`, showName: row.showName })
}
