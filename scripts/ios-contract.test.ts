// check:ios-contract (test:ci). Nessun database, nessun Swift: legge ApiContract.swift e i file di
// ios/ come testo, quindi gira uguale su Linux in CI.
//
// S1 la copia Swift del contratto e' uguale a lib/api-contract.ts; S2 il gate sa fallire;
// S3 la build Release non puo' portarsi dietro le regole di rete locale (D-10, T-27-01).
//
// Esce con 1 al primo controllo fallito. Stampa "ok  <ID>: ..." per ognuno.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APNS_ENVIRONMENTS, APNS_TOKEN_RE, APP_USER_AGENT_RE, DEVICE_CAP, FEATURES, PLAN, UNIVERSAL_LINK_PATHS,
} from '../lib/api-contract'
import { CANONICAL_CATEGORIES } from '../lib/categories/taxonomy'
import { ACCOUNT_CAP, GUEST_CAP } from '../lib/saved/snapshot'

const ROOT = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

function check(id: string, condition: boolean, detail = ''): void {
  if (!condition) {
    console.error(`FAIL: ${id}${detail ? ` (${detail})` : ''}`)
    process.exit(1)
  }
}
function ok(id: string, what: string): void {
  console.log(`ok  ${id}: ${what}`)
}

type Value = string | number | string[]

// Una `public static let nome = valore` per riga: stringa, stringa raw #"..."#, intero o array di stringhe.
export function swiftConstants(text: string): Record<string, Value> {
  const out: Record<string, Value> = {}
  for (const line of text.split('\n')) {
    const m = /^\s*public static let (\w+) = (.+?)\s*$/.exec(line)
    if (!m) continue
    const [, name, raw] = m
    let r: RegExpExecArray | null
    if ((r = /^#"(.*)"#$/.exec(raw))) out[name] = r[1]
    else if (raw.startsWith('[')) out[name] = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1])
    else if ((r = /^"(.*)"$/.exec(raw))) out[name] = r[1]
    else if (/^\d+$/.test(raw)) out[name] = Number(raw)
  }
  return out
}

export function contractDiff(expected: Record<string, Value>, actual: Record<string, Value>): string[] {
  return Object.keys(expected)
    .filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]))
    .map((k) => `${k}: atteso ${JSON.stringify(expected[k])}, trovato ${JSON.stringify(actual[k])}`)
}

const expected: Record<string, Value> = {
  plan: PLAN,
  features: [...FEATURES],
  apnsEnvironments: [...APNS_ENVIRONMENTS],
  apnsTokenPattern: APNS_TOKEN_RE.source,
  deviceCap: DEVICE_CAP,
  userAgentPattern: APP_USER_AGENT_RE.source,
  universalLinkPaths: [...UNIVERSAL_LINK_PATHS],
  categories: [...CANONICAL_CATEGORIES],
  guestCap: GUEST_CAP,
  accountCap: ACCOUNT_CAP,
}

const swift = read('ios/Packages/FuorirottaCore/Sources/FuorirottaCore/ApiContract.swift')

// S1
const diff = contractDiff(expected, swiftConstants(swift))
check('S1', diff.length === 0, diff.join('; '))
ok('S1', `ApiContract.swift uguale a lib/api-contract.ts (${Object.keys(expected).length} costanti)`)

// S2: la stessa verifica su una copia alterata deve segnalare esattamente la differenza.
const drifted = contractDiff(expected, swiftConstants(swift.replace(', "push"', '')))
check('S2', drifted.length === 1 && drifted[0].startsWith('features:'), drifted.join('; ') || 'nessuna differenza')
ok('S2', 'il confronto fallisce su una copia senza "push"')

// S3: Release sicura. Il sorgente di Info.plist non ha ATS; le regole locali stanno solo nello script DebugLocal.
const plist = read('ios/App/Info.plist')
check('S3', !plist.includes('NSAppTransportSecurity') && !plist.includes('NSAllowsArbitraryLoads'), 'Info.plist contiene ATS')
const yml = read('ios/project.yml')
check('S3', yml.includes('API_BASE_URL: https://fuori-rotta.it'), 'API_BASE_URL di base non e\' https://fuori-rotta.it')
const lines = yml.split('\n')
const start = lines.findIndex((l) => l.trim() === 'postBuildScripts:')
check('S3', start >= 0, 'postBuildScripts mancante')
const indent = (l: string) => l.length - l.trimStart().length
let end = start + 1
while (end < lines.length && (lines[end].trim() === '' || indent(lines[end]) > indent(lines[start]))) end++
const script = lines.slice(start, end).join('\n')
check('S3', script.includes('"$CONFIGURATION" = "DebugLocal"') && script.includes('NSAllowsLocalNetworking'), 'script DebugLocal incompleto')
const outside = [...lines.slice(0, start), ...lines.slice(end)]
  .filter((l) => l.includes('http://') || l.includes('NSAllowsLocalNetworking'))
check('S3', outside.length === 0, `fuori dallo script DebugLocal: ${outside.join(' | ')}`)
ok('S3', 'Release senza ATS: rete locale solo nello script DebugLocal')
