import { noStoreJson, requireUser } from '@/lib/account'
import { feedPage } from '@/lib/follows/feed'
import { clampFeedParams } from '@/lib/follows/where'

// Il feed personale (Fase 23): gli eventi dei luoghi e delle categorie che
// l'utente segue. Privato, mai in cache condivisa. GET senza controllo di
// Origin (non cambia nulla). L'utente viene SOLO dalla sessione.
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const params = new URL(req.url).searchParams
  const { limit, offset } = clampFeedParams(params.get('limit'), params.get('offset'))
  return noStoreJson(await feedPage(ctx.user.id, limit, offset))
}
