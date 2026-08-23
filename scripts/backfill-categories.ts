#!/usr/bin/env -S npx tsx
/**
 * Backfill di `canonicalCategory` su OGNI riga della tabella `events`
 * (deliberatamente SENZA il filtro `canonicalEventId: null` che gli altri
 * backfill usano): il valore memorizzato su una riga membro e' un valore
 * reale che l'asserzione "ogni evento" di CAT-01 copre, e lasciarla al
 * default del database renderebbe falsa l'asserzione sull'intera tabella.
 *
 * Idempotente: l'UPDATE parte solo quando il valore calcolato differisce da
 * quello memorizzato. Batch concorrenti piccoli, come saveEvents() e
 * backfillEvents(): un Promise.all sull'intera tabella satura il pool di
 * connessioni Prisma (limite 9, P2024).
 *
 * Nessun percorso qui legge DATABASE_URL dal file di ambiente locale
 * (produzione): va invocato tramite `bash scripts/dev-db.sh` (vedi
 * `npm run backfill:categories`).
 */
import { prisma } from '../lib/prisma'
import { canonicalizeCategory } from '../lib/categories/taxonomy'
import { updateClusterCache } from '../lib/clusterCache'

const BATCH_SIZE = 5 // stesso vincolo di connection pool documentato in lib/scrapers/utils.ts (limite 9)

async function main() {
  const rows = await prisma.event.findMany({
    select: { id: true, source: true, category: true, canonicalCategory: true }
  })

  let scanned = 0
  let updated = 0
  let unchanged = 0

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    const results = await Promise.allSettled(
      batch.map(async (row) => {
        const computed = canonicalizeCategory(row.source, row.category)
        if (computed === row.canonicalCategory) {
          return false
        }
        await prisma.event.update({
          where: { id: row.id },
          data: { canonicalCategory: computed }
        })
        return true
      })
    )

    for (const result of results) {
      scanned++
      if (result.status === 'rejected') throw result.reason
      if (result.value) updated++
      else unchanged++
    }
  }

  // Senza questa chiamata la cache dei cluster della mappa continua a servire
  // i pin costruiti prima che la tassonomia esistesse per fino a 4 ore dopo
  // che il database e' gia' corretto (stesso Pitfall gia' documentato per il
  // backfill territoriale e per dedup-events).
  await updateClusterCache()

  console.log(`[Categories] scanned: ${scanned} updated: ${updated} unchanged: ${unchanged}`)
}

main()
  .catch(err => {
    console.error(`[Categories] backfill fallito: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
