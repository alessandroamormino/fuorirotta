import { noStoreJson, requireUser } from '@/lib/account'
import { listVisitedItems } from '@/lib/visited/list'

// La lista dei visitati dell'account: istantanea del segno + foto dell'evento vivo.
// GET senza controllo di Origin, come /me/saved: non cambia nulla.
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  return noStoreJson({ items: await listVisitedItems(ctx.user.id) })
}
