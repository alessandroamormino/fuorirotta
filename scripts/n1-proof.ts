#!/usr/bin/env -S npx tsx
/**
 * Prova a N=1 (D-14, D-15, SCHED-03): lettura in SOLA LETTURA di `scrape_runs`
 * su una finestra temporale, per dire se lo schedule scaglionato su UNA sola
 * regione e' partito quando doveva, se si e' mai sovrapposto a se stesso, e
 * se il connection pool si e' saturato (sintomo: errori P2024, gia'
 * documentato in `lib/scrapers/utils.ts`).
 *
 * D-14 dice "nessuno strumento nuovo": questo script non aggiunge storage,
 * non aggiunge un endpoint, non aggiunge una dashboard — legge le righe che
 * gia' esistono in `scrape_runs`. Esiste solo perche' la stessa query non
 * venga ribattuta a mano ogni volta.
 *
 * Nessuna scrittura: nessuna chiamata a create/update/upsert/delete.
 *
 * Uso: bash scripts/dev-db.sh npx tsx scripts/n1-proof.ts [--hours N]
 * (in produzione, sull'host, SENZA scripts/dev-db.sh — vedi SUMMARY per il
 * comando esatto: quella esecuzione la fa l'utente, non un agente).
 */
import { prisma } from '../lib/prisma'

type Run = {
  source: string
  region: string
  startedAt: Date
  durationMs: number
  eventCount: number
  error: string | null
}

function parseHoursArg(argv: string[]): number {
  const idx = argv.indexOf('--hours')
  if (idx === -1) return 24
  const raw = argv[idx + 1]
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 24
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Coppie di run della STESSA regione i cui intervalli [startedAt, startedAt +
 * durationMs] si intersecano. Confrontate solo righe con `startedAt` DIVERSO:
 * runRegion() scrive una riga per sorgente per invocazione, tutte con lo
 * STESSO `startedAt` (un solo `new Date()` condiviso, lib/scrapers/runner.ts)
 * — sorgenti diverse della stessa regione che partono in parallelo dentro
 * un'unica invocazione (host diversi, D-02) sono comportamento corretto, non
 * una sovrapposizione fra due run distinti. Solo run con `startedAt` diverso
 * possono rappresentare due invocazioni realmente separate.
 */
function findOverlaps(runs: Run[]): Array<{ a: Run; b: Run }> {
  const overlaps: Array<{ a: Run; b: Run }> = []
  const byRegion = new Map<string, Run[]>()
  for (const run of runs) {
    const list = byRegion.get(run.region)
    if (list) list.push(run)
    else byRegion.set(run.region, [run])
  }

  for (const regionRuns of byRegion.values()) {
    for (let i = 0; i < regionRuns.length; i++) {
      for (let j = i + 1; j < regionRuns.length; j++) {
        const a = regionRuns[i]
        const b = regionRuns[j]
        if (a.startedAt.getTime() === b.startedAt.getTime()) continue
        const aStart = a.startedAt.getTime()
        const aEnd = aStart + a.durationMs
        const bStart = b.startedAt.getTime()
        const bEnd = bStart + b.durationMs
        if (aStart < bEnd && bStart < aEnd) {
          overlaps.push({ a, b })
        }
      }
    }
  }
  return overlaps
}

async function main() {
  const hours = parseHoursArg(process.argv.slice(2))
  const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000)

  console.log(`[N1] Finestra: ultime ${hours}h (dal ${windowStart.toISOString()})`)

  const runs = await prisma.scrapeRun.findMany({
    where: { startedAt: { gte: windowStart } },
    orderBy: { startedAt: 'asc' },
    select: { source: true, region: true, startedAt: true, durationMs: true, eventCount: true, error: true },
  })

  if (runs.length === 0) {
    console.log(`[N1] AVVISO: nessuna riga scrape_runs nella finestra delle ultime ${hours}h.`)
    console.log('[N1] Un verdetto verde su zero righe sarebbe vacuo: nessuna prova, non un successo.')
    console.log('[N1] LIMITE DICHIARATO (D-15): la CPU non e\' stata misurata in questa fase. Il criterio di successo 3 della Fase 14 e\' coperto SOLO per la parte connection pool.')
    process.exitCode = 2
    return
  }

  console.log(`[N1] ${runs.length} righe nella finestra:`)
  for (const run of runs) {
    console.log(
      `[N1]   ${run.startedAt.toISOString()}  source=${run.source.padEnd(20)} region=${run.region.padEnd(10)} duration=${formatMs(run.durationMs).padStart(8)} events=${String(run.eventCount).padStart(5)} error=${run.error ?? '-'}`
    )
  }

  const byRegion = new Map<string, Run[]>()
  for (const run of runs) {
    const list = byRegion.get(run.region)
    if (list) list.push(run)
    else byRegion.set(run.region, [run])
  }

  console.log('[N1] Per regione:')
  for (const [region, regionRuns] of byRegion) {
    const durations = regionRuns.map((r) => r.durationMs)
    const sortedByStart = [...regionRuns].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    const gaps: number[] = []
    for (let i = 1; i < sortedByStart.length; i++) {
      const gap = sortedByStart[i].startedAt.getTime() - sortedByStart[i - 1].startedAt.getTime()
      if (gap > 0) gaps.push(gap)
    }
    console.log(
      `[N1]   ${region}: run=${regionRuns.length} durata min=${formatMs(Math.min(...durations))} max=${formatMs(Math.max(...durations))} mediana=${formatMs(median(durations))}`
    )
    if (gaps.length > 0) {
      console.log(
        `[N1]     intervallo fra un run e il successivo: min=${formatMs(Math.min(...gaps))} max=${formatMs(Math.max(...gaps))}`
      )
    } else {
      console.log('[N1]     un solo istante di partenza osservato in finestra, nessun intervallo calcolabile')
    }
  }

  // Sintomo esatto della saturazione del pool, gia' documentato in
  // lib/scrapers/utils.ts (D-15).
  const p2024Runs = runs.filter((r) => r.error?.includes('P2024'))
  console.log(`[N1] Errori P2024 (saturazione del connection pool): ${p2024Runs.length}`)
  for (const run of p2024Runs) {
    console.log(`[N1]   P2024: ${run.startedAt.toISOString()} source=${run.source} region=${run.region}`)
  }

  const overlaps = findOverlaps(runs)
  console.log(`[N1] Sovrapposizioni (run della stessa regione con intervalli che si intersecano): ${overlaps.length}`)
  for (const { a, b } of overlaps) {
    console.log(
      `[N1]   sovrapposizione regione=${a.region}: [${a.startedAt.toISOString()} +${formatMs(a.durationMs)}] (${a.source}) vs [${b.startedAt.toISOString()} +${formatMs(b.durationMs)}] (${b.source})`
    )
  }

  console.log(
    "[N1] LIMITE DICHIARATO (D-15): la CPU non e' stata misurata in questa fase, per scelta esplicita. Il criterio di successo 3 della Fase 14 (\"nessuna saturazione del pool ne' picchi di CPU\") e' coperto QUI SOLO per la parte connection pool (conteggio P2024)."
  )

  process.exitCode = p2024Runs.length > 0 || overlaps.length > 0 ? 1 : 0
}

main()
  .catch((err) => {
    console.error(`[N1] prova a N=1 fallita: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
