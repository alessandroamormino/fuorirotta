import { getAuth } from './auth'

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
 */
export function assertSameOrigin(req: Request): Response | null {
  if (!getAuth()) return noStoreJson({ error: 'not-found' }, 404)
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
