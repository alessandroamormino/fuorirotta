#!/usr/bin/env -S npx tsx
/**
 * Backfill idempotente events.region (Fase 15, D-03, checkpoint
 * `nullable-poi-backfill`).
 *
 * La colonna nasce nullable e senza DEFAULT: nessuna regione va inventata
 * per le righe esistenti (D-01, "lo stato si deriva dai dati, non si
 * dichiara" — scrivere una regione a caso su ogni riga contraddirebbe
 * esattamente questo). La regione si deriva da `events.source`, cercando in
 * `SOURCE_META` la entry il cui `id` coincide e leggendone `region` — lo
 * stesso registry che gia' dichiara quale regione appartiene a quale
 * sorgente, nessuna tabella di mappatura nuova.
 *
 * Scansiona SOLO le righe con `region IS NULL` (a differenza del backfill
 * territoriale, che rilegge tutta la tabella ad ogni corsa): qui non serve
 * ricalcolare una riga gia' popolata, la regione di una sorgente nota non
 * cambia mai. Questo e' anche cio' che rende il secondo lancio un no-op
 * osservabile: `updated` scende a 0 perche' `scanned` scende a 0, non
 * perche' ogni riga viene rivalutata e trovata invariata (D-16, batch size
 * derivato da PRISMA_BATCH_SIZE come lib/territorial/backfill.ts).
 *
 * Le righe il cui `source` non e' nel registry vengono CONTATE e riportate,
 * mai indovinate: il report distingue esplicitamente "non risolvibile" da
 * "gia' risolto", stesso principio del backfill territoriale (D-06 la').
 */
import { prisma } from '../lib/prisma'
import { SOURCE_META } from '../lib/scrapers/sources'
import { PRISMA_BATCH_SIZE } from '../lib/scrapers/connectionLimit'

export type RegionBackfillReport = {
  scanned: number
  updated: number
  unchanged: number
  byStep: {
    resolved: number
    unknown_source: number
  }
  // Sorgenti (events.source) assenti da SOURCE_META, con conteggio — mai
  // taciute, mai indovinate.
  unknownSources: Array<{ source: string; count: number }>
}

function resolveRegionForSource(source: string): string | undefined {
  return SOURCE_META.find((entry) => entry.id === source)?.region
}

export async function backfillRegion(): Promise<RegionBackfillReport> {
  const events = await prisma.event.findMany({
    where: { region: null },
    select: { id: true, source: true },
  })

  const report: RegionBackfillReport = {
    scanned: events.length,
    updated: 0,
    unchanged: 0,
    byStep: { resolved: 0, unknown_source: 0 },
    unknownSources: [],
  }

  const unknownCounts = new Map<string, number>()

  for (let i = 0; i < events.length; i += PRISMA_BATCH_SIZE) {
    const batch = events.slice(i, i + PRISMA_BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (event) => {
        const region = resolveRegionForSource(event.source)
        if (!region) {
          return { resolved: false as const, source: event.source }
        }
        await prisma.event.update({
          where: { id: event.id },
          data: { region },
        })
        return { resolved: true as const, source: event.source }
      })
    )

    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      const value = result.value
      if (value.resolved) {
        report.byStep.resolved++
        report.updated++
      } else {
        report.byStep.unknown_source++
        report.unchanged++
        unknownCounts.set(value.source, (unknownCounts.get(value.source) ?? 0) + 1)
      }
    }
  }

  report.unknownSources = [...unknownCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.source.localeCompare(b.source)))

  return report
}

async function main() {
  const report = await backfillRegion()
  console.log(
    `[BackfillRegion] ${report.updated} righe popolate, ${report.unchanged} invariate su ${report.scanned} scansionate (unknown_source: ${report.byStep.unknown_source}).`
  )
  if (report.unknownSources.length > 0) {
    console.log('[BackfillRegion] Sorgenti assenti da SOURCE_META, region non derivabile:')
    for (const { source, count } of report.unknownSources) {
      console.log(`  - ${source}: ${count} righe`)
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
