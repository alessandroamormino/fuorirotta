import { getAuth } from '@/lib/auth'
import { googleProfileImage } from '@/lib/profileImage'

// Stato dell'utente per le isole client, dopo l'idratazione: le pagine
// pubbliche non leggono mai cookie ne' header (ACCT-05), quindi chi vuole
// sapere "chi sono" lo chiede qui. Mai in cache condivisa.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function GET(req: Request): Promise<Response> {
  const auth = getAuth()
  if (!auth) {
    return Response.json({ enabled: false, user: null }, { headers: NO_STORE })
  }
  const { headers, response: session } = await auth.api.getSession({
    headers: req.headers,
    returnHeaders: true,
  })
  const res = Response.json(
    { enabled: true, user: session
        ? { name: session.user.name, email: session.user.email, image: googleProfileImage(session.user.image) }
        : null },
    { headers: NO_STORE },
  )
  // Rinnovo a scorrimento (D-04): getSession allunga la riga nel database, ma
  // il cookie nuovo arriva al browser solo se lo inoltriamo noi (Pitfall 6).
  for (const cookie of headers.getSetCookie()) res.headers.append('Set-Cookie', cookie)
  return res
}
