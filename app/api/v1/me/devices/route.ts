import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'
import { APNS_ENVIRONMENTS, APNS_TOKEN_RE, DEVICE_CAP, type ApnsEnvironment } from '@/lib/api-contract'

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
  const write = () =>
    prisma.pushDevice.upsert({
      where: { deviceToken },
      create: { deviceToken, ...data },
      update: { ...data, lastSeenAt: new Date() }
    })
  try {
    await write()
  } catch (e) {
    // Due prime registrazioni dello stesso token insieme: la perdente trova la riga e la aggiorna.
    if ((e as { code?: string })?.code !== 'P2002') return noStoreJson({ error: 'server' }, 500)
    try {
      await write()
    } catch {
      return noStoreJson({ error: 'server' }, 500)
    }
  }
  // Tetto per utente (A8): una reinstallazione cambia il token, un 409 chiuderebbe fuori chi usa l'app davvero.
  // ponytail: controllo dopo la scrittura, due registrazioni al tetto insieme possono lasciare 11 righe fino al PUT successivo.
  const excess = await prisma.pushDevice.findMany({
    where: { userId: ctx.user.id },
    orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
    skip: DEVICE_CAP,
    select: { id: true }
  })
  if (excess.length) await prisma.pushDevice.deleteMany({ where: { id: { in: excess.map((r) => r.id) }, userId: ctx.user.id } })
  return noStoreJson({ registered: true })
}

// Toglie un dispositivo, MAI di un altro utente (T-26-09): la riga si cerca per (utente della sessione, token).
// 200 anche con zero righe: il secondo tocco, o un token mai registrato, non e' un errore.
export async function DELETE(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  const body = await readBody(req)
  const { token } = body ?? {}
  if (typeof token !== 'string' || !APNS_TOKEN_RE.test(token)) return noStoreJson({ error: 'bad-request' }, 400)
  const { count } = await prisma.pushDevice.deleteMany({ where: { userId: ctx.user.id, deviceToken: token.toLowerCase() } })
  return noStoreJson({ removed: count })
}
