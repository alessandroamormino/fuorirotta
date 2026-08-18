#!/usr/bin/env -S npx tsx
/**
 * Seed/reimport della tabella `comuni` da un file CSV (TERR-01, TERR-05).
 *
 * `upsertComuni()` e' la funzione che 06-03 riusera' per il seed nazionale: il
 * parsing del formato di input e la scrittura restano separati apposta. La
 * scrittura e' un upsert su `istatCode` (D-02): un codice gia' presente
 * aggiorna la riga esistente, mai un secondo insert — cio' che preserva
 * `Event.comuneId` quando ISTAT rinomina un comune o lo riassegna (TERR-05).
 *
 * Regole di fallimento rumoroso (D-07 della Fase 8): file assente, illeggibile
 * o senza righe dati utili, oppure due righe con lo stesso `istat_code` nello
 * stesso file -> messaggio su stderr e uscita diversa da 0, **senza aver
 * toccato la tabella** (il parsing e' puro e precede ogni scrittura).
 *
 * Path del CSV: risolto e accettato solo se interno alla radice del
 * repository (T-06-02) — lo script e' eseguito manualmente da uno
 * sviluppatore, non esposto via API. Nessun percorso qui legge DATABASE_URL
 * dal file di ambiente locale (produzione, D-12/D-13): va invocato tramite
 * `bash scripts/dev-db.sh` (vedi `npm run seed:comuni`).
 */
import { readFileSync, existsSync, statSync } from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import type { Prisma } from '@prisma/client'

export type ComuneSeedRow = {
  istatCode: string
  name: string
  aliases: string[]
  provinceCode: string
  provinceName: string
  regionCode: string
  regionName: string
  latitude: number | null
  longitude: number | null
}

const EXPECTED_COLUMNS = [
  'istat_code',
  'name',
  'aliases',
  'province_code',
  'province_name',
  'region_code',
  'region_name',
  'latitude',
  'longitude',
]

const BATCH_SIZE = 5

function resolveCsvPath(rawPath: string): string {
  const repoRoot = path.resolve(__dirname, '..')
  const resolved = path.resolve(process.cwd(), rawPath)
  if (resolved !== repoRoot && !resolved.startsWith(repoRoot + path.sep)) {
    throw new Error(`percorso fuori dalla radice del repository: ${rawPath}`)
  }
  return resolved
}

function parseNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (Number.isNaN(value)) throw new Error(`valore numerico non valido: '${raw}'`)
  return value
}

/**
 * Parsing puro: nessuna scrittura, nessun accesso al database. Split su riga e
 * virgola (i nomi di comuni/province/regioni italiani non contengono virgole,
 * RESEARCH.md §Don't Hand-Roll); righe vuote e commenti (`#`) sono ignorati.
 */
export function parseCsv(text: string): ComuneSeedRow[] {
  const lines = text
    .split(/\r\n|\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))

  if (lines.length === 0) {
    throw new Error('il file non contiene nessuna riga (ne\' intestazione ne\' dati)')
  }

  const header = lines[0].split(',').map(col => col.trim())
  const missingColumns = EXPECTED_COLUMNS.filter(col => !header.includes(col))
  if (missingColumns.length > 0) {
    throw new Error(`intestazione CSV incompleta, colonne mancanti: ${missingColumns.join(', ')}`)
  }

  const dataLines = lines.slice(1)
  if (dataLines.length === 0) {
    throw new Error('il file non contiene nessuna riga dati utile (solo intestazione)')
  }

  const colIndex = (name: string) => header.indexOf(name)
  const rows: ComuneSeedRow[] = []
  const seenIstatCodes = new Set<string>()

  dataLines.forEach((line, i) => {
    const fields = line.split(',')
    if (fields.length !== header.length) {
      throw new Error(
        `riga ${i + 2}: numero di colonne (${fields.length}) diverso dall'intestazione (${header.length}): '${line}'`
      )
    }

    const istatCode = fields[colIndex('istat_code')].trim()
    if (istatCode === '') {
      throw new Error(`riga ${i + 2}: istat_code vuoto`)
    }
    if (seenIstatCodes.has(istatCode)) {
      // Esito deterministico, non dipendente dall'ordine di lettura: abort
      // rumoroso invece di lasciare che vinca l'ultima riga letta.
      throw new Error(`riga ${i + 2}: istat_code duplicato nello stesso file: '${istatCode}'`)
    }
    seenIstatCodes.add(istatCode)

    const aliasesRaw = fields[colIndex('aliases')].trim()
    const aliases = aliasesRaw === '' ? [] : aliasesRaw.split('|').map(a => a.trim()).filter(a => a !== '')

    rows.push({
      istatCode,
      name: fields[colIndex('name')].trim(),
      aliases,
      provinceCode: fields[colIndex('province_code')].trim(),
      provinceName: fields[colIndex('province_name')].trim(),
      regionCode: fields[colIndex('region_code')].trim(),
      regionName: fields[colIndex('region_name')].trim(),
      latitude: parseNumberOrNull(fields[colIndex('latitude')]),
      longitude: parseNumberOrNull(fields[colIndex('longitude')]),
    })
  })

  return rows
}

function decimalMatches(existing: Prisma.Decimal | null, value: number | null): boolean {
  if (existing === null && value === null) return true
  if (existing === null || value === null) return false
  return existing.toNumber() === value
}

export async function upsertComuni(
  rows: ComuneSeedRow[]
): Promise<{ inserted: number; updated: number; unchanged: number }> {
  let inserted = 0
  let updated = 0
  let unchanged = 0

  // Batch da 5 con Promise.allSettled: stesso vincolo di connection pool
  // (limite 9) documentato in lib/scrapers/utils.ts:163-165.
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async row => {
        const existing = await prisma.comune.findUnique({ where: { istatCode: row.istatCode } })
        const data = {
          name: row.name,
          aliases: row.aliases,
          provinceCode: row.provinceCode,
          provinceName: row.provinceName,
          regionCode: row.regionCode,
          regionName: row.regionName,
          latitude: row.latitude,
          longitude: row.longitude,
        }

        await prisma.comune.upsert({
          where: { istatCode: row.istatCode },
          create: { istatCode: row.istatCode, ...data },
          update: data,
        })

        if (!existing) return 'inserted' as const

        const isUnchanged =
          existing.name === row.name &&
          JSON.stringify(existing.aliases) === JSON.stringify(row.aliases) &&
          existing.provinceCode === row.provinceCode &&
          existing.provinceName === row.provinceName &&
          existing.regionCode === row.regionCode &&
          existing.regionName === row.regionName &&
          decimalMatches(existing.latitude, row.latitude) &&
          decimalMatches(existing.longitude, row.longitude)

        return isUnchanged ? ('unchanged' as const) : ('updated' as const)
      })
    )

    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      if (result.value === 'inserted') inserted++
      else if (result.value === 'updated') updated++
      else unchanged++
    }
  }

  return { inserted, updated, unchanged }
}

function parseArgs(argv: string[]): { csv: string } {
  const csvIndex = argv.indexOf('--csv')
  if (csvIndex === -1 || !argv[csvIndex + 1]) {
    throw new Error('uso: npx tsx scripts/seed-comuni.ts --csv <path>')
  }
  return { csv: argv[csvIndex + 1] }
}

async function main() {
  const { csv } = parseArgs(process.argv.slice(2))
  const resolvedPath = resolveCsvPath(csv)

  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`file non trovato: ${csv}`)
  }

  const text = readFileSync(resolvedPath, 'utf-8')
  const rows = parseCsv(text)

  console.log(`[SeedComuni] ${rows.length} righe da '${csv}'`)
  const report = await upsertComuni(rows)
  console.log(`[SeedComuni] inserted: ${report.inserted}, updated: ${report.updated}, unchanged: ${report.unchanged}`)
}

if (require.main === module) {
  main()
    .catch(err => {
      console.error(`[SeedComuni] ERRORE: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    })
    .finally(async () => {
      await prisma.$disconnect()
      process.exit(process.exitCode ?? 0)
    })
}
