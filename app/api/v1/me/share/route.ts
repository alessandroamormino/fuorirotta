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

// Disattiva il link (D-09, D-11): la riga sparisce. Niente flag, niente storico: un link
// morto e' una riga assente, quindi la pagina pubblica non trova nulla, come per un codice
// mai esistito. 200 anche se non c'era nulla da togliere.
export async function DELETE(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx

  const { count } = await prisma.shareLink.deleteMany({ where: { userId: ctx.user.id } })
  return noStoreJson({ removed: count })
}

// Mostra il nome del proprietario sulla pagina pubblica (D-04, D-05). Il corpo deve essere
// un oggetto con showName booleano: tutto il resto e' 400 prima di ogni query. Il codice
// del link non cambia mai con un PATCH; senza link e' 404 (non lo crea).
export async function PATCH(req: Request): Promise<Response> {
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
  const showName = (body as { showName?: unknown } | null)?.showName
  if (typeof showName !== 'boolean') return noStoreJson({ error: 'bad-request' }, 400)

  const { count } = await prisma.shareLink.updateMany({ where: { userId: ctx.user.id }, data: { showName } })
  if (count === 0) return noStoreJson({ error: 'not-found' }, 404)
  return noStoreJson({ showName })
}
