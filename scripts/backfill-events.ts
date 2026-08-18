#!/usr/bin/env -S npx tsx
/**
 * CLI sottile sopra `backfillEvents()`. Nessuna logica di matching qui dentro:
 * `backfillEvents()` resta l'unica implementazione al mondo della cascata, ed
 * e' questa unicita' la ragione per cui D-15 potra' agganciarla al runner
 * (06-05) senza duplicare niente.
 *
 * Nessun percorso qui legge DATABASE_URL dal file di ambiente locale
 * (produzione, D-12/D-13): va invocato tramite `bash scripts/dev-db.sh`
 * (vedi `npm run backfill:territorial`).
 */
import { backfillEvents } from '../lib/territorial/backfill'
import { prisma } from '../lib/prisma'

async function main() {
  const report = await backfillEvents()
  console.log(`[Territorial] scanned: ${report.scanned}`)
  console.log(`[Territorial] updated: ${report.updated}`)
  console.log(`[Territorial] unchanged: ${report.unchanged}`)
  console.log(`[Territorial] byStep: ${JSON.stringify(report.byStep)}`)
  console.log(`[Territorial] clusterFeatureCount: ${report.clusterFeatureCount}`)
}

main()
  .catch(err => {
    console.error(`[Territorial] backfill fallito: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
