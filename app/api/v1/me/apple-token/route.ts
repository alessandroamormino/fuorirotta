import { setTokenUtil } from 'better-auth/oauth2'
import { appleConfigured, exchangeAppleCode } from '@/lib/appleAuth'
import { assertSameOrigin, noStoreJson, requireUser } from '@/lib/account'
import { prisma } from '@/lib/prisma'

// Fase 27 (MOB-05): dopo l'accesso nativo con Apple l'app manda qui, una volta sola, l'authorization code.
// Better Auth 1.7.10 scarta il refresh token all'accesso con id token, e senza di esso l'eliminazione
// dell'account non potrebbe revocare la concessione presso Apple. Utente e riga Apple vengono sempre
// da ctx, mai dal corpo (IDOR). Ne' il codice ne' i token finiscono mai in un log.
export const dynamic = 'force-dynamic'

const MAX_CODE_LENGTH = 2048

// Il `sub` dell'id token che Apple ha appena restituito dal suo endpoint su TLS: nessuna firma da verificare.
function subOf(idToken: string | null): string | null {
  try {
    const payload = JSON.parse(Buffer.from((idToken ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')) as { sub?: unknown }
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

export async function POST(req: Request): Promise<Response> {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const ctx = await requireUser(req)
  if (ctx instanceof Response) return ctx
  let code: unknown
  try {
    code = ((await req.json()) as { authorizationCode?: unknown } | null)?.authorizationCode
  } catch {
    code = undefined
  }
  if (typeof code !== 'string' || code.length < 1 || code.length > MAX_CODE_LENGTH) return noStoreJson({ error: 'bad-request' }, 400)
  try {
    const account = await prisma.account.findFirst({
      where: { userId: ctx.user.id, providerId: 'apple' },
      select: { id: true, accountId: true },
    })
    const bundleId = process.env.APPLE_APP_BUNDLE_ID
    if (!account || !bundleId || !appleConfigured()) return noStoreJson({ error: 'not-found' }, 404)
    let exchanged: Awaited<ReturnType<typeof exchangeAppleCode>>
    try {
      exchanged = await exchangeAppleCode(code, bundleId)
    } catch (e) {
      console.error('[Auth] apple-token: scambio del codice non riuscito:', e instanceof Error ? e.message : 'errore')
      return noStoreJson({ error: 'apple' }, 502)
    }
    if (!exchanged.refreshToken) return noStoreJson({ error: 'apple' }, 502)
    if (subOf(exchanged.idToken) !== account.accountId) return noStoreJson({ error: 'apple-mismatch' }, 409)
    const encrypted = await setTokenUtil(exchanged.refreshToken, (await ctx.auth.$context) as unknown as Parameters<typeof setTokenUtil>[1])
    // Direttamente con Prisma: l'hook account.update.before azzererebbe un token scritto senza providerId.
    await prisma.account.update({ where: { id: account.id }, data: { refreshToken: encrypted } })
    return noStoreJson({ stored: true })
  } catch (e) {
    console.error('[Auth] apple-token:', e instanceof Error ? e.message : 'errore')
    return noStoreJson({ error: 'server' }, 500)
  }
}
