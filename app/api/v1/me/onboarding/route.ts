import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { PLACE_CAP, followId, isPlaceKind, isWellFormed, type FollowKind, type PlaceKind } from '@/lib/follows/keys'
import { existingPlaceKeys } from '@/lib/follows/server'

// Finestra di benvenuto (Fase 23, PREF-03): le scelte e il segno "vista" in UNA
// transazione. onboarded_at dice solo che la finestra e' stata mostrata, mai un
// consenso: saltare lascia un account con zero follow e nessun'altra riga.
// Ordine: forma -> esistenza (400, tutta la richiesta) -> tetto dei 50 luoghi (409) -> scrittura.
export const dynamic = 'force-dynamic'

type Pick = { kind: FollowKind; key: string }
const MAX_CATEGORIES = 7

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
  if (!Array.isArray(places) || !Array.isArray(categories) || places.length > PLACE_CAP || categories.length > MAX_CATEGORIES) {
    return noStoreJson({ error: 'bad-request' }, 400)
  }

  const picks: Pick[] = []
  const newPlaces: { kind: PlaceKind; key: string }[] = []
  for (const p of places) {
    const { kind, key } = (p ?? {}) as { kind?: unknown; key?: unknown }
    if (typeof kind !== 'string' || typeof key !== 'string' || !isPlaceKind(kind) || !isWellFormed(kind, key)) {
      return noStoreJson({ error: 'bad-request' }, 400)
    }
    picks.push({ kind, key })
    newPlaces.push({ kind, key })
  }
  for (const c of categories) {
    if (typeof c !== 'string' || !isWellFormed('category', c)) return noStoreJson({ error: 'bad-request' }, 400)
    picks.push({ kind: 'category', key: c })
  }

  const found = await existingPlaceKeys(newPlaces)
  if (newPlaces.some((p) => !found.has(followId(p.kind, p.key)))) return noStoreJson({ error: 'bad-request' }, 400)

  const userId = ctx.user.id
  // Tetto: luoghi gia' seguiti piu' i luoghi nuovi distinti (D-04); le categorie non contano.
  // ponytail: conteggio fuori dalla transazione, due richieste insieme possono sforare di poco il tetto, come il PUT.
  const have = new Set(
    (await prisma.userFollow.findMany({ where: { userId, kind: { not: 'category' } }, select: { kind: true, key: true } })).map((f) =>
      followId(f.kind as FollowKind, f.key)
    )
  )
  const fresh = new Set(newPlaces.map((p) => followId(p.kind, p.key)))
  for (const id of have) fresh.delete(id)
  if (have.size + fresh.size > PLACE_CAP) return noStoreJson({ error: 'cap' }, 409)

  const now = new Date()
  const [added] = await prisma.$transaction([
    prisma.userFollow.createMany({ data: picks.map((p) => ({ userId, ...p })), skipDuplicates: true }),
    prisma.userPreference.createMany({ data: [{ userId, onboardedAt: now }], skipDuplicates: true }),
    // Una riga nata senza segno lo riceve; il primo segno non si sposta mai.
    prisma.userPreference.updateMany({ where: { userId, onboardedAt: null }, data: { onboardedAt: now } }),
  ])
  return noStoreJson({ onboarded: true, added: added.count })
}
