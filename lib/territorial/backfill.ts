/**
 * Backfill idempotente locationName -> Comune per tutti gli eventi (D-08, D-09,
 * D-14).
 *
 * Legge l'anagrafica comuni una sola volta, costruisce l'indice di matching con
 * `buildComuneIndex()` e scorre tutti gli `Event` in batch da 5 (stesso vincolo
 * di connection pool documentato in `lib/scrapers/utils.ts:163-165`, limite 9).
 * Scrive solo dove il valore risolto differisce da quello gia' presente: una
 * `update()` incondizionata toccherebbe `Event.updatedAt` (`@updatedAt`) anche
 * a parita' di valori, e la seconda esecuzione non sarebbe piu' un no-op
 * osservabile. Il confronto delle coordinate avviene sulla rappresentazione
 * `Decimal` (`.toNumber()`), mai per identita' di oggetto.
 *
 * Il `data` della update contiene solo le quattro colonne territoriali:
 * `latitude`/`longitude` di sorgente non vengono mai lette in scrittura (D-14).
 */
import { prisma } from '../prisma'
import { buildComuneIndex, resolveComune, type ComuneRow, type MatchStep } from './resolve'
import { updateClusterCache } from '../clusterCache'
import type { Prisma } from '@prisma/client'

export type BackfillReport = {
  scanned: number
  updated: number
  unchanged: number
  byStep: Record<MatchStep, number>
  clusterFeatureCount: number
}

const BATCH_SIZE = 5

function toNumberOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber()
}

function decimalMatches(existing: Prisma.Decimal | null, resolved: number | null): boolean {
  if (existing === null && resolved === null) return true
  if (existing === null || resolved === null) return false
  return existing.toNumber() === resolved
}

export async function backfillEvents(): Promise<BackfillReport> {
  const comuni = await prisma.comune.findMany()
  const comuneRows: ComuneRow[] = comuni.map(c => ({
    id: c.id,
    istatCode: c.istatCode,
    name: c.name,
    aliases: c.aliases,
    provinceCode: c.provinceCode,
    provinceName: c.provinceName,
    regionCode: c.regionCode,
    regionName: c.regionName,
    latitude: toNumberOrNull(c.latitude),
    longitude: toNumberOrNull(c.longitude),
  }))
  const index = buildComuneIndex(comuneRows)

  const events = await prisma.event.findMany({
    select: {
      id: true,
      locationName: true,
      address: true,
      source: true,
      latitude: true,
      longitude: true,
      comuneId: true,
      resolvedLatitude: true,
      resolvedLongitude: true,
      coordinateSource: true,
    },
  })

  const report: BackfillReport = {
    scanned: events.length,
    updated: 0,
    unchanged: 0,
    byStep: { exact: 0, normalized: 0, unmatched: 0, no_input: 0 },
    clusterFeatureCount: 0,
  }

  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async event => {
        const resolved = resolveComune(
          {
            locationName: event.locationName,
            address: event.address,
            source: event.source,
            latitude: toNumberOrNull(event.latitude),
            longitude: toNumberOrNull(event.longitude),
          },
          index
        )

        const unchanged =
          event.comuneId === resolved.comuneId &&
          decimalMatches(event.resolvedLatitude, resolved.latitude) &&
          decimalMatches(event.resolvedLongitude, resolved.longitude) &&
          event.coordinateSource === resolved.coordinateSource

        if (!unchanged) {
          await prisma.event.update({
            where: { id: event.id },
            data: {
              comuneId: resolved.comuneId,
              resolvedLatitude: resolved.latitude,
              resolvedLongitude: resolved.longitude,
              coordinateSource: resolved.coordinateSource,
            },
          })
        }

        return { matchStep: resolved.matchStep, unchanged }
      })
    )

    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      report.byStep[result.value.matchStep]++
      if (result.value.unchanged) report.unchanged++
      else report.updated++
    }
  }

  // Senza ricalcolare qui, un evento appena materializzato al centroide resta
  // fuori dal GeoJSON fino al prossimo trigger naturale della cache: il piano
  // sembrerebbe fallito quando invece ha funzionato (Pitfall 4, RESEARCH.md).
  await updateClusterCache()
  const cache = await prisma.mapClusterCache.findUnique({ where: { id: 'default' } })
  report.clusterFeatureCount = cache?.eventCount ?? 0

  return report
}
