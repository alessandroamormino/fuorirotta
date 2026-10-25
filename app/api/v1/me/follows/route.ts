import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { PLACE_CAP, isPlaceKind, isWellFormed, type FollowKind } from '@/lib/follows/keys'
import { listFollows, resolveFollowLabel } from '@/lib/follows/server'

// Cosa segue l'utente (Fase 23, PREF-01). Il corpo porta (kind, key) in JSON,
// MAI nel percorso o nella query: finirebbe nei log di nginx (T-23-05).
// Ogni query porta l'utente della sessione, mai uno del corpo (T-23-01, IDOR).
// Chiave: forma (isWellFormed) -> esistenza (resolveFollowLabel, 404) -> tetto dei 50 luoghi (409).
export const dynamic = 'force-dynamic'

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
  return noStoreJson(await listFollows(ctx.user.id))
}

export async function PUT(req: Request): Promise<Response> {
  const g = await guard(req)
  if (g instanceof Response) return g
  const { ctx, kind, key } = g
  const userId = ctx.user.id
  const label = await resolveFollowLabel(kind, key)
  if (label === null) return noStoreJson({ error: 'not-found' }, 404)
  // Gia' seguito: 200 anche al tetto. Le categorie non contano (D-04).
  // ponytail: controllo prima dell'insert, due richieste a 49 possono arrivare a 51; il tetto frena la crescita, non e' una quota esatta.
  const exists = await prisma.userFollow.findUnique({ where: { userId_kind_key: { userId, kind, key } }, select: { id: true } })
  if (!exists && isPlaceKind(kind) && (await prisma.userFollow.count({ where: { userId, kind: { not: 'category' } } })) >= PLACE_CAP) {
    return noStoreJson({ error: 'cap' }, 409)
  }
  // La chiave unica (utente, kind, key) assorbe il doppio tocco concorrente.
  await prisma.userFollow.createMany({ data: [{ userId, kind, key }], skipDuplicates: true })
  return noStoreJson({ followed: true, label })
}

export async function DELETE(req: Request): Promise<Response> {
  const g = await guard(req)
  if (g instanceof Response) return g
  const { ctx, kind, key } = g
  const { count } = await prisma.userFollow.deleteMany({ where: { userId: ctx.user.id, kind, key } })
  // 200 anche con zero righe: il secondo tocco di un doppio tocco non e' un errore.
  return noStoreJson({ removed: count })
}
