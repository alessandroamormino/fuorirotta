import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SOURCE_REGISTRY } from '@/lib/scrapers/registry'
import { computeSourceHealth, HEALTH_WINDOW_SIZE, type RunRecord, type SourceHealth } from '@/lib/scrapers/health'

/**
 * GET /api/monitoring (MON-01)
 *
 * Payload JSON pubblico, non autenticato (D-11): stato operativo delle sorgenti di
 * scraping, pensato per un monitor esterno, nessuna superficie HTML (D-09).
 * Sempre dinamica: e' uno stato operativo, non deve mai essere servita da cache statica.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sources = await Promise.all(
      SOURCE_REGISTRY.map(async (entry): Promise<SourceHealth | null> => {
        const runs = await prisma.scrapeRun.findMany({
          where: { source: entry.id, region: entry.region },
          orderBy: { startedAt: 'desc' },
          take: HEALTH_WINDOW_SIZE + 1
        })

        // Coppie senza alcuna esecuzione registrata sono omesse dall'array, non 404.
        if (runs.length === 0) return null

        const runRecords: RunRecord[] = runs.map(run => ({
          startedAt: run.startedAt,
          eventCount: run.eventCount,
          durationMs: run.durationMs,
          error: run.error
        }))

        return computeSourceHealth(entry.id, entry.region, runRecords)
      })
    )

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      sources: sources.filter((source): source is SourceHealth => source !== null)
    })
  } catch (error) {
    // Il messaggio dell'eccezione resta solo nei log: puo' contenere l'URL di connessione
    // al database, e questa rotta e' pubblica e non autenticata.
    console.error('[Monitoring]', error)
    return NextResponse.json(
      {
        error: 'Impossibile leggere lo storico degli scrape.',
        checkedAt: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}
