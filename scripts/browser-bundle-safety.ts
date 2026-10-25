#!/usr/bin/env -S npx tsx
/**
 * Cammina il grafo degli import a partire da ogni file 'use client' e segnala
 * i moduli raggiungibili che contengono un `require.main === module` NUDO.
 *
 * Perche' esiste: la homepage e' rimasta morta client-side ("Application error:
 * a client-side exception has occurred") perche' lib/scrapers/connectionLimit.ts
 * usava la forma nuda ed e' raggiungibile dal bundle del browser lungo la catena
 * app/HomeClient.tsx -> lib/categories/taxonomy.ts -> lib/scrapers/registry.ts
 * -> lib/scrapers/solosagre.ts -> lib/scrapers/utils.ts -> connectionLimit.ts.
 * Nel browser `module` non esiste: ReferenceError alla valutazione del modulo,
 * prima che la pagina renda una riga.
 *
 * Nessun altro gate del progetto poteva accorgersene, e non per distrazione:
 * `npm test`, `npx tsc --noEmit` e `npm run build` girano lato Node o sul type
 * system, dove `module` esiste eccome. Solo un browser vero vede l'errore.
 *
 * Perche' il grafo e non un grep su lib/: la forma nuda e' LEGITTIMA nei moduli
 * che girano solo sotto Node (lib/scrapers/health.ts, lib/territorial/bbox.ts,
 * lib/dedup/compose.ts e altri otto). Un divieto piatto su lib/ produrrebbe
 * dodici falsi positivi al primo colpo e verrebbe disattivato entro un giorno.
 * Cio' che conta e' la raggiungibilita' dal client, ed e' quella che si misura.
 *
 * La convenzione corretta, gia' in lib/eventStatus.ts e altri quattro file:
 *   if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module)
 *
 * Seconda regola (piano 21-06): nessun file 'use client' puo' raggiungere
 * SERVER_ONLY_MODULES (lib/auth.ts, lib/account.ts, lib/prisma.ts, lib/appleAuth.ts). Il gate si
 * dimostra capace di fallire a ogni esecuzione, con un'entrata sintetica.
 *
 * Exit: 0 pulito, 1 se un modulo raggiungibile dal client ha la forma nuda o se
 * un modulo solo-server entra nel grafo del client.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, dirname, resolve as resolvePath, relative } from 'path'

const ROOT = resolvePath(__dirname, '..')
const SCAN_DIRS = ['app', 'components', 'lib']
const EXTS = ['.ts', '.tsx', '.js', '.jsx']

// Moduli che non devono MAI entrare nel bundle del browser: portano la libreria
// di accesso, i segreti letti dall'ambiente e il pool del database. `server-only`
// non e' installato e gli script tsx importano lib/auth.ts, quindi il pacchetto
// non sarebbe comunque applicabile: questo controllo sul grafo lo sostituisce.
const SERVER_ONLY_MODULES = ['lib/auth.ts', 'lib/account.ts', 'lib/prisma.ts', 'lib/appleAuth.ts']

function walk(dir: string, out: string[] = []): string[] {
  const full = join(ROOT, dir)
  if (!existsSync(full)) return out
  for (const entry of readdirSync(full)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const p = join(full, entry)
    if (statSync(p).isDirectory()) walk(relative(ROOT, p), out)
    else if (EXTS.some((e) => entry.endsWith(e))) out.push(p)
  }
  return out
}

/** Risolve uno specifier verso un file reale; null se esterno (npm) o assente. */
function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolvePath(dirname(fromFile), specifier)
  else return null // pacchetto npm: non e' codice nostro

  for (const ext of ['', ...EXTS]) {
    const candidate = base + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  for (const ext of EXTS) {
    const candidate = join(base, 'index' + ext)
    if (existsSync(candidate)) return candidate
  }
  return null
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const specs: string[] = []
  for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1])
  return specs
}

/** `require.main === module` come CODICE, non citato dentro un commento. */
function hasBareSelfCheck(file: string): number | null {
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '')
    if (/^\s*(?:\}\s*else\s+)?if\s*\(/.test(code) && code.includes('require.main === module')) {
      if (!code.includes('typeof module')) return i + 1
    }
  }
  return null
}

// --- entry point: ogni file marcato 'use client' ----------------------------
const allFiles = SCAN_DIRS.flatMap((d) => walk(d))
const clientEntries = allFiles.filter((f) => {
  const head = readFileSync(f, 'utf8').slice(0, 200)
  return /^\s*['"]use client['"]/m.test(head)
})

if (clientEntries.length === 0) {
  console.error("FAIL: nessun file 'use client' trovato — il gate starebbe verificando il vuoto")
  process.exit(1)
}

// --- BFS sul grafo ----------------------------------------------------------
type Graph = { reachable: Set<string>; parent: Map<string, string> }

/** Cammina il grafo da `entries`; `edgesOf` restituisce i file (gia' risolti) importati da un file. */
function walkGraph(entries: string[], edgesOf: (file: string) => string[]): Graph {
  const reachable = new Set<string>(entries)
  const parent = new Map<string, string>()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.shift()!
    for (const target of edgesOf(file)) {
      if (reachable.has(target)) continue
      reachable.add(target)
      parent.set(target, file)
      queue.push(target)
    }
  }
  return { reachable, parent }
}

const realEdges = (file: string): string[] =>
  importsOf(file)
    .map((spec) => resolveImport(spec, file))
    .filter((target): target is string => target !== null)

const { reachable, parent } = walkGraph(clientEntries, realEdges)

// --- controllo --------------------------------------------------------------
const rel = (f: string) => relative(ROOT, f)

function chainOf(file: string, parents: Map<string, string>): string {
  const chain: string[] = []
  let cur: string | undefined = file
  while (cur) {
    chain.unshift(rel(cur))
    cur = parents.get(cur)
  }
  return chain.join(' -> ')
}

/** I moduli solo-server raggiungibili in `graph`, con la catena che li porta nel client. */
function serverOnlyHits(graph: Graph): { module: string; chain: string }[] {
  return SERVER_ONLY_MODULES.flatMap((m) => {
    const abs = join(ROOT, m)
    return graph.reachable.has(abs) ? [{ module: m, chain: chainOf(abs, graph.parent) }] : []
  })
}

for (const m of SERVER_ONLY_MODULES) {
  if (!existsSync(join(ROOT, m))) {
    console.error(`FAIL: ${m} non esiste: il controllo dei moduli solo-server starebbe verificando il vuoto`)
    process.exit(1)
  }
}

// Autoprova (non-vacuita'): un'entrata 'use client' SINTETICA, solo in memoria, che
// importa il modulo deve essere segnalata. Se l'attraversamento smettesse di
// seguire gli import, il gate passerebbe sull'albero vero senza dire nulla.
const SYNTHETIC = join(ROOT, 'app/__synthetic_client__.tsx')
for (const m of SERVER_ONLY_MODULES) {
  const graph = walkGraph([SYNTHETIC], (f) => (f === SYNTHETIC ? [join(ROOT, m)] : realEdges(f)))
  const hit = serverOnlyHits(graph).find((h) => h.module === m)
  if (!hit) {
    console.error(`FAIL: autoprova: un'entrata 'use client' sintetica che importa ${m} NON e' stata segnalata`)
    process.exit(1)
  }
  console.log(`ok  autoprova: un'entrata 'use client' sintetica che importa ${m} viene segnalata`)
}

const serverHits = serverOnlyHits({ reachable, parent })
if (serverHits.length > 0) {
  console.error(
    `FAIL: ${serverHits.length} modulo/i solo-server raggiungibile/i dal bundle client.\n` +
      `Portano la libreria di accesso, i segreti letti dall'ambiente e il pool del database: non devono mai entrare nel browser.\n`
  )
  for (const h of serverHits) console.error(`  ${h.module}\n    catena: ${h.chain}`)
  process.exit(1)
}

const offenders: { file: string; line: number }[] = []
for (const file of reachable) {
  const line = hasBareSelfCheck(file)
  if (line !== null) offenders.push({ file, line })
}

if (offenders.length > 0) {
  console.error(
    `FAIL: ${offenders.length} modulo/i raggiungibile/i dal bundle client con \`require.main === module\` nudo.\n` +
      `Nel browser \`module\` non esiste: ReferenceError alla valutazione del modulo, pagina bianca.\n`
  )
  for (const o of offenders) {
    console.error(`  ${rel(o.file)}:${o.line}`)
    console.error(`    catena: ${chainOf(o.file, parent)}`)
  }
  console.error(`\nUsa la forma completa, come in lib/eventStatus.ts:`)
  console.error(
    `  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module)`
  )
  process.exit(1)
}

console.log(
  `ok  ${clientEntries.length} entry 'use client', ${reachable.size} moduli raggiungibili, ` +
    `nessun require.main === module nudo, nessuno fra ${SERVER_ONLY_MODULES.join(', ')}`
)
console.log('PASS: sicurezza del bundle browser')
