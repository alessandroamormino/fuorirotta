import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { isPlaceKind, isWellFormed, type FollowKind } from '@/lib/follows/keys'

// Finestra di benvenuto (Fase 23, PREF-03): le scelte e il segno "vista" in UNA
// transazione. onboarded_at dice solo che la finestra e' stata mostrata, mai un
// consenso: saltare lascia un account con zero follow e nessun'altra riga.
export const dynamic = 'force-dynamic'

type Pick = { kind: FollowKind; key: string }

export async function POST(req: Request): Promise<Response> {
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
  const { places, categories } = (body ?? {}) as { places?: unknown; categories?: unknown }
  if (!Array.isArray(places) || !Array.isArray(categories)) return noStoreJson({ error: 'bad-request' }, 400)

  const picks: Pick[] = []
  for (const p of places) {
    const { kind, key } = (p ?? {}) as { kind?: unknown; key?: unknown }
    if (typeof kind !== 'string' || typeof key !== 'string' || !isPlaceKind(kind) || !isWellFormed(kind, key)) {
      return noStoreJson({ error: 'bad-request' }, 400)
    }
    picks.push({ kind, key })
  }
  for (const c of categories) {
    if (typeof c !== 'string' || !isWellFormed('category', c)) return noStoreJson({ error: 'bad-request' }, 400)
    picks.push({ kind: 'category', key: c })
  }

  const userId = ctx.user.id
  const now = new Date()
  const [added] = await prisma.$transaction([
    prisma.userFollow.createMany({ data: picks.map((p) => ({ userId, ...p })), skipDuplicates: true }),
    prisma.userPreference.createMany({ data: [{ userId, onboardedAt: now }], skipDuplicates: true }),
    // Una riga nata senza segno lo riceve; il primo segno non si sposta mai.
    prisma.userPreference.updateMany({ where: { userId, onboardedAt: null }, data: { onboardedAt: now } }),
  ])
  return noStoreJson({ onboarded: true, added: added.count })
}
