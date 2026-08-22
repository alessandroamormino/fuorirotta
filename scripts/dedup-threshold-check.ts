#!/usr/bin/env -S npx tsx
/**
 * Verificatore della fixture etichettata (scripts/dedup-fixtures.ts) contro
 * `matchPair()` (lib/dedup/dedupe.ts). Per ogni coppia costruisce i due
 * `MatchInput` direttamente dai campi letterali della fixture — MAI
 * interrogando il database per id: gli id della fixture sono puramente
 * informativi e differiscono fra l'ambiente locale e produzione.
 *
 * Due modalità:
 * - default: stampa una riga per ogni disallineamento (label, esito atteso,
 *   esito ottenuto, score, reason), poi il totale; esce 1 se c'è almeno un
 *   disallineamento, 0 altrimenti. È la sezione S3 di scripts/dedup.test.sh.
 * - `--report`: non giudica, stampa la tabella completa ordinata per score
 *   decrescente (label, expected, score, reason) — la modalità che il Task 2
 *   di 10-03 usa per tarare TITLE_SIMILARITY_THRESHOLD misurando invece di
 *   stimare a tavolino. Esce sempre 0.
 *
 * Nessun percorso qui legge DATABASE_URL dal file di ambiente locale
 * (produzione): matchPair() interroga similarity() via Prisma, quindi va
 * invocato tramite `bash scripts/dev-db.sh` (vedi scripts/backfill-events.ts).
 */
import { DEDUP_FIXTURES, DedupFixtureRow } from './dedup-fixtures'
import { matchPair, MatchInput } from '../lib/dedup/dedupe'
import { prisma } from '../lib/prisma'

function toMatchInput(row: DedupFixtureRow): MatchInput {
  return {
    id: row.eventId,
    title: row.title,
    comuneId: row.comuneId,
    dateStart: new Date(row.dateStart),
  }
}

type Row = {
  label: string
  expected: 'merge' | 'no_merge'
  got: 'merge' | 'no_merge'
  score: number | null
  reason: string
}

async function main() {
  const reportMode = process.argv.includes('--report')
  const rows: Row[] = []

  for (const pair of DEDUP_FIXTURES) {
    const verdict = await matchPair(toMatchInput(pair.a), toMatchInput(pair.b))
    rows.push({
      label: pair.label,
      expected: pair.expected,
      got: verdict.merge ? 'merge' : 'no_merge',
      score: verdict.score,
      reason: verdict.reason,
    })
  }

  if (reportMode) {
    const sorted = [...rows].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
    console.log('label\texpected\tscore\treason')
    for (const r of sorted) {
      console.log(`${r.label}\t${r.expected}\t${r.score !== null ? r.score.toFixed(4) : '-'}\t${r.reason}`)
    }
    return
  }

  const mismatches = rows.filter(r => r.got !== r.expected)
  for (const m of mismatches) {
    console.log(
      `MISMATCH: ${m.label} expected=${m.expected} got=${m.got} score=${m.score !== null ? m.score.toFixed(4) : '-'} reason=${m.reason}`
    )
  }
  console.log(`[DedupThresholdCheck] ${mismatches.length}/${rows.length} disallineamenti`)
  if (mismatches.length > 0) process.exitCode = 1
}

main()
  .catch(err => {
    console.error(`[DedupThresholdCheck] fallito: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
    process.exit(process.exitCode ?? 0)
  })
