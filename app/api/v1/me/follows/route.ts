import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { VALID_REGION_SLUGS } from '@/lib/scrapers/regionSlug'
import { isWellFormed, regionChip, sortFollows, type FollowItem, type FollowKind } from '@/lib/follows/keys'

// Cosa segue l'utente (Fase 23, PREF-01). Il corpo porta (kind, key) in JSON,
// MAI nel percorso o nella query: finirebbe nei log di nginx (T-23-05).
// Ogni query porta l'utente della sessione, mai uno del corpo (T-23-01, IDOR).
// Il tetto dei 50 luoghi e il controllo di esistenza arrivano col piano 09.
export const dynamic = 'force-dynamic'

// Etichetta provvisoria: regioni e categorie si sanno dalle liste in memoria;
// per comuni e province il piano 09 sposta tutto in lib/follows/server.ts.
function labelFor(kind: FollowKind, key: string): string {
  return kind === 'region' ? regionChip(VALID_REGION_SLUGS.get(key) ?? key) : key
}

// Ordine delle guardie: Origin, sessione, corpo ben formato. Nessuna query prima.
async function guard(req: Request) {
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
  const { kind, key } = (body ?? {}) as { kind?: unknown; key?: unknown }
  if (typeof kind !== 'string' || typeof key !== 'string' || !isWellFormed(kind, key)) {
    return noStoreJson({ error: 'bad-request' }, 400)
  }
  return { ctx, kind: kind as FollowKind, key }
}

// GET senza controllo di Origin, come saved/ids: non cambia nulla.
export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const userId = ctx.user.id
  const [rows, pref] = await Promise.all([
    prisma.userFollow.findMany({ where: { userId }, select: { kind: true, key: true } }),
    prisma.userPreference.findUnique({ where: { userId }, select: { onboardedAt: true } }),
  ])
  const follows: FollowItem[] = sortFollows(
    rows.filter((r) => isWellFormed(r.kind, r.key)).map((r) => ({ kind: r.kind as FollowKind, key: r.key, label: labelFor(r.kind as FollowKind, r.key) }))
  )
  return noStoreJson({ onboarded: pref?.onboardedAt != null, follows })
}

export async function PUT(req: Request): Promise<Response> {
  const g = await guard(req)
  if (g instanceof Response) return g
  const { ctx, kind, key } = g
  const userId = ctx.user.id
  // La chiave unica (utente, kind, key) assorbe il doppio tocco concorrente.
  await prisma.userFollow.createMany({ data: [{ userId, kind, key }], skipDuplicates: true })
  return noStoreJson({ followed: true, label: labelFor(kind, key) })
}

export async function DELETE(req: Request): Promise<Response> {
  const g = await guard(req)
  if (g instanceof Response) return g
  const { ctx, kind, key } = g
  const { count } = await prisma.userFollow.deleteMany({ where: { userId: ctx.user.id, kind, key } })
  // 200 anche con zero righe: il secondo tocco di un doppio tocco non e' un errore.
  return noStoreJson({ removed: count })
}
