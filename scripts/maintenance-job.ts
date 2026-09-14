#!/usr/bin/env -S npx tsx
/**
 * Job di manutenzione consolidato (D-05, D-06, D-07): aggancio territoriale,
 * deduplica e cache dei cluster in un solo passaggio giornaliero, invece che
 * in coda a ogni scrape per regione — a venti regioni la coda per-scrape
 * moltiplicherebbe per venti la stessa passata whole-table (SCHED-02).
 *
 * Ordine backfill -> dedup, parte del contratto (spostato qui invariato da
 * lib/scrapers/runner.ts): il match della Fase 10 usa comuneId, ed e' il
 * backfill ad assegnarlo — invertire l'ordine classificherebbe ogni riga
 * come no_geo.
 *
 * L'errore di backfill o dedup propaga (D-15 Fase 6, D-03 Fase 10): quando
 * quelle chiamate partono gli eventi sono gia' persistiti, quindi propagare
 * non perde nulla, mentre inghiottire l'errore ricreerebbe l'accumulo
 * silenzioso che quelle decisioni esistono per impedire.
 *
 * D-06: la garanzia "una regressione del matching si vede subito" (Fasi 6 e
 * 10, oggi in coda a ogni scrape) non e' abbandonata spostando questa coda
 * fuori dal percorso di scrape — e' SOSTITUITA da una riga scrape_runs
 * (source='maintenance') letta da /api/monitoring, e da un secondo dead
 * man's switch esterno (HEALTHCHECK_MAINTENANCE_URL, scripts/cron-maintenance.sh).
 *
 * D-07 — updateClusterCache() NON viene richiamato qui una terza volta:
 * backfillEvents() e dedupeEvents() lo richiamano gia' ciascuno al proprio
 * termine (lib/territorial/backfill.ts, lib/dedup/dedupe.ts) e dedupeEvents()
 * gira per ultimo, quindi l'ultimo ricalcolo osservato e' gia' quello
 * successivo al dedup — l'invariante "la cache e' l'ultimo passo" e' gia'
 * soddisfatta strutturalmente. Una chiamata esplicita qui sarebbe un terzo
 * ricalcolo whole-table ridondante sugli stessi ~2.700 eventi, contro lo
 * spirito di SCHED-02 (una passata al giorno, non moltiplicata) che questo
 * job esiste per rispettare.
 *
 * Nessun percorso qui legge DATABASE_URL dal file di ambiente locale
 * (produzione): va invocato tramite `bash scripts/dev-db.sh`
 * (vedi `npm run maintenance:local`) oppure dentro il container via
 * scripts/cron-maintenance.sh.
 */
import { backfillEvents } from '../lib/territorial/backfill'
import { dedupeEvents } from '../lib/dedup/dedupe'
import { truncateError } from '../lib/scrapers/health'
import { prisma } from '../lib/prisma'

async function runMaintenance(): Promise<{ eventCount: number }> {
  const backfillReport = await backfillEvents()
  console.log(
    `[Maintenance] Backfill territoriale: ${backfillReport.updated} agganciati/aggiornati, ${backfillReport.unchanged} invariati su ${backfillReport.scanned} eventi (no_input: ${backfillReport.byStep.no_input}).`
  )

  const dedupReport = await dedupeEvents()
  console.log(
    `[Maintenance] Dedup: ${dedupReport.groups} gruppi, ${dedupReport.merged} righe fuse, ${dedupReport.updated} scritture, ${dedupReport.unchanged} invariate su ${dedupReport.scanned} eventi (noGeo: ${dedupReport.noGeo}).`
  )

  // Conferma del ricalcolo della cache dei cluster: dedupeEvents() lo ha gia'
  // eseguito al proprio termine (ultimo passo, D-07), qui si riporta solo il
  // conteggio gia' scritto — nessuna chiamata aggiuntiva a updateClusterCache().
  console.log(
    `[Maintenance] Cache dei cluster ricalcolata in coda al dedup (ultimo passo, D-07): ${dedupReport.clusterFeatureCount} feature nel GeoJSON.`
  )

  return { eventCount: dedupReport.scanned }
}

async function main() {
  const startedAt = new Date()
  let eventCount = 0
  let errorMessage: string | null = null

  try {
    const result = await runMaintenance()
    eventCount = result.eventCount
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[Maintenance] Job fallito: ${errorMessage}`)
  }

  const durationMs = Date.now() - startedAt.getTime()

  // Storico scrape_runs (SRC-07): scritto in try/catch come recordScrapeRuns
  // in lib/scrapers/runner.ts — un fallimento nello storico non deve
  // impedire la propagazione dell'errore del job (vedi sotto).
  try {
    await prisma.scrapeRun.create({
      data: {
        source: 'maintenance',
        region: 'all',
        startedAt,
        durationMs,
        eventCount,
        error: truncateError(errorMessage)
      }
    })
  } catch (recordError) {
    console.error('[Maintenance] Failed to record maintenance run history:', recordError)
  }

  // L'errore del job va comunque propagato al processo: e' cio' che fa
  // fallire scripts/cron-maintenance.sh e quindi impedisce il ping del
  // secondo dead man's switch (D-06). La riga scrape_runs con l'errore e'
  // gia' stata scritta sopra, comunque.
  if (errorMessage) {
    process.exitCode = 1
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
