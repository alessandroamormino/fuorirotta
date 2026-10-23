import { noStoreJson, requireUser } from '@/lib/account'
import { listAccountItems } from '@/lib/saved/resolve'

// La lista dell'account per /salvati: istantanea salvata + istantanea viva.
// GET senza controllo di Origin, come l'export: non cambia nulla.
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  return noStoreJson({ items: await listAccountItems(ctx.user.id) })
}
