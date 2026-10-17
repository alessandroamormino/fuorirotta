import { noStoreJson, requireUser } from '@/lib/account'
import { todayInRome } from '@/lib/dateWindow'
import { prisma } from '@/lib/prisma'
import { deviceLabel } from '@/lib/userAgent'
import { USER_DATA_REGISTRY } from '@/lib/userData/registry'

// Esportazione di tutti i dati dell'utente (ACCT-03, D-12).
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx

  // Select esplicita: la riga utente ha anche image e altro che non esportiamo.
  const profile = await prisma.user.findUnique({
    where: { id: ctx.user.id },
    select: { name: true, email: true, emailVerified: true, createdAt: true },
  })
  // Account eliminato fra la sessione e qui (altro dispositivo): come non autenticato.
  if (!profile) return noStoreJson({ error: 'unauthenticated' }, 401)

  const body: Record<string, unknown> = { exportedAt: new Date().toISOString(), format: 1, profile }
  // Il registro e' l'UNICA fonte delle chiavi: una tabella che una fase
  // successiva vi registra compare nell'export senza toccare questa rotta (D-12).
  for (const entry of USER_DATA_REGISTRY) {
    const rows = await entry.exportRows(ctx.user.id, ctx.session.id)
    body[entry.exportKey] =
      entry.exportKey === 'sessions'
        ? rows.map((row) => ({ device: deviceLabel(row.userAgent as string | null).label, ...row }))
        : rows
  }

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="fuorirotta-dati-${todayInRome()}.json"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
