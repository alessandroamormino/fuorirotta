#!/usr/bin/env -S npx tsx
/**
 * CLI sottile sopra `dedupeEvents()`. Nessuna logica di matching qui dentro:
 * `dedupeEvents()` resta l'unica implementazione al mondo della cascata di
 * deduplica.
 *
 * Nessun percorso qui legge DATABASE_URL dal file di ambiente locale
 * (produzione): va invocato tramite `bash scripts/dev-db.sh`
 * (vedi `npm run dedup:events`).
 */
import { dedupeEvents } from '../lib/dedup/dedupe'
import { prisma } from '../lib/prisma'

async function main() {
  const report = await dedupeEvents()
  console.log(`[Dedup] scanned: ${report.scanned}`)
  console.log(`[Dedup] buckets: ${report.buckets} (skipped: ${report.bucketsSkipped})`)
  console.log(`[Dedup] pairsEvaluated: ${report.pairsEvaluated}`)
  console.log(`[Dedup] groups: ${report.groups}`)
  console.log(`[Dedup] merged: ${report.merged}`)
  console.log(`[Dedup] updated: ${report.updated}`)
  console.log(`[Dedup] unchanged: ${report.unchanged}`)
  console.log(`[Dedup] noGeo: ${report.noGeo}`)
  console.log(`[Dedup] byReason: ${JSON.stringify(report.byReason)}`)
  console.log(`[Dedup] clusterFeatureCount: ${report.clusterFeatureCount}`)
}

main()
  .catch(err => {
    console.error(`[Dedup] passo di dedup fallito: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
