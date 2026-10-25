import { appleEnabled } from '@/lib/auth'
import { applyAppleEvent, verifyAppleNotification } from '@/lib/appleAuth'

// Notifiche server-to-server di Apple (D-15): revoca del consenso, cancellazione
// dell'account. Tre scelte:
// - Autentica solo la firma del JWS di Apple, verificata PRIMA di ogni accesso al
//   database; per questo niente controllo same-origin (Apple non manda Origin).
// - Sta fuori da /api/auth di proposito: il catch-all e il rate limit di Better
//   Auth non si applicano. Il costo di un flood e' una verifica di firma, limitata
//   dal tetto di 16 KB e dalla cache delle chiavi di jose.
// - Il corpo e' JSON {payload} come nell'esempio di Apple; payload= in forma di
//   form costa una riga (A1, confermato solo in produzione). Mai nei log: il JWS,
//   il corpo, un sub accanto a un'e-mail.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }
const MAX_BYTES = 16384

const reply = (status: number) => Response.json({}, { status, headers: NO_STORE })

function payloadOf(text: string): unknown {
  try {
    const json: unknown = JSON.parse(text)
    if (json && typeof json === 'object') return (json as { payload?: unknown }).payload
  } catch {
    // non e' JSON: si prova come form
  }
  return new URLSearchParams(text).get('payload')
}

export async function POST(req: Request): Promise<Response> {
  if (!appleEnabled()) return reply(404)
  const text = await req.text()
  if (Buffer.byteLength(text) > MAX_BYTES) return reply(413)
  const payload = payloadOf(text)
  if (typeof payload !== 'string' || !payload) return reply(400)
  let event
  try {
    event = await verifyAppleNotification(payload)
  } catch {
    console.error('[Apple S2S] notifica rifiutata')
    return reply(401)
  }
  await applyAppleEvent(event)
  return reply(200)
}
