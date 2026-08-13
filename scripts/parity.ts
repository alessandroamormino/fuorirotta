#!/usr/bin/env npx tsx
/**
 * Prova di parità pre/post refactor (SRC-05, D-04, D-05).
 *
 * Esegue le quattro funzioni pure di parsing/trasformazione contro le fixture congelate
 * di `lib/scrapers/__fixtures__/` e:
 *   --capture  scrive l'output normalizzato in `baseline-cheerio.json` (il riferimento
 *              post-refactor, catturato dai parser cheerio dopo 08-03)
 *   --compare  riesegue le stesse funzioni contro le stesse fixture e confronta con
 *              `baseline-cheerio.json`; esce 1 e stampa il diff alla prima differenza
 *
 * Normalizzazione, IDENTICA sui due lati, limitata a due sole operazioni:
 *   1. decodifica delle entità HTML (libreria `he`, già in package.json)
 *   2. collasso degli spazi bianchi consecutivi in uno singolo, con trim
 * Nient'altro: qualunque normalizzazione ulteriore nasconderebbe proprio le differenze
 * che questo confronto esiste per trovare.
 *
 * `--fixtures-dir <path>` (solo in modalità --compare) sostituisce la directory da cui
 * leggere le QUATTRO fixture di input (non `baseline-cheerio.json`, sempre letto dal
 * percorso canonico): usato da `scripts/registry-parity.test.sh` per le due prove di
 * non-vacuità (D-05), che confrontano una fixture mutata contro la baseline reale.
 *
 * NOTA (08-03, risoluzione utente): `baseline.json` — il riferimento pre-refactor
 * catturato dal parser a regex in 08-01, bug incluso (1 evento/pagina invece di 10 per
 * solosagre) — NON viene più letto né scritto da questo script. Resta nel repo come
 * documentazione storica di cosa faceva davvero il parser a regex; il confronto vivo
 * usa `baseline-cheerio.json`. Vedi `lib/scrapers/__fixtures__/PARITY-DELTA.md` per il
 * report delle differenze dichiarate fra i due riferimenti.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import he from 'he'
import { parseSoloSagreHtml } from '../lib/scrapers/solosagre'
import { parseInLombardiaCards, parseInLombardiaDetail } from '../lib/scrapers/inlombardia'
import { transformOpenDataRecords } from '../lib/scrapers/opendata'

const CANONICAL_FIXTURES_DIR = join(__dirname, '..', 'lib', 'scrapers', '__fixtures__')
const BASELINE_PATH = join(CANONICAL_FIXTURES_DIR, 'baseline-cheerio.json')

// --- Normalizzazione, identica in capture e compare -------------------------------------

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return he.decode(value).replace(/\s+/g, ' ').trim()
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue)
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) {
      out[key] = normalizeValue(v)
    }
    return out
  }
  return value
}

// Ordinamento deterministico: per sourceId, poi per title. Necessario perché l'ordine
// di estrazione non è garantito stabile fra esecuzioni diverse del parser.
function sortEntries(entries: unknown[]): unknown[] {
  return [...entries].sort((a, b) => {
    const aRec = a as Record<string, unknown>
    const bRec = b as Record<string, unknown>
    const aId = String(aRec.sourceId ?? aRec.url ?? '')
    const bId = String(bRec.sourceId ?? bRec.url ?? '')
    if (aId !== bId) return aId < bId ? -1 : 1
    const aTitle = String(aRec.title ?? '')
    const bTitle = String(bRec.title ?? '')
    if (aTitle !== bTitle) return aTitle < bTitle ? -1 : 1
    return 0
  })
}

// --- Cattura contro le quattro funzioni pure ---------------------------------------------

function readFixture(fixturesDir: string, name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8')
}

function captureAll(fixturesDir: string): Record<string, unknown> {
  const solosagrePage1 = readFixture(fixturesDir, 'solosagre-page1.html')
  const inlombardiaList = readFixture(fixturesDir, 'inlombardia-list.html')
  const inlombardiaDetailHtml = readFixture(fixturesDir, 'inlombardia-detail.html')
  const opendataRaw = JSON.parse(readFixture(fixturesDir, 'opendata-response.json'))

  const solosagre = sortEntries(normalizeValue(parseSoloSagreHtml(solosagrePage1).events) as unknown[])
  const inlombardiaCards = sortEntries(normalizeValue(parseInLombardiaCards(inlombardiaList).events) as unknown[])
  const inlombardiaDetail = normalizeValue(parseInLombardiaDetail(inlombardiaDetailHtml).detail)
  const opendata = sortEntries(normalizeValue(transformOpenDataRecords(opendataRaw)) as unknown[])

  return { solosagre, inlombardiaCards, inlombardiaDetail, opendata }
}

// --- CLI -----------------------------------------------------------------------------------

function parseArgs(argv: string[]): { mode: 'capture' | 'compare'; fixturesDir: string } {
  const mode = argv[0] === '--capture' ? 'capture' : argv[0] === '--compare' ? 'compare' : null
  if (!mode) {
    console.error('Uso: tsx scripts/parity.ts --capture | --compare [--fixtures-dir <path>]')
    process.exit(2)
  }
  let fixturesDir = CANONICAL_FIXTURES_DIR
  const dirFlagIndex = argv.indexOf('--fixtures-dir')
  if (dirFlagIndex !== -1 && argv[dirFlagIndex + 1]) {
    fixturesDir = argv[dirFlagIndex + 1]
  }
  return { mode, fixturesDir }
}

function runCapture(fixturesDir: string): void {
  const captured = captureAll(fixturesDir)
  writeFileSync(BASELINE_PATH, JSON.stringify(captured, null, 2) + '\n')
  console.log(`baseline scritta in ${BASELINE_PATH}`)
  console.log(`  solosagre: ${(captured.solosagre as unknown[]).length} voci`)
  console.log(`  inlombardiaCards: ${(captured.inlombardiaCards as unknown[]).length} voci`)
  console.log(`  opendata: ${(captured.opendata as unknown[]).length} voci`)
}

function runCompare(fixturesDir: string): void {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`baseline-cheerio.json non trovata in ${BASELINE_PATH} — eseguire prima --capture`)
    process.exit(1)
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'))
  const current = captureAll(fixturesDir)

  const baselineJson = JSON.stringify(baseline, null, 2)
  const currentJson = JSON.stringify(current, null, 2)

  if (baselineJson === currentJson) {
    console.log('OK: output normalizzato identico alla baseline')
    return
  }

  const baselineLines = baselineJson.split('\n')
  const currentLines = currentJson.split('\n')
  const maxLines = Math.max(baselineLines.length, currentLines.length)
  let firstDiffLine = -1
  for (let i = 0; i < maxLines; i++) {
    if (baselineLines[i] !== currentLines[i]) {
      firstDiffLine = i
      break
    }
  }

  console.error('DIFF: output normalizzato diverso dalla baseline')
  console.error(`  prima differenza alla riga ${firstDiffLine + 1}:`)
  console.error(`    baseline: ${baselineLines[firstDiffLine] ?? '(assente)'}`)
  console.error(`    attuale:  ${currentLines[firstDiffLine] ?? '(assente)'}`)
  process.exit(1)
}

export function main(): void {
  const { mode, fixturesDir } = parseArgs(process.argv.slice(2))
  if (mode === 'capture') {
    runCapture(fixturesDir)
  } else {
    runCompare(fixturesDir)
  }
}

main()
