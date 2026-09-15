#!/usr/bin/env -S npx tsx
/**
 * Gate: gli script che girano sul CHECKOUT HOST non devono raggiungere
 * dipendenze che richiedono un Node piu' recente di quello dell'host.
 *
 * Perche' esiste: il 2026-09-15, durante il deploy della fase 14,
 * `npx tsx scripts/generate-crontab.ts` e' morto sull'host con
 * `ReferenceError: File is not defined`. L'host gira Node 18.19.1; l'immagine
 * Docker gira node:20-alpine. `cheerio` tira `undici@7`, che usa il global
 * `File`, aggiunto a Node in v20. La catena era
 *   generate-crontab.ts -> registry.ts -> solosagre.ts -> cheerio -> undici
 * e la stessa catena passava per scripts/maintenance-job.ts
 * (-> territorial/backfill.ts -> territorial/resolve.ts -> registry.ts -> ...),
 * cioe' il job di manutenzione notturno in produzione: non sarebbe mai partito,
 * ogni notte, con il solo sintomo di un dead man's switch non pingato.
 *
 * Perche' nessun gate lo vedeva: `npm test` e `npx tsc --noEmit` girano sulla
 * macchina di sviluppo, che ha un Node moderno. La differenza di ambiente era
 * invisibile per costruzione — esattamente come l'errore nel bundle browser
 * che ha ucciso la homepage nella stessa fase.
 *
 * Cosa NON fa: non installa Node 18 e non esegue nulla. Dimostra staticamente
 * che nessuno degli script elencati raggiunge un pacchetto proibito, il che e'
 * verificabile su qualunque versione di Node.
 *
 * Exit: 0 pulito, 1 se uno script host raggiunge un pacchetto proibito.
 */
import { readFileSync, existsSync, statSync } from 'fs'
import { join, dirname, resolve as resolvePath, relative } from 'path'

const ROOT = resolvePath(__dirname, '..')
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs']

/**
 * Script invocati sul checkout host, non dentro l'immagine. La regola del
 * progetto e' "gli script di manutenzione stanno fuori dall'immagine"
 * (DEPLOYMENT.md §Migrations e §"Automated Scraping via Crontab"), quindi
 * girano col Node dell'host.
 */
const HOST_SCRIPTS = ['scripts/generate-crontab.ts']

/**
 * Script che girano DENTRO node:20-alpine col checkout montato
 * (scripts/cron-maintenance.sh, e la procedura per n1-proof in DEPLOYMENT.md).
 * Elencati qui per documentazione e per il controllo di completezza sotto: NON
 * sono soggetti ai vincoli di HOST_SCRIPTS, perche' nel container il Node e' 20
 * e l'engine Prisma sul disco (musl) e' quello giusto.
 */
const CONTAINER_SCRIPTS = ['scripts/maintenance-job.ts', 'scripts/n1-proof.ts']

/**
 * Pacchetti che richiedono Node >= 20 e non possono comparire nella chiusura
 * degli import di uno script host. `cheerio` e' elencato accanto a `undici`
 * perche' e' la porta d'ingresso reale: nessuno importa undici direttamente.
 */
const FORBIDDEN = ['undici', 'cheerio']

/**
 * Prisma e' proibito negli script host per una ragione diversa dalla versione
 * di Node, scoperta sull'host il 2026-09-15: node_modules/.prisma/client
 * contiene il query engine per linux-musl-openssl-3.0.x, generato dentro
 * l'immagine (node:20-alpine). L'host e' Debian, e un import di Prisma li'
 * fallisce con "could not locate the Query Engine for runtime
 * debian-openssl-3.0.x". Non e' risolvibile aggiornando Node: e' la libc.
 * Chi tocca il database gira nel container, punto.
 */
const FORBIDDEN_ON_HOST_MODULES = ['lib/prisma.ts']

function resolveImport(specifier: string, fromFile: string): { file?: string; pkg?: string } | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(ROOT, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolvePath(dirname(fromFile), specifier)
  else return { pkg: specifier }

  for (const ext of ['', ...EXTS]) {
    const candidate = base + ext
    if (existsSync(candidate) && statSync(candidate).isFile()) return { file: candidate }
  }
  for (const ext of EXTS) {
    const candidate = join(base, 'index' + ext)
    if (existsSync(candidate)) return { file: candidate }
  }
  return null
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const specs: string[] = []
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g)) {
    specs.push(m[1])
  }
  for (const m of src.matchAll(/import\s+\*\s+as\s+\w+\s+from\s+['"]([^'"]+)['"]/g)) {
    specs.push(m[1])
  }
  return specs
}

const rel = (f: string) => (f.startsWith(ROOT) ? f.slice(ROOT.length + 1) : f)

/** Cammino piu' corto dall'entry al pacchetto proibito, o null. */
function pathToForbidden(entry: string): string[] | null {
  const seen = new Set([entry])
  const queue: [string, string[]][] = [[entry, [entry]]]
  while (queue.length) {
    const [file, path] = queue.shift()!
    for (const spec of importsOf(file)) {
      const r = resolveImport(spec, file)
      if (!r) continue
      if (r.pkg) {
        const hit = FORBIDDEN.find((p) => r.pkg === p || r.pkg!.startsWith(p + '/'))
        if (hit) return [...path.map(rel), r.pkg]
        continue
      }
      if (seen.has(r.file!)) continue
      seen.add(r.file!)
      queue.push([r.file!, [...path, r.file!]])
    }
  }
  return null
}

let failed = false

/** Cammino piu' corto dall'entry a un modulo interno proibito, o null. */
function pathToForbiddenModule(entry: string): string[] | null {
  const seen = new Set([entry])
  const queue: [string, string[]][] = [[entry, [entry]]]
  while (queue.length) {
    const [file, path] = queue.shift()!
    for (const spec of importsOf(file)) {
      const r = resolveImport(spec, file)
      if (!r || r.pkg) continue
      const relPath = rel(r.file!)
      if (FORBIDDEN_ON_HOST_MODULES.includes(relPath)) return [...path.map(rel), relPath]
      if (seen.has(r.file!)) continue
      seen.add(r.file!)
      queue.push([r.file!, [...path, r.file!]])
    }
  }
  return null
}

for (const script of [...HOST_SCRIPTS, ...CONTAINER_SCRIPTS]) {
  if (!existsSync(join(ROOT, script))) {
    console.error(`FAIL: ${script} non esiste — gli elenchi in questo gate sono fuori sincrono col repo`)
    failed = true
  }
}

for (const script of HOST_SCRIPTS) {
  const entry = join(ROOT, script)
  if (!existsSync(entry)) continue
  const pkgChain = pathToForbidden(entry)
  const modChain = pathToForbiddenModule(entry)
  if (pkgChain) {
    console.error(`FAIL: ${script} gira sull'host e raggiunge un pacchetto che richiede Node >= 20`)
    console.error(`  catena: ${pkgChain.join(' -> ')}`)
    failed = true
  }
  if (modChain) {
    console.error(`FAIL: ${script} gira sull'host e raggiunge Prisma (engine musl sul disco, host Debian)`)
    console.error(`  catena: ${modChain.join(' -> ')}`)
    failed = true
  }
  if (!pkgChain && !modChain) console.log(`ok  ${script} (host)`)
}

for (const script of CONTAINER_SCRIPTS) {
  console.log(`ok  ${script} (container node:20-alpine — nessun vincolo)`)
}

if (failed) {
  console.error('')
  console.error("L'host gira Node 18.19.1 e Debian; l'immagine e' node:20-alpine e l'engine")
  console.error('Prisma sul disco e\' musl. Due vie d\'uscita:')
  console.error('  - se lo script legge solo METADATI: importa lib/scrapers/sources.ts, che non')
  console.error('    tira dentro ne\' scraper ne\' Prisma;')
  console.error('  - se lo script tocca il DATABASE: spostalo in CONTAINER_SCRIPTS e invocalo')
  console.error('    dentro node:20-alpine col checkout montato, come scripts/cron-maintenance.sh.')
  process.exit(1)
}

console.log(
  `PASS: ${HOST_SCRIPTS.length} script host puliti, ${CONTAINER_SCRIPTS.length} nel container`
)
