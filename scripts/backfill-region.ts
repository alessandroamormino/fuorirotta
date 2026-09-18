#!/usr/bin/env -S npx tsx
/**
 * Backfill idempotente events.region (Fase 15, D-03, checkpoint
 * `nullable-poi-backfill`).
 *
 * La colonna nasce nullable e senza DEFAULT: nessuna regione va inventata
 * per le righe esistenti (D-01, "lo stato si deriva dai dati, non si
 * dichiara" — scrivere una regione a caso su ogni riga contraddirebbe
 * esattamente questo). La regione si deriva PRIMA da `events.source`,
 * cercando in `SOURCE_META` la entry il cui `id` coincide (nessuna tabella
 * di mappatura nuova) — SOLO quando quell'`id` identifica una regione unica.
 *
 * CR-01 (Fase 15 review): dopo SRC-04, `id: 'solosagre'` e' condiviso da 20
 * entry (una per regione), quindi non identifica piu' una regione unica da
 * solo. Per quelle righe si prova una seconda fonte, mai un'invenzione: il
 * comune gia' agganciato alla riga (`comuneId`, popolato dal backfill
 * territoriale — lib/territorial/backfill.ts). Se nemmeno quello c'e', la
 * riga resta con `region NULL` e viene CONTATA e riportata, non indovinata:
 * il report distingue "source assente dal registry" da "source ambiguo e
 * nessun comune da cui derivare", stesso principio del backfill territoriale
 * (D-06 la').
 *
 * Scansiona SOLO le righe con `region IS NULL` (a differenza del backfill
 * territoriale, che rilegge tutta la tabella ad ogni corsa): qui non serve
 * ricalcolare una riga gia' popolata, la regione di una sorgente nota non
 * cambia mai. Questo e' anche cio' che rende il secondo lancio un no-op
 * osservabile: `updated` scende a 0 perche' `scanned` scende a 0, non
 * perche' ogni riga viene rivalutata e trovata invariata (D-16, batch size
 * derivato da PRISMA_BATCH_SIZE come lib/territorial/backfill.ts).
 */
import { prisma } from '../lib/prisma'
import { SOURCE_META } from '../lib/scrapers/sources'
import { istatRegionToSlug } from '../lib/scrapers/regionSlug'
import { PRISMA_BATCH_SIZE } from '../lib/scrapers/connectionLimit'

export type UnresolvedReason = 'unknown_source' | 'ambiguous_source_no_comune'

export type RegionBackfillReport = {
  scanned: number
  updated: number
  unchanged: number
  byStep: {
    resolved: number
    resolved_via_comune: number
    unresolved: number
  }
  // Righe non risolte, con conteggio — mai taciute, mai indovinate. Le due
  // cause NON vengono mai sommate insieme (D-16, stesso principio del
  // backfill territoriale): 'unknown_source' e' un `source` assente da
  // SOURCE_META, 'ambiguous_source_no_comune' e' un `source` condiviso da
  // piu' regioni (es. 'solosagre') su una riga senza `comuneId` da cui
  // derivare la regione.
  unresolved: Array<{ source: string; reason: UnresolvedReason; count: number }>
}

/** True se `source` e' dichiarato in SOURCE_META da PIU' di una entry (CR-01). */
function isAmbiguousSource(source: string): boolean {
  return SOURCE_META.filter((entry) => entry.id === source).length > 1
}

/**
 * Regione per source, SOLO quando quell'id identifica una regione unica.
 * Zero match (source sconosciuto) o piu' di un match (source ambiguo, es.
 * 'solosagre' dopo SRC-04) tornano entrambi `undefined`: nessuna delle due
 * situazioni ha una risposta valida dal solo `source` (CR-01).
 */
function resolveRegionForSource(source: string): string | undefined {
  const matches = SOURCE_META.filter((entry) => entry.id === source)
  return matches.length === 1 ? matches[0].region : undefined
}

export async function backfillRegion(): Promise<RegionBackfillReport> {
  const events = await prisma.event.findMany({
    where: { region: null },
    select: { id: true, source: true, comuneId: true },
  })

  const report: RegionBackfillReport = {
    scanned: events.length,
    updated: 0,
    unchanged: 0,
    byStep: { resolved: 0, resolved_via_comune: 0, unresolved: 0 },
    unresolved: [],
  }

  // Comuni coinvolti dalle righe a source ambiguo, risolti in UN solo
  // findMany (mai una query per riga dentro il ciclo sotto — stesso
  // principio di saveEvents in lib/scrapers/utils.ts).
  const ambiguousComuneIds = Array.from(
    new Set(
      events
        .filter((event) => event.comuneId !== null && isAmbiguousSource(event.source))
        .map((event) => event.comuneId as number)
    )
  )
  const regionSlugByComuneId = new Map<number, string>()
  if (ambiguousComuneIds.length > 0) {
    const comuni = await prisma.comune.findMany({
      where: { id: { in: ambiguousComuneIds } },
      select: { id: true, regionName: true },
    })
    for (const comune of comuni) {
      regionSlugByComuneId.set(comune.id, istatRegionToSlug(comune.regionName))
    }
  }

  const unresolvedCounts = new Map<string, { source: string; reason: UnresolvedReason; count: number }>()

  for (let i = 0; i < events.length; i += PRISMA_BATCH_SIZE) {
    const batch = events.slice(i, i + PRISMA_BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (event) => {
        const direct = resolveRegionForSource(event.source)
        if (direct) {
          await prisma.event.update({ where: { id: event.id }, data: { region: direct } })
          return { outcome: 'resolved' as const }
        }

        if (isAmbiguousSource(event.source)) {
          const viaComune = event.comuneId ? regionSlugByComuneId.get(event.comuneId) : undefined
          if (viaComune) {
            await prisma.event.update({ where: { id: event.id }, data: { region: viaComune } })
            return { outcome: 'resolved_via_comune' as const }
          }
          return {
            outcome: 'unresolved' as const,
            source: event.source,
            reason: 'ambiguous_source_no_comune' as const,
          }
        }

        return { outcome: 'unresolved' as const, source: event.source, reason: 'unknown_source' as const }
      })
    )

    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      const value = result.value
      if (value.outcome === 'resolved') {
        report.byStep.resolved++
        report.updated++
      } else if (value.outcome === 'resolved_via_comune') {
        report.byStep.resolved_via_comune++
        report.updated++
      } else {
        report.byStep.unresolved++
        report.unchanged++
        const key = `${value.source}|${value.reason}`
        const existing = unresolvedCounts.get(key)
        if (existing) existing.count++
        else unresolvedCounts.set(key, { source: value.source, reason: value.reason, count: 1 })
      }
    }
  }

  report.unresolved = [...unresolvedCounts.values()].sort((a, b) =>
    b.count !== a.count ? b.count - a.count : a.source.localeCompare(b.source)
  )

  return report
}

async function main() {
  const report = await backfillRegion()
  console.log(
    `[BackfillRegion] ${report.updated} righe popolate (${report.byStep.resolved} da source, ${report.byStep.resolved_via_comune} da comune), ${report.unchanged} invariate su ${report.scanned} scansionate (unresolved: ${report.byStep.unresolved}).`
  )
  if (report.unresolved.length > 0) {
    console.log('[BackfillRegion] Righe con region non derivabile:')
    for (const { source, reason, count } of report.unresolved) {
      console.log(`  - ${source} (${reason}): ${count} righe`)
    }
  }
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[BackfillRegion] Fallito:', error)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
    })
}
