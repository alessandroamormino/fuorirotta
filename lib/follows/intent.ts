// Intento di follow dell'ospite (Fase 23, D-01). Browser-safe. Un ospite che
// tocca "Segui" apre l'accesso; cosa voleva seguire resta SOLO in sessionStorage
// (per scheda), una volta sola, per 15 minuti. Nessun follow di un ospite sta
// mai sul dispositivo e niente parte verso il server prima dell'accesso.
import { isPlaceKind, isWellFormed, type PlaceKind } from './keys'
import { FOLLOW_INTENT_KEY } from './device'

export const INTENT_MAX_AGE_MS = 15 * 60 * 1000
export type FollowIntent = { kind: PlaceKind; key: string; chip: string; at: number }

/**
 * Il testo in sessionStorage non e' attendibile (la scheda lo puo' avere scritto
 * chiunque, o puo' essere vecchio): stessa porta del server. Solo luoghi (le
 * categorie non si seguono da una pagina, D-15), chiave ben formata, chip corto,
 * eta' fra 0 e 15 minuti. Qualunque altra cosa -> null.
 */
export function parseFollowIntent(raw: string | null, now: number): FollowIntent | null {
  if (raw === null) return null
  let o: unknown
  try {
    o = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof o !== 'object' || o === null) return null
  const { kind, key, chip, at } = o as Record<string, unknown>
  if (typeof kind !== 'string' || typeof key !== 'string' || typeof chip !== 'string' || typeof at !== 'number') return null
  if (!isPlaceKind(kind) || !isWellFormed(kind, key) || chip.length > 120) return null
  const age = now - at
  if (!(age >= 0 && age <= INTENT_MAX_AGE_MS)) return null
  return { kind, key, chip, at }
}

// sessionStorage in un try/catch: in navigazione privata puo' lanciare. Il tocco
// apre comunque l'accesso, si perde solo la ripetizione.
export function writeFollowIntent(intent: { kind: PlaceKind; key: string; chip: string }): void {
  try {
    sessionStorage.setItem(FOLLOW_INTENT_KEY, JSON.stringify({ ...intent, at: Date.now() }))
  } catch {}
}

/** Legge e TOGLIE sempre: un intento si usa una volta sola, anche se scaduto o guasto. */
export function takeFollowIntent(): FollowIntent | null {
  try {
    const raw = sessionStorage.getItem(FOLLOW_INTENT_KEY)
    sessionStorage.removeItem(FOLLOW_INTENT_KEY)
    return parseFollowIntent(raw, Date.now())
  } catch {
    return null
  }
}

export function clearFollowIntent(): void {
  try {
    sessionStorage.removeItem(FOLLOW_INTENT_KEY)
  } catch {}
}

// Self-check (check:follows, test:ci, quattro fusi orari). La guardia su `typeof`
// non e' cerimonia: il modulo e' raggiungibile da componenti "use client".
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failures = 0
  const check = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`  FAIL: ${msg}`)
      failures++
    }
  }
  const at = 1000
  const json = (o: Record<string, unknown>) => JSON.stringify(o)
  const good = { kind: 'region', key: 'lombardia', chip: 'Lombardia', at }
  const parsed = parseFollowIntent(json(good), at + 60_000)
  check(parsed !== null && parsed.kind === 'region' && parsed.key === 'lombardia' && parsed.chip === 'Lombardia' && parsed.at === at, 'un intento valido e recente deve essere restituito')
  check(parseFollowIntent(json(good), at + INTENT_MAX_AGE_MS) !== null, 'esattamente 15 minuti: ancora valido')
  check(parseFollowIntent(json(good), at + INTENT_MAX_AGE_MS + 1) === null, '15 minuti e 1 ms: scaduto')
  check(parseFollowIntent(json(good), at - 1) === null, 'un intento dal futuro deve essere scartato')
  check(parseFollowIntent(json({ ...good, kind: 'category', key: 'Altro' }), at) === null, 'kind category: mai da una pagina (D-15)')
  check(parseFollowIntent(json({ ...good, kind: 'hacker' }), at) === null, 'kind sconosciuto')
  check(parseFollowIntent(json({ ...good, key: 'atlantide' }), at) === null, 'regione fuori elenco')
  check(parseFollowIntent(json({ ...good, kind: 'comune', key: '12345' }), at) === null, 'comune con ISTAT di 5 cifre')
  check(parseFollowIntent(json({ ...good, kind: 'comune', key: '016024', chip: 'Bergamo (BG)' }), at) !== null, 'comune ben formato')
  check(parseFollowIntent(json({ ...good, chip: 'x'.repeat(121) }), at) === null, 'chip oltre 120 caratteri')
  check(parseFollowIntent(json({ ...good, chip: 'x'.repeat(120) }), at) !== null, 'chip di 120 caratteri: accettato')
  check(parseFollowIntent(json({ ...good, chip: 42 }), at) === null, 'chip non stringa')
  check(parseFollowIntent(json({ ...good, at: '1000' }), at) === null, 'at non numero')
  check(parseFollowIntent('non json', at) === null, 'non JSON')
  check(parseFollowIntent('null', at) === null, 'JSON null')
  check(parseFollowIntent(null, at) === null, 'null')
  if (failures > 0) {
    console.error(`self-check FAILED: ${failures}`)
    process.exit(1)
  }
  console.log('self-check OK')
}
