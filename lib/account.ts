import { getAuth } from './auth'
import { prisma } from './prisma'
import { deviceLabel, type DeviceKind } from './userAgent'

// Supporto alle rotte /api/v1/me/* (Fase 21): tutte dietro l'interruttore,
// tutte con sessione, nessuna mai in cache condivisa.

type Auth = NonNullable<ReturnType<typeof getAuth>>
type SessionData = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>

/** Risposta JSON mai in cache condivisa, anche per 401, 403 e 404 (T-21-24). */
export function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/**
 * Le rotte nostre non hanno il controllo di Origin della libreria (lo applica
 * solo ai propri endpoint): lo rifacciamo qui per ogni gestore non-GET, prima
 * di toccare il database. E' una difesa in piu' accanto a SameSite=Lax.
 * Origin assente o diverso da BETTER_AUTH_URL -> 403. Con l'interruttore
 * spento prima viene il 404: la superficie non esiste.
 * Eccezione (Fase 26): una richiesta con Authorization: Bearer e SENZA header
 * Cookie salta il controllo, perche' e' un client nativo (l'app non manda Origin).
 */
export function assertSameOrigin(req: Request): Response | null {
  if (!getAuth()) return noStoreJson({ error: 'not-found' }, 404)
  // Un browser non puo' aggiungere Authorization a una richiesta cross-site senza un
  // preflight CORS, che questo sito non approva mai (nessun Access-Control-Allow-*), e
  // un'app nativa non manda Origin. Chi porta anche un Cookie e' una richiesta da browser
  // e tiene il controllo: altrimenti un bearer non verificabile accanto a un cookie valido
  // autenticherebbe via cookie senza Origin. Un bearer non valido passa di qui e poi cade
  // in requireUser con 401: l'ordine Origin -> sessione -> corpo resta, nessuna query prima.
  if (/^bearer\s+\S/i.test(req.headers.get('authorization') ?? '') && !req.headers.has('cookie')) return null
  const base = process.env.BETTER_AUTH_URL
  const origin = req.headers.get('origin')
  if (!base || !origin || origin !== new URL(base).origin) return noStoreJson({ error: 'origin' }, 403)
  return null
}

/** 404 con l'interruttore spento, 401 senza sessione valida, altrimenti utente e sessione. */
export async function requireUser(
  req: Request,
): Promise<Response | { auth: Auth; user: SessionData['user']; session: SessionData['session'] }> {
  const auth = getAuth()
  if (!auth) return noStoreJson({ error: 'not-found' }, 404)
  const data = await auth.api.getSession({ headers: req.headers })
  if (!data) return noStoreJson({ error: 'unauthenticated' }, 401)
  return { auth, user: data.user, session: data.session }
}

// Giorno di calendario di Roma ("YYYY-MM-DD") di un istante.
function romeDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(date)
}

/**
 * Etichetta di attivita' di una sessione, a granularita' di GIORNO: la
 * libreria rinnova updatedAt al massimo una volta al giorno, quindi "minuti
 * fa" sarebbe una bugia. Calcolata sul server con il giorno di Roma, cosi' la
 * pagina dinamica non ha mismatch di idratazione (UI-SPEC 4b).
 */
export function activityLabel(updatedAt: Date, current: boolean, todayRome: string): string {
  if (current) return 'attiva ora (questo dispositivo)'
  const days = Math.round((Date.parse(todayRome) - Date.parse(romeDay(updatedAt))) / 86_400_000)
  if (days <= 0) return 'oggi'
  return days === 1 ? 'ieri' : `${days} giorni fa`
}

export type SessionRow = {
  id: string
  device: string
  kind: DeviceKind
  createdAt: Date
  lastActive: Date
  expiresAt: Date
  current: boolean
}

/**
 * Sessioni non scadute dell'utente, senza token ne' IP (select esplicita):
 * la corrente per prima, poi la piu' recente, poi per id.
 */
export async function listUserSessions(userId: string, currentSessionId: string): Promise<SessionRow[]> {
  const rows = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    select: { id: true, userAgent: true, createdAt: true, updatedAt: true, expiresAt: true },
  })
  return rows
    .map((row) => {
      const { label, kind } = deviceLabel(row.userAgent)
      return {
        id: row.id,
        device: label,
        kind,
        createdAt: row.createdAt,
        lastActive: row.updatedAt,
        expiresAt: row.expiresAt,
        current: row.id === currentSessionId,
      }
    })
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) ||
        b.lastActive.getTime() - a.lastActive.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
}
