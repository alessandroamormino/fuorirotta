import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { todayInRome } from '@/lib/dateWindow'
import { eventDays } from '@/lib/eventDays'
import { prisma } from '@/lib/prisma'
import { snapshotsForIds } from '@/lib/saved/resolve'
import { ACCOUNT_CAP, GUEST_CAP, isDate, validateSnap, type Snap } from '@/lib/saved/snapshot'
import { visitDayFor } from '@/lib/visited/rules'

// Unione dei visitati del dispositivo nell'account al primo accesso (D-07). Stesso schema di
// /me/saved/merge: idempotente (chiave unica + skipDuplicates), il testo dell'istantanea lo
// costruisce il server dalla riga viva, un testo del client vale solo per una riga gia' purgata
// e solo se validateSnap lo ammette. Differenze: nessun limite dei 12 mesi (i visitati non si
// purgano), gli eventi non ancora iniziati si saltano (D-02) e il giorno di visita del client si
// tiene solo dentro [primo giorno, min(ultimo giorno, oggi)], altrimenti lo ricalcola il server (D-05).
// `savedAt` e' l'istante del segno: il nome e' quello della voce del dispositivo, riusato apposta.
export const dynamic = 'force-dynamic'

const MAX_ID = 999_999_999
const DAY = /^\d{4}-\d{2}-\d{2}$/

type Candidate = { eventId: number | null; snap: Snap; visitedAt: Date; clientDay: unknown }

// "YYYY-MM-DD" -> Date a mezzanotte UTC, per la colonna DATE.
const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`)
// Un giorno scritto bene ma che non esiste (2026-02-30) non e' un giorno.
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && dayToDate(v).toISOString().slice(0, 10) === v

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
  // Prima di ogni query (T-27.1-10): al massimo quanto un dispositivo puo' contenere.
  if (!Array.isArray(items) || items.length > GUEST_CAP) return noStoreJson({ error: 'bad-request' }, 400)

  const now = new Date()
  const raw: { id: number; savedAt: Date; snap: unknown; visitDay: unknown }[] = []
  for (const item of items as unknown[]) {
    if (typeof item !== 'object' || item === null) continue
    const { id, savedAt, snap, visitDay } = item as Record<string, unknown>
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > MAX_ID) continue
    // isDate: anche il range (anni 2000..2100), Postgres rifiuta il resto e farebbe fallire tutta l'unione.
    if (!isDate(savedAt)) continue
    const at = new Date(savedAt)
    // Un orologio in anticipo non deve mettere i segni "nel futuro".
    raw.push({ id, savedAt: at > now ? now : at, snap, visitDay })
  }
  if (raw.length === 0) return noStoreJson({ added: 0, overCap: 0 })

  const userId = ctx.user.id
  const live = await snapshotsForIds(raw.map((r) => r.id))
  const candidates: Candidate[] = []
  const gone: Candidate[] = []
  for (const r of raw) {
    const hit = live.get(r.id)
    if (hit) {
      candidates.push({ eventId: hit.canonicalId, snap: hit.snap, visitedAt: r.savedAt, clientDay: r.visitDay })
      continue
    }
    const snap = validateSnap(r.snap)
    if (snap) gone.push({ eventId: null, snap, visitedAt: r.savedAt, clientDay: r.visitDay })
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

  // D-02 e D-05: i non iniziati si saltano; il giorno del client resta solo se plausibile. Doppi e gia' presenti nemmeno.
  const today = todayInRome()
  const held = await prisma.visitedEvent.findMany({ where: { userId }, select: { source: true, sourceId: true } })
  const seen = new Set(held.map((h) => `${h.source}\0${h.sourceId}`))
  const fresh: Array<Candidate & { visitDay: string }> = []
  for (const c of candidates) {
    const key = `${c.snap.source}\0${c.snap.sourceId}`
    const computed = visitDayFor(c.snap.dateStart, c.snap.dateEnd, today)
    if (computed === null || seen.has(key)) continue
    seen.add(key)
    const { startDay, endDay } = eventDays(c.snap.dateStart, c.snap.dateEnd)
    const lastOk = endDay < today ? endDay : today
    const visitDay = isDay(c.clientDay) && c.clientDay >= startDay && c.clientDay <= lastOk ? c.clientDay : computed
    fresh.push({ ...c, visitDay })
  }

  // D-07: entra quello che ci sta (le righe gia' presenti sono state tolte sopra).
  const room = Math.max(0, ACCOUNT_CAP - held.length)
  const take = fresh.slice(0, room)
  let created: { count: number }
  try {
    created =
      take.length === 0
        ? { count: 0 }
        : await prisma.visitedEvent.createMany({
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
              visitDay: dayToDate(c.visitDay),
              visitedAt: c.visitedAt,
            })),
            skipDuplicates: true,
          })
  } catch (err) {
    // Rete di sicurezza: un valore che Postgres rifiuta (P2039 = errore del database sul dato) e'
    // un rifiuto definitivo, non un guasto da ritentare: 400, cosi' il client non ripete all'infinito.
    // Connessione e resto restano 500 (il client riprova).
    if ((err as { code?: string } | null)?.code === 'P2039') return noStoreJson({ error: 'bad-request' }, 400)
    throw err
  }
  return noStoreJson({ added: created.count, overCap: fresh.length - take.length })
}
