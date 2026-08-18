#!/usr/bin/env -S npx tsx
/**
 * Seed/reimport della tabella `comuni` (TERR-01, TERR-02, TERR-05).
 *
 * Due formati di input:
 * - `--csv <path>` (06-01): un unico CSV con tutte le colonne, usato dal
 *   tracer e dal gate (`scripts/territorial-backfill.test.sh`, sezione
 *   TERR-05). Invariato in questo piano.
 * - `--istat <path.xlsx>` [+ `--coordinates <path.csv>`] [+ `--reconcile
 *   <path.csv>`] [+ `--dry-run`] (06-03): seed nazionale. L'anagrafica ISTAT
 *   e' la lista autoritativa delle righe; le coordinate sono un arricchimento
 *   opzionale che si unisce su `istat_code`; il reimport riconcilia le
 *   variazioni di codice (D-02) invece di duplicare righe.
 * - `--aliases <path.csv>` (06-03): aggiorna SOLO la colonna `aliases` dei
 *   comuni gia' presenti, senza toccare le altre colonne — cosi' un reimport
 *   `--istat` successivo non deve ripetere gli alias per non perderli.
 * - `--inspect <path.xlsx>`: stampa fogli/intestazione/prime righe di un file
 *   XLSX ed esce, senza toccare il database. Le colonne dei parser sotto sono
 *   state scritte SOLO dopo aver eseguito questo comando sui file reali
 *   (vedi 06-03-SUMMARY.md per l'output).
 *
 * Scrittura sempre in upsert su `istatCode` (D-02): un codice gia' presente
 * aggiorna la riga esistente, mai un secondo insert — cio' che preserva
 * `Event.comuneId` quando ISTAT rinomina un comune o lo riassegna (TERR-05).
 *
 * Regole di fallimento rumoroso (D-07 della Fase 8): file assente, illeggibile
 * o senza righe dati utili, oppure due righe con lo stesso `istat_code` nello
 * stesso file -> messaggio su stderr e uscita diversa da 0, **senza aver
 * toccato la tabella** (il parsing e' puro e precede ogni scrittura).
 *
 * Path dei file: risolto e accettato solo se interno alla radice del
 * repository (T-06-02/T-06-13) — lo script e' eseguito manualmente da uno
 * sviluppatore, non esposto via API. Nessun percorso qui legge DATABASE_URL
 * dal file di ambiente locale (produzione, D-12/D-13): va invocato tramite
 * `bash scripts/dev-db.sh` (vedi `npm run seed:comuni`).
 */
import { readFileSync, existsSync, statSync } from 'fs'
import path from 'path'
import { prisma } from '../lib/prisma'
import type { Prisma } from '@prisma/client'
import { normalizeComuneName } from '../lib/territorial/normalize'
import type ExcelJS from 'exceljs'

export type ComuneSeedRow = {
  istatCode: string
  name: string
  aliases?: string[] // undefined = non toccare in update (06-03), [] in create
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

function resolveRepoPath(rawPath: string): string {
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

function readTextLines(rawPath: string): string[] {
  const resolvedPath = resolveRepoPath(rawPath)
  if (!existsSync(resolvedPath) || !statSync(resolvedPath).isFile()) {
    throw new Error(`file non trovato: ${rawPath}`)
  }
  return readFileSync(resolvedPath, 'utf-8')
    .split(/\r\n|\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
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

function isUnchanged(existing: NonNullable<Awaited<ReturnType<typeof prisma.comune.findUnique>>>, row: ComuneSeedRow): boolean {
  const aliasesMatch = row.aliases === undefined || JSON.stringify(existing.aliases) === JSON.stringify(row.aliases)
  return (
    existing.name === row.name &&
    aliasesMatch &&
    existing.provinceCode === row.provinceCode &&
    existing.provinceName === row.provinceName &&
    existing.regionCode === row.regionCode &&
    existing.regionName === row.regionName &&
    decimalMatches(existing.latitude, row.latitude) &&
    decimalMatches(existing.longitude, row.longitude)
  )
}

type ComuneWriteData = {
  name: string
  provinceCode: string
  provinceName: string
  regionCode: string
  regionName: string
  latitude: number | null
  longitude: number | null
  aliases?: string[]
}

function buildWriteData(row: ComuneSeedRow): ComuneWriteData {
  const data: ComuneWriteData = {
    name: row.name,
    provinceCode: row.provinceCode,
    provinceName: row.provinceName,
    regionCode: row.regionCode,
    regionName: row.regionName,
    latitude: row.latitude,
    longitude: row.longitude,
  }
  if (row.aliases !== undefined) data.aliases = row.aliases
  return data
}

export type ReconcileMap = Map<string, string> // istat_code_old -> istat_code_new

type RowOutcome = 'inserted' | 'updated' | 'remapped' | 'unchanged'

/**
 * Riconciliazione (TERR-05, D-02): per ogni riga del seed corrente,
 * 1. se il codice esiste gia' -> UPDATE sulla riga esistente (o no-op se
 *    identica), PK surrogata invariata;
 * 2. altrimenti, se un `reconcileMap` e' fornito e mappa un codice VECCHIO su
 *    questo codice nuovo, e quel codice vecchio esiste ancora in tabella ->
 *    UPDATE che rimappa `istatCode` al valore nuovo (stessa riga, stesso
 *    `id`) — e' questo il passo che preserva `Event.comuneId` quando ISTAT
 *    riassegna un comune;
 * 3. altrimenti -> INSERT (comune genuinamente nuovo).
 * `dryRun`: percorre la stessa classificazione senza scrivere nulla.
 */
async function processRow(row: ComuneSeedRow, reconcileMap: ReconcileMap | null, dryRun: boolean): Promise<RowOutcome> {
  const data = buildWriteData(row)

  const direct = await prisma.comune.findUnique({ where: { istatCode: row.istatCode } })
  if (direct) {
    if (isUnchanged(direct, row)) return 'unchanged'
    if (!dryRun) await prisma.comune.update({ where: { istatCode: row.istatCode }, data })
    return 'updated'
  }

  if (reconcileMap) {
    for (const [oldCode, newCode] of reconcileMap) {
      if (newCode !== row.istatCode) continue
      const oldRow = await prisma.comune.findUnique({ where: { istatCode: oldCode } })
      if (oldRow) {
        if (!dryRun) {
          await prisma.comune.update({ where: { istatCode: oldCode }, data: { istatCode: row.istatCode, ...data } })
        }
        return 'remapped'
      }
    }
  }

  if (!dryRun) {
    await prisma.comune.create({ data: { istatCode: row.istatCode, ...data, aliases: row.aliases ?? [] } })
  }
  return 'inserted'
}

export async function upsertComuni(
  rows: ComuneSeedRow[],
  options: { reconcileMap?: ReconcileMap; dryRun?: boolean } = {}
): Promise<{ inserted: number; updated: number; remapped: number; unchanged: number }> {
  const { reconcileMap = null, dryRun = false } = options
  let inserted = 0
  let updated = 0
  let remapped = 0
  let unchanged = 0

  // Batch da 5 con Promise.allSettled: stesso vincolo di connection pool
  // (limite 9) documentato in lib/scrapers/utils.ts:163-165.
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(batch.map(row => processRow(row, reconcileMap, dryRun)))

    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      if (result.value === 'inserted') inserted++
      else if (result.value === 'updated') updated++
      else if (result.value === 'remapped') remapped++
      else unchanged++
    }
  }

  return { inserted, updated, remapped, unchanged }
}

// --- Parsing ISTAT/coordinate/alias/riconciliazione (06-03) ----------------------------------

export type IstatRow = {
  istatCode: string
  name: string
  provinceCode: string
  provinceName: string
  regionCode: string
  regionName: string
}

/**
 * `data/Elenco-comuni-italiani.xlsx` (ISTAT, CC BY 4.0). Colonne verificate
 * con `--inspect` (vedi 06-03-SUMMARY.md per l'output reale incollato):
 * A=Codice Regione, E=Codice Comune formato alfanumerico (istat_code),
 * G=Denominazione in italiano, K=Denominazione Regione, L=Denominazione
 * dell'Unita' territoriale sovracomunale (provincia), O=Sigla automobilistica
 * (province_code, es. 'MI' — stesso formato del fixture del tracer 06-01).
 * Nessun nome di colonna dedotto a memoria (RESEARCH.md Assumption A5).
 */
/**
 * Alcune celle del foglio ISTAT (es. "Valle d'Aosta/Vallée d'Aoste") usano
 * rich text con piu' porzioni in font diversi (il corsivo sul nome francese):
 * `.value` in quel caso non e' una stringa ma `{ richText: [{text}, ...] }`.
 * `String(...)` su quell'oggetto produrrebbe '[object Object]' — verificato
 * dal vivo sul database dopo il primo seed ('region_name' errato per la
 * Valle d'Aosta, corretto qui prima di ri-seminare (Rule 1)).
 */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object' && 'richText' in value) {
    return (value.richText as { text: string }[]).map(part => part.text).join('')
  }
  return String(value)
}

export async function parseIstatXlsx(rawPath: string): Promise<IstatRow[]> {
  const resolvedPath = resolveRepoPath(rawPath)
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(resolvedPath)
  const ws = wb.worksheets[0]
  if (!ws) throw new Error(`nessun foglio trovato in ${rawPath}`)

  const rows: IstatRow[] = []
  const seen = new Set<string>()
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const rawCode = row.getCell('E').value
    if (rawCode === null || rawCode === undefined || cellText(rawCode).trim() === '') continue

    // I fogli di calcolo trasformano '001001' in '1001': padStart difensivo
    // anche se in questo file la colonna e' gia' formattata come testo.
    const istatCode = cellText(rawCode).trim().padStart(6, '0')
    if (seen.has(istatCode)) {
      throw new Error(`${rawPath} riga ${r}: istat_code duplicato nel file sorgente: '${istatCode}'`)
    }
    seen.add(istatCode)

    rows.push({
      istatCode,
      name: cellText(row.getCell('G').value).trim(),
      regionCode: cellText(row.getCell('A').value).trim(),
      regionName: cellText(row.getCell('K').value).trim(),
      provinceName: cellText(row.getCell('L').value).trim(),
      provinceCode: cellText(row.getCell('O').value).trim(),
    })
  }
  if (rows.length === 0) throw new Error(`${rawPath}: nessuna riga dati trovata`)
  return rows
}

/** `data/coordinate-wikidata.csv` (Wikidata, CC0): istat_code,latitude,longitude. */
export function parseCoordinatesCsv(rawPath: string): Map<string, { latitude: number; longitude: number }> {
  const lines = readTextLines(rawPath)
  const header = lines[0].split(',').map(c => c.trim())
  const idx = (name: string) => header.indexOf(name)
  if (idx('istat_code') === -1 || idx('latitude') === -1 || idx('longitude') === -1) {
    throw new Error(`${rawPath}: intestazione attesa 'istat_code,latitude,longitude'`)
  }
  const map = new Map<string, { latitude: number; longitude: number }>()
  for (const line of lines.slice(1)) {
    const fields = line.split(',')
    const istatCode = fields[idx('istat_code')].trim()
    const latitude = Number(fields[idx('latitude')])
    const longitude = Number(fields[idx('longitude')])
    if (istatCode && !Number.isNaN(latitude) && !Number.isNaN(longitude)) {
      map.set(istatCode, { latitude, longitude })
    }
  }
  return map
}

/** `data/comuni-aliases.csv` (Wikidata, CC0): istat_code,alias — piu' righe per comune. */
export function parseAliasesCsv(rawPath: string): Map<string, string[]> {
  const lines = readTextLines(rawPath)
  const header = lines[0].split(',').map(c => c.trim())
  const idx = (name: string) => header.indexOf(name)
  if (idx('istat_code') === -1 || idx('alias') === -1) {
    throw new Error(`${rawPath}: intestazione attesa 'istat_code,alias'`)
  }
  const map = new Map<string, string[]>()
  for (const line of lines.slice(1)) {
    const fields = line.split(',')
    const istatCode = fields[idx('istat_code')].trim()
    const alias = fields[idx('alias')].trim()
    if (!istatCode || !alias) continue
    const bucket = map.get(istatCode)
    const key = normalizeComuneName(alias)
    if (bucket) {
      if (!bucket.some(a => normalizeComuneName(a) === key)) bucket.push(alias)
    } else {
      map.set(istatCode, [alias])
    }
  }
  return map
}

/**
 * File di riconciliazione (istat_code_old,istat_code_new). NON e' l'xlsx
 * ISTAT delle variazioni amministrative: quel file, ispezionato con
 * `--inspect` in questa sessione, si e' rivelato una tabella di statistiche
 * AGGREGATE per regione/tipologia/anno (conteggi), non un elenco riga-per-
 * riga di codici prima/dopo — vedi 06-03-SUMMARY.md per l'output reale e la
 * decisione presa. `--reconcile` accetta quindi un CSV a due colonne.
 */
export function parseReconcileCsv(rawPath: string): ReconcileMap {
  const lines = readTextLines(rawPath)
  const header = lines[0].split(',').map(c => c.trim())
  const idx = (name: string) => header.indexOf(name)
  if (idx('istat_code_old') === -1 || idx('istat_code_new') === -1) {
    throw new Error(`${rawPath}: intestazione attesa 'istat_code_old,istat_code_new'`)
  }
  const map: ReconcileMap = new Map()
  for (const line of lines.slice(1)) {
    const fields = line.split(',')
    const oldCode = fields[idx('istat_code_old')].trim()
    const newCode = fields[idx('istat_code_new')].trim()
    if (oldCode && newCode) map.set(oldCode, newCode)
  }
  return map
}

/**
 * Aggiorna SOLO la colonna `aliases` dei comuni presenti in tabella. Un
 * `istat_code` nel CSV assente in tabella e' un errore rumoroso (stampato su
 * stderr con il codice), non un abort silenzioso: il resto del file continua
 * a essere applicato.
 */
export async function applyAliases(aliasesByIstat: Map<string, string[]>): Promise<{ updated: number; missing: string[] }> {
  const entries = [...aliasesByIstat.entries()]
  let updated = 0
  const missing: string[] = []

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async ([istatCode, aliases]) => {
        const existing = await prisma.comune.findUnique({ where: { istatCode } })
        if (!existing) return { istatCode, found: false }
        await prisma.comune.update({ where: { istatCode }, data: { aliases } })
        return { istatCode, found: true }
      })
    )
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      if (result.value.found) updated++
      else missing.push(result.value.istatCode)
    }
  }

  for (const code of missing) {
    console.error(`[SeedComuni] ERRORE: alias per istat_code '${code}' ma nessun comune con quel codice in tabella`)
  }

  return { updated, missing }
}

/** `--inspect <path.xlsx>`: fogli, intestazione, prime 3 righe dati. Nessuna scrittura. */
export async function inspectXlsx(rawPath: string): Promise<void> {
  const resolvedPath = resolveRepoPath(rawPath)
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(resolvedPath)

  console.log(`\n=== ${rawPath} ===`)
  console.log(`Fogli: ${wb.worksheets.map(ws => `'${ws.name}' (${ws.rowCount} righe, ${ws.columnCount} colonne)`).join(', ')}`)

  const ws = wb.worksheets[0]
  console.log(`\n-- Primo foglio: '${ws.name}' --`)
  console.log('Intestazione (riga 1):', JSON.stringify(ws.getRow(1).values))
  for (let r = 2; r <= Math.min(4, ws.rowCount); r++) {
    console.log(`Riga dati ${r - 1}:`, JSON.stringify(ws.getRow(r).values))
  }
}

// --- CLI ---------------------------------------------------------------------------------------

type Args = {
  csv?: string
  istat?: string
  coordinates?: string
  aliases?: string
  reconcile?: string
  inspect?: string
  dryRun: boolean
}

function parseArgs(argv: string[]): Args {
  const valueOf = (flag: string) => {
    const i = argv.indexOf(flag)
    return i === -1 ? undefined : argv[i + 1]
  }
  return {
    csv: valueOf('--csv'),
    istat: valueOf('--istat'),
    coordinates: valueOf('--coordinates'),
    aliases: valueOf('--aliases'),
    reconcile: valueOf('--reconcile'),
    inspect: valueOf('--inspect'),
    dryRun: argv.includes('--dry-run'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.inspect) {
    await inspectXlsx(args.inspect)
    return
  }

  if (!args.csv && !args.istat && !args.aliases) {
    throw new Error(
      'uso: npx tsx scripts/seed-comuni.ts --csv <path> | --istat <path.xlsx> [--coordinates <path>] [--reconcile <path>] [--dry-run] | --aliases <path.csv> | --inspect <path.xlsx>'
    )
  }

  if (args.csv) {
    const text = readFileSync(resolveRepoPath(args.csv), 'utf-8')
    const rows = parseCsv(text)
    console.log(`[SeedComuni] ${rows.length} righe da '${args.csv}'`)
    const report = await upsertComuni(rows)
    console.log(
      `[SeedComuni] inserted: ${report.inserted}, updated: ${report.updated}, remapped: ${report.remapped}, unchanged: ${report.unchanged}`
    )
  }

  if (args.istat) {
    const istatRows = await parseIstatXlsx(args.istat)
    const coordinates = args.coordinates ? parseCoordinatesCsv(args.coordinates) : new Map<string, { latitude: number; longitude: number }>()
    const reconcileMap = args.reconcile ? parseReconcileCsv(args.reconcile) : undefined

    const rows: ComuneSeedRow[] = istatRows.map(r => {
      const coord = coordinates.get(r.istatCode)
      return {
        istatCode: r.istatCode,
        name: r.name,
        // aliases non toccati qui (undefined): un reimport dell'anagrafica
        // non deve cancellare gli alias seminati da --aliases.
        provinceCode: r.provinceCode,
        provinceName: r.provinceName,
        regionCode: r.regionCode,
        regionName: r.regionName,
        latitude: coord?.latitude ?? null,
        longitude: coord?.longitude ?? null,
      }
    })

    console.log(`[SeedComuni] ${rows.length} righe da '${args.istat}'${args.dryRun ? ' (dry-run)' : ''}`)
    const report = await upsertComuni(rows, { reconcileMap, dryRun: args.dryRun })
    console.log(
      `[SeedComuni] inserted: ${report.inserted}, updated: ${report.updated}, remapped: ${report.remapped}, unchanged: ${report.unchanged}`
    )

    const withoutCoordinate = rows.filter(r => r.latitude === null)
    console.log(`[SeedComuni] comuni senza coordinata: ${withoutCoordinate.length}/${rows.length}`)
    if (withoutCoordinate.length > 0) {
      console.log(`[SeedComuni] primi 20 senza coordinata: ${withoutCoordinate.slice(0, 20).map(r => r.name).join(', ')}`)
    }
  }

  if (args.aliases) {
    const aliasesByIstat = parseAliasesCsv(args.aliases)
    console.log(`[SeedComuni] alias per ${aliasesByIstat.size} comuni da '${args.aliases}'`)
    const report = await applyAliases(aliasesByIstat)
    console.log(`[SeedComuni] alias aggiornati: ${report.updated}, codici mancanti: ${report.missing.length}`)
  }
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
