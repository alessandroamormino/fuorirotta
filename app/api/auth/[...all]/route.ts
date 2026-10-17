import { getAuth } from '@/lib/auth'

// Gestore di Better Auth dietro l'interruttore (D-16): con l'accesso spento o
// la configurazione incompleta ogni richiesta e' un 404 non cacheabile.
export const dynamic = 'force-dynamic'

async function handle(req: Request): Promise<Response> {
  const auth = getAuth()
  if (!auth) {
    return new Response('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }
  return auth.handler(req)
}

export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE }
