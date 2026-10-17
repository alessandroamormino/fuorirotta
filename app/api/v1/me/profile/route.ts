import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { isValidDisplayName, normalizeDisplayName } from '@/lib/displayName'
import { prisma } from '@/lib/prisma'

// Modifica del nome visualizzato (ACCT-01). Stessa regola degli hook di
// lib/auth.ts: punti di codice, NFC, trim, 1-50.
export const dynamic = 'force-dynamic'

export async function PATCH(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return noStoreJson({ error: 'Nome non valido' }, 400)
  }
  const name = (body as { name?: unknown } | null)?.name
  if (!isValidDisplayName(name)) return noStoreJson({ error: 'Nome non valido' }, 400)

  const clean = normalizeDisplayName(name)
  await prisma.user.update({ where: { id: ctx.user.id }, data: { name: clean } })
  return noStoreJson({ name: clean })
}
