import { authEnabled } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildUserFeed, FEED_FILE, feedNotFound } from '@/lib/saved/feed'

// Il feed del calendario (CAL-03): URL pubblico che e' una capability, il token
// e' l'unica credenziale. Non legge cookie ne' header (T-22-24): ogni ramo che
// non sia un feed vivo risponde feedNotFound(), identica byte per byte.
export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  try {
    if (!authEnabled()) return feedNotFound()
    const { file } = await params
    if (!FEED_FILE.test(file)) return feedNotFound()
    const feed = await prisma.calendarFeed.findUnique({ where: { token: file.slice(0, -'.ics'.length) } })
    if (!feed) return feedNotFound()
    const body = await buildUserFeed(feed.userId, new Date())
    return new Response(body, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'cache-control': 'private, no-cache',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex',
      },
    })
  } catch {
    // Niente dettagli e niente log con il token nell'URL.
    return new Response('Errore interno\n', { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
}
