import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { newShareToken } from '@/lib/saved/share'

// Rigenera il link di condivisione (D-09): il codice vecchio viene sovrascritto, quindi il
// vecchio indirizzo risponde lo stesso 404 di uno mai esistito. SOLO aggiornamento, a
// differenza del feed del calendario: senza un link esistente non crea nulla (D-02, solo
// il POST di /api/v1/me/share crea). Il nome (showName) resta com'e'.
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx

  const token = newShareToken()
  // Un solo UPDATE ... RETURNING (review WR-02): con updateMany + findUnique un DELETE
  // concorrente in mezzo faceva rispondere 200 con un link gia' morto. Senza riga Prisma
  // lancia P2025, che qui vale "nessun link da rigenerare".
  try {
    const row = await prisma.shareLink.update({
      where: { userId: ctx.user.id },
      data: { token, rotatedAt: new Date() },
      select: { showName: true },
    })
    return noStoreJson({ path: `/l/${token}`, showName: row.showName })
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === 'P2025') return noStoreJson({ error: 'not-found' }, 404)
    throw err
  }
}
