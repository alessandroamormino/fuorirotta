import { resolveIds } from '@/lib/saved/resolve'

export const dynamic = 'force-dynamic'

// Risposte sempre private e senza cache: dipendono dalla lista di chi chiede.
// Niente noStoreJson: lib/account importa lib/auth, e questa rotta pubblica
// non deve dipendere dal modulo di accesso (deve funzionare a interruttore spento).
const HEADERS = { 'Cache-Control': 'private, no-store' }
const MAX_IDS = 100
const MAX_ID = 999999999

const bad = () => Response.json({ error: 'bad-request' }, { status: 400, headers: HEADERS })

// POST e non GET: una query string metterebbe la lista di un ospite nel log
// di accesso di nginx per 14 giorni. Gli id si leggono, non si salvano; la rotta
// non legge cookie ne' header e non assume l'origine (assertSameOrigin risponde
// 404 a interruttore spento, e gli ospiti devono funzionare comunque).
export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return bad()
  }
  const ids = (body as { ids?: unknown } | null)?.ids
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > MAX_IDS ||
    !ids.every((n) => Number.isSafeInteger(n) && n >= 1 && n <= MAX_ID)
  ) {
    return bad()
  }
  return Response.json({ items: await resolveIds(ids as number[]) }, { headers: HEADERS })
}
