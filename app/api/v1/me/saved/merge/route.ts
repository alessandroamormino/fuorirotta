import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { snapshotsForIds } from '@/lib/saved/resolve'
import { ACCOUNT_CAP, GUEST_CAP, isExpired, validateSnap, type Snap } from '@/lib/saved/snapshot'

// Unione della lista del dispositivo nell'account al primo accesso (AUTH-09).
// Idempotente: la chiave unica (utente, sorgente, id di sorgente) e
// skipDuplicates fanno si' che un secondo invio della stessa lista (rete
// caduta dopo il 2xx, due schede insieme) aggiunga 0 righe e sia sicuro.
// Il testo dell'istantanea lo costruisce il server dalla riga viva (T-22-13):
// un testo mandato dal browser si accetta SOLO per una riga gia' purgata e
// solo se validateSnap lo ammette; per un evento che esiste ancora si ignora.
export const dynamic = 'force-dynamic'

const MAX_ID = 999_999_999

type Candidate = { eventId: number | null; snap: Snap; savedAt: Date }

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
  const items = (body as { items?: unknown } | null)?.items
  // Prima di ogni query (T-22-14): al massimo quanto un dispositivo puo' contenere.
  if (!Array.isArray(items) || items.length > GUEST_CAP) return noStoreJson({ error: 'bad-request' }, 400)

  const now = new Date()
  const raw: { id: number; savedAt: Date; snap: unknown }[] = []
  for (const item of items as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { id, savedAt, snap } = item as Record<string, unknown>
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > MAX_ID) continue
    const at = typeof savedAt === 'string' ? new Date(savedAt) : null
    if (!at || Number.isNaN(at.getTime())) continue
    // Un orologio in anticipo non deve mettere i salvati "nel futuro".
    raw.push({ id, savedAt: at > now ? now : at, snap })
  }
  if (raw.length === 0) return noStoreJson({ added: 0, overCap: 0 })

  const userId = ctx.user.id
  const live = await snapshotsForIds(raw.map((r) => r.id))
  const candidates: Candidate[] = []
  const gone: Candidate[] = []
  for (const r of raw) {
    const hit = live.get(r.id)
    if (hit) {
      candidates.push({ eventId: hit.canonicalId, snap: hit.snap, savedAt: r.savedAt })
      continue
    }
    const snap = validateSnap(r.snap)
    if (snap) gone.push({ eventId: null, snap, savedAt: r.savedAt })
  }
  if (gone.length > 0) {
    // Una riga "sparita" che in realta' esiste sotto un altro id (sorgente, id di sorgente)
    // non puo' portare testo del browser: si scarta.
    const existing = await prisma.event.findMany({
      where: { OR: gone.map((g) => ({ source: g.snap.source, sourceId: g.snap.sourceId })) },
      select: { source: true, sourceId: true },
    })
    const alive = new Set(existing.map((e) => `${e.source}\0${e.sourceId}`))
    candidates.push(...gone.filter((g) => !alive.has(`${g.snap.source}\0${g.snap.sourceId}`)))
  }

  // D-02: un evento finito da piu' di SAVED_RETENTION_MONTHS mesi non entra; doppi e gia' presenti nemmeno.
  const held = await prisma.savedEvent.findMany({ where: { userId }, select: { source: true, sourceId: true } })
  const seen = new Set(held.map((h) => `${h.source}\0${h.sourceId}`))
  const fresh = candidates.filter((c) => {
    const key = `${c.snap.source}\0${c.snap.sourceId}`
    if (isExpired(c.snap, now) || seen.has(key)) return false
    seen.add(key)
    return true
  })

  // D-15: entra quello che ci sta (le righe gia' presenti sono state tolte sopra).
  const room = Math.max(0, ACCOUNT_CAP - held.length)
  const take = fresh.slice(0, room)
  const created =
    take.length === 0
      ? { count: 0 }
      : await prisma.savedEvent.createMany({
          data: take.map((c) => ({
            userId,
            eventId: c.eventId,
            title: c.snap.title,
            dateStart: new Date(c.snap.dateStart),
            dateEnd: c.snap.dateEnd === null ? null : new Date(c.snap.dateEnd),
            place: c.snap.place,
            category: c.snap.category,
            source: c.snap.source,
            sourceId: c.snap.sourceId,
            sourceUrl: c.snap.sourceUrl,
            savedAt: c.savedAt,
          })),
          skipDuplicates: true,
        })
  return noStoreJson({ added: created.count, overCap: fresh.length - take.length })
}
