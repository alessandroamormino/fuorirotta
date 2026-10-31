import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { APNS_ENVIRONMENTS, APNS_TOKEN_RE, type ApnsEnvironment } from '@/lib/api-contract'

// Dispositivi push dell'app (Fase 26, API-03). Il token del dispositivo e' un identificativo
// per-installazione: va SOLO nel corpo JSON, mai nel percorso, nella query, in un log o in un
// export (stessa regola di T-23-05). Utente e sessione vengono sempre da ctx, mai dal corpo (IDOR).
export const dynamic = 'force-dynamic'

const APP_VERSION_RE = /^[0-9A-Za-z.+-]{1,20}$/

// Corpo JSON come oggetto, altrimenti null. Ordine delle guardie nelle rotte: Origin, sessione, corpo; nessuna query prima.
async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function PUT(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const body = await readBody(req)
  const { token, environment, appVersion } = body ?? {}
  if (
    typeof token !== 'string' ||
    !APNS_TOKEN_RE.test(token) ||
    typeof environment !== 'string' ||
    !(APNS_ENVIRONMENTS as readonly string[]).includes(environment) ||
    (appVersion !== undefined && (typeof appVersion !== 'string' || !APP_VERSION_RE.test(appVersion)))
  ) {
    return noStoreJson({ error: 'bad-request' }, 400)
  }
  const deviceToken = token.toLowerCase()
  const data = {
    userId: ctx.user.id,
    sessionId: ctx.session.id,
    environment: environment as ApnsEnvironment,
    appVersion: appVersion ?? null
  }
  // Se il token esiste gia' la riga passa al chiamante (telefono ceduto a un altro account).
  await prisma.pushDevice.upsert({
    where: { deviceToken },
    create: { deviceToken, ...data },
    update: { ...data, lastSeenAt: new Date() }
  })
  return noStoreJson({ registered: true })
}
