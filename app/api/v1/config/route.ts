import type { AppConfig, VersionStatus } from '@/lib/api-contract'

// Politica di versione per l'app (API-04). Pubblica: nessun dato personale, nessuna sessione,
// nessun database, e risponde anche con l'accesso spento, cosi' un'app vecchia scopre comunque di
// esserlo. NON e' un controllo di sicurezza: se la variabile manca o e' malformata non blocca
// nessuno (fail-open, D-06). Nessuna esenzione per la beta (D-07). L'ambiente si legge a ogni
// richiesta: cambiare .env e ricreare il container basta, senza una release.
export const dynamic = 'force-dynamic'

// Da 1 a 4 interi di 1-9 cifre: si confrontano come interi, niente float ne' overflow.
const VERSION_RE = /^\d{1,9}(\.\d{1,9}){0,3}$/

function parseVersion(s: string | null | undefined): number[] | null {
  if (!s || !VERSION_RE.test(s)) return null
  const parts = s.split('.').map(Number)
  while (parts.length < 4) parts.push(0)
  return parts
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  return 0
}

// Una sola riga di avviso per processo e per NOME di variabile, mai il valore.
const warned = new Set<string>()

function threshold(name: 'APP_MIN_VERSION' | 'APP_RECOMMENDED_VERSION'): string | null {
  const raw = process.env[name]
  if (!raw) return null
  if (parseVersion(raw)) return raw
  if (!warned.has(name)) {
    warned.add(name)
    console.warn(`[config] ${name} non e' una versione valida: ignorata, nessuno viene bloccato`)
  }
  return null
}

export function GET(req: Request): Response {
  const minimumVersion = threshold('APP_MIN_VERSION')
  const recommendedVersion = threshold('APP_RECOMMENDED_VERSION')
  const body: AppConfig = { minimumVersion, recommendedVersion }

  const version = parseVersion(new URL(req.url).searchParams.get('version'))
  if (version) {
    const below = (limit: string | null) => limit !== null && compareVersions(version, parseVersion(limit)!) < 0
    const status: VersionStatus = below(minimumVersion)
      ? 'update-required'
      : below(recommendedVersion)
        ? 'update-recommended'
        : 'ok'
    body.status = status
  }
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
