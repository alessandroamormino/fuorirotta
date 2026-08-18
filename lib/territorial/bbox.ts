/**
 * Bounding box Italia e controllo di plausibilita' di una coordinata (D-11).
 *
 * Nessun import di Prisma: funzione pura, riceve lat/lng e restituisce un
 * booleano. La lettura dal database resta responsabilita' del chiamante.
 *
 * Il limite sud e' deliberatamente piu' basso del bounding box open source
 * piu' riutilizzato (gist "graydon/country-bounding-boxes", south = 36.62):
 * quel valore esclude Lampedusa (Punta Pesce Spada, punto piu' a sud
 * d'Italia, ~35.49 N) — un evento reale a Lampedusa verrebbe classificato
 * come implausibile e sostituito con un centroide, l'esatto contrario di
 * quello che D-11 chiede. Il limite nord copre Vetta d'Italia (~47.09 N,
 * confine alpino), con margine.
 */

export const ITALY_BOUNDS = {
  minLat: 35.2, // sotto Lampedusa (35.49) con margine
  maxLat: 47.15, // sopra Vetta d'Italia (47.09) con margine
  minLon: 6.6, // Sardegna occidentale / confine alpino ovest
  maxLon: 18.6, // Salento (Otranto/Santa Maria di Leuca, ~18.5) con margine
} as const

export function isPlausibleCoordinate(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  // 0,0 e' il valore sentinella di una coordinata mai popolata: va scartato
  // a prescindere dal bounding box (potrebbe cadere dentro per costruzione
  // di limiti larghi, ma non e' mai un punto reale in Italia).
  if (lat === 0 && lng === 0) return false
  return (
    lat >= ITALY_BOUNDS.minLat &&
    lat <= ITALY_BOUNDS.maxLat &&
    lng >= ITALY_BOUNDS.minLon &&
    lng <= ITALY_BOUNDS.maxLon
  )
}

// Self-check: `npx tsx lib/territorial/bbox.ts`.
// Non un framework di test, solo un demo() con assert che fallisce rumorosamente.
if (require.main === module) {
  console.assert(isPlausibleCoordinate(0, 0) === false, 'atteso false per 0,0 (sentinella)')
  console.assert(isPlausibleCoordinate(45.4642, 9.19) === true, 'atteso true per Milano')
  console.assert(
    isPlausibleCoordinate(35.5, 12.6) === true,
    'atteso true per Lampedusa (~35.5N) — il bounding box "standard" la escluderebbe'
  )
  console.assert(
    isPlausibleCoordinate(47.09, 12.2) === true,
    "atteso true per Vetta d'Italia (estremo nord)"
  )
  console.assert(isPlausibleCoordinate(51.5, -0.12) === false, 'atteso false per Londra (fuori bbox)')
  console.assert(isPlausibleCoordinate(NaN, 9.19) === false, 'atteso false con lat NaN')
  console.assert(isPlausibleCoordinate(45.4, Infinity) === false, 'atteso false con lng Infinity')

  console.log('[bbox.ts] self-check OK')
}
