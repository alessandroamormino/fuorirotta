// Digital Asset Links per Android (D-15): una lista di dichiarazioni valida ma vuota finche' Android
// e' fuori ambito. Le dichiarazioni vere (package_name, sha256_cert_fingerprints) arrivano con un'app Android.
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json([])
}
