// Forma delle risposte pubbliche (check:api-golden, check:mobile-contract).
//
// Il contratto che l'app e il web leggono e' "quali campi ci sono e di che tipo",
// mai i valori (titoli, id, conteggi e date cambiano con i dati). shapeOf riduce
// un JSON a { percorso -> tipi osservati }; compareShapes dice cosa e' sparito
// rispetto al golden. Una AGGIUNTA (un percorso o un tipo in piu') e' compatibile
// e passa; un percorso rimosso o un tipo perso e' una violazione.
//
// Percorsi: '$' la radice, '$.events' una chiave, '$.events[]' gli elementi di un
// array, quindi '$.events[].title'. Un array vuoto non produce il percorso '[]':
// un golden con elementi contro una risposta vuota cade (e' la direzione giusta).
//
// CLI (usata da scripts/api-golden.test.sh, mai a mano salvo per registrare):
//   npx tsx scripts/golden-shape.ts compare <nome> <file-corpo> <stato> <content-type> [location]
//   npx tsx scripts/golden-shape.ts record  <nome> <file-corpo> <stato> <content-type> [location]
// I golden stanno in scripts/__fixtures__/api-golden/<nome>.golden.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Shape = Record<string, string[]>

function typeOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value // 'object' | 'string' | 'number' | 'boolean'
}

export function shapeOf(json: unknown): Shape {
  const seen: Record<string, Set<string>> = {}
  const walk = (value: unknown, path: string): void => {
    ;(seen[path] ??= new Set()).add(typeOf(value))
    if (Array.isArray(value)) {
      for (const item of value) walk(item, `${path}[]`)
    } else if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`)
    }
  }
  walk(json, '$')
  const out: Shape = {}
  for (const path of Object.keys(seen).sort()) out[path] = [...seen[path]].sort()
  return out
}

export function compareShapes(golden: Shape, actual: Shape): string[] {
  const violations: string[] = []
  for (const [path, types] of Object.entries(golden)) {
    const now = actual[path]
    if (!now) {
      violations.push(`percorso rimosso: ${path}`)
      continue
    }
    for (const type of types) {
      if (!now.includes(type)) violations.push(`tipo perso: ${path} (${type})`)
    }
  }
  return violations
}

type GoldenFile = {
  request: string
  status: number
  contentType: string
  location?: string
  shape: Shape
}

const GOLDEN_DIR = join(__dirname, '__fixtures__', 'api-golden')

// Le cifre del Location diventano <id> e l'origine salta: l'id cambia a ogni giro.
function normalizeLocation(raw: string): string {
  let path = raw
  try {
    path = new URL(raw, 'http://x.invalid').pathname
  } catch {
    // Location illeggibile: resta cosi' com'e', il confronto cadra'.
  }
  return path.replace(/\d+/g, '<id>')
}

function observe(bodyFile: string, status: string, contentType: string, location: string | undefined) {
  const text = readFileSync(bodyFile, 'utf8')
  let shape: Shape
  try {
    shape = shapeOf(JSON.parse(text))
  } catch {
    shape = { $: ['<non-json>'] }
  }
  return {
    status: Number(status),
    contentType: contentType.split(';')[0].trim().toLowerCase(),
    ...(location ? { location: normalizeLocation(location) } : {}),
    shape,
  }
}

function cli(argv: string[]): void {
  const [mode, name, bodyFile, status, contentType, location] = argv
  if ((mode !== 'compare' && mode !== 'record') || !name || !bodyFile || !status || contentType === undefined) {
    console.error('uso: golden-shape.ts compare|record <nome> <file-corpo> <stato> <content-type> [location]')
    process.exit(2)
  }
  const file = join(GOLDEN_DIR, `${name}.golden.json`)
  const seen = observe(bodyFile, status, contentType, location)

  if (mode === 'record') {
    mkdirSync(GOLDEN_DIR, { recursive: true })
    const golden: GoldenFile = { request: process.env.GOLDEN_REQUEST ?? name, ...seen }
    writeFileSync(file, `${JSON.stringify(golden, null, 2)}\n`)
    console.log(`registrato ${name} (${Object.keys(seen.shape).length} percorsi)`)
    return
  }

  if (!existsSync(file)) {
    console.log(`FAIL: ${name}: golden mancante (registra con GOLDEN_UPDATE=1)`)
    process.exit(1)
  }
  const golden = JSON.parse(readFileSync(file, 'utf8')) as GoldenFile
  const violations: string[] = []
  if (golden.status !== seen.status) violations.push(`stato cambiato: atteso ${golden.status}, ottenuto ${seen.status}`)
  if (golden.contentType !== seen.contentType) {
    violations.push(`content-type cambiato: atteso ${golden.contentType}, ottenuto ${seen.contentType}`)
  }
  if (golden.location !== undefined && golden.location !== ('location' in seen ? seen.location : undefined)) {
    violations.push(`location cambiata: atteso ${golden.location}, ottenuto ${'location' in seen ? seen.location : '(assente)'}`)
  }
  violations.push(...compareShapes(golden.shape, seen.shape))
  if (violations.length > 0) {
    for (const v of violations) console.log(`FAIL: ${name}: ${v}`)
    process.exit(1)
  }
  console.log(`ok  ${name}`)
}

// Guardia a tre condizioni (lib/pagination.ts): il modulo e' importato anche da
// scripts/mobile-contract.test.ts, dove non deve partire la CLI.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  cli(process.argv.slice(2))
}
