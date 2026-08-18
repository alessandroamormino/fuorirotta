/**
 * Distanza fra due punti in chilometri (formula haversine).
 *
 * Stessa formula e stesso raggio terrestre (6371 km) gia' presenti in
 * `app/api/events/route.ts:326-347` (`calculateDistance()`/`toRad()`), spostati
 * qui perche' ora servono a due chiamanti: il filtro raggio dell'API e la
 * disambiguazione degli omonimi (D-07). Non e' una formula diversa, e' la
 * stessa funzione condivisa — il piano 06-04 rimuovera' la copia da
 * `app/api/events/route.ts` e la fara' importare da qui.
 *
 * Nessun import di Prisma: funzione pura.
 */

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371 // Raggio Terra in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// Self-check: `npx tsx lib/territorial/distance.ts`.
// Non un framework di test, solo un demo() con assert che fallisce rumorosamente.
if (require.main === module) {
  console.assert(
    calculateDistanceKm(45.4642, 9.19, 45.4642, 9.19) === 0,
    'atteso 0 per due punti identici'
  )

  // Milano -> Bergamo: distanza nota, circa 40-50 km in linea d'aria.
  const milanoBergamo = calculateDistanceKm(45.4642, 9.19, 45.6983, 9.6773)
  console.assert(
    milanoBergamo > 30 && milanoBergamo < 60,
    `atteso Milano-Bergamo fra 30 e 60 km, ottenuto ${milanoBergamo}`
  )

  console.log('[distance.ts] self-check OK')
}
