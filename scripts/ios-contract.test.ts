// check:ios-contract (test:ci). Nessun database, nessun Swift: legge ApiContract.swift e i file di
// ios/ come testo, quindi gira uguale su Linux in CI.
//
// S1 la copia Swift del contratto e' uguale a lib/api-contract.ts; S2 il gate sa fallire;
// S3 la build Release non puo' portarsi dietro le regole di rete locale (D-10, T-27-01).
// S5 il percorso di rilascio dell'app non puo' creare un tag v*, perdere una chiave o aprire oltre i tester interni.
//
// Esce con 1 al primo controllo fallito. Stampa "ok  <ID>: ..." per ognuno.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  APNS_ENVIRONMENTS, APNS_TOKEN_RE, APP_USER_AGENT_RE, DEVICE_CAP, FEATURES, PLAN, SAVED_LIST_ITEM_KEYS, SAVED_RESOLVE_ITEM_KEYS,
  UNIVERSAL_LINK_PATHS,
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
  savedListItemKeys: [...SAVED_LIST_ITEM_KEYS],
  savedResolveItemKeys: [...SAVED_RESOLVE_ITEM_KEYS],
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

// S4 disciplina dei token (D-05): fuori da Tokens.swift niente esadecimali, Color(red:/hex:, UIColor(red: ne'
// dimensioni di font fisse. Il matcher e' una funzione pura, provata su una stringa piantata.
const TOKEN_VIOLATIONS: [string, RegExp][] = [
  ['esadecimale', /"[^"\n]*#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])[^"\n]*"/],
  ['Color(red:', /Color\(red:/],
  ['Color(hex:', /Color\(hex:/],
  ['UIColor(red:', /UIColor\(red:/],
  ['.font(.system(size:', /\.font\(\.system\(size:/],
]
export function tokenViolations(text: string): string[] {
  const found: string[] = []
  text.split('\n').forEach((line, i) => {
    for (const [name, re] of TOKEN_VIOLATIONS) if (re.test(line)) found.push(`riga ${i + 1}: ${name}`)
  })
  return found
}

check('S4', tokenViolations('let c = Color(red: 1, green: 0, blue: 0)').length === 1, 'il matcher non vede Color(red:')
check('S4', tokenViolations('let c = "#0071E3"').length === 1, 'il matcher non vede un esadecimale')
check('S4', tokenViolations('Text("Questo weekend #1 in Lombardia").font(.body)').length === 0, 'falso positivo su #1')

function swiftFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? swiftFiles(join(dir, e.name)) : e.name.endsWith('.swift') ? [join(dir, e.name)] : [],
  )
}
const screens = swiftFiles(join(ROOT, 'ios/App')).filter((f) => !f.endsWith('Tokens.swift'))
for (const f of screens) {
  const v = tokenViolations(readFileSync(f, 'utf8'))
  check('S4', v.length === 0, `${f.slice(ROOT.length + 1)}: ${v.join('; ')}`)
}
ok('S4', `${screens.length} file di schermata senza colori o font fissi (il matcher fallisce su una riga piantata)`)

// S6 navigazione (UAT3): niente `NavigationLink` con la destinazione inline. Non entra nel NavigationPath: i dettagli
// aggiunti al path finiscono sotto di lui ("Vedi tutto", tocco su un evento: si rivede l'elenco; a ogni Indietro
// riappaiono i dettagli gia' visti). Ogni collegamento e' `NavigationLink(value:)`, le destinazioni stanno in EventStack.
export function inlineLinks(text: string): string[] {
  const found: string[] = []
  text.split('\n').forEach((line, i) => {
    if (/NavigationLink\s*(\{|\(\s*destination:)/.test(line)) found.push(`riga ${i + 1}`)
  })
  return found
}
check('S6', inlineLinks('NavigationLink {\n  Dest()\n} label: { Text("x") }').length === 1, 'il matcher non vede NavigationLink {')
check('S6', inlineLinks('NavigationLink(destination: Dest()) { Text("x") }').length === 1, 'il matcher non vede destination:')
check('S6', inlineLinks('NavigationLink(value: route) { content }').length === 0, 'falso positivo su NavigationLink(value:)')
for (const f of screens) {
  const v = inlineLinks(readFileSync(f, 'utf8'))
  check('S6', v.length === 0, `${f.slice(ROOT.length + 1)}: NavigationLink con destinazione inline (${v.join(', ')})`)
}
ok('S6', 'nessun NavigationLink con destinazione inline (il matcher fallisce su uno piantato)')

// S7 lingue (UAT3): l'italiano e' la lingua di sviluppo, l'inglese e' completo. Senza questo i componenti di sistema
// (Accedi con Apple) usano l'inglese anche con l'app in italiano.
const specifiers = (text: string): string => (text.match(/%(?:\d+\$)?(?:lld|@|d|f)/g) ?? []).join(',')
export function catalogProblems(catalog: {
  sourceLanguage?: string
  strings?: Record<string, { localizations?: Record<string, { stringUnit?: { state?: string; value?: string } }> }>
}): string[] {
  const out: string[] = []
  if (catalog.sourceLanguage !== 'it') out.push(`sourceLanguage = ${catalog.sourceLanguage}`)
  for (const [key, entry] of Object.entries(catalog.strings ?? {})) {
    if (key === '') continue
    const unit = entry.localizations?.en?.stringUnit
    if (!unit?.value) out.push(`senza inglese: ${key}`)
    else if (unit.state !== 'translated') out.push(`inglese non tradotto: ${key}`)
    else if (specifiers(unit.value) !== specifiers(key)) out.push(`segnaposto diversi: ${key}`)
  }
  return out
}
check('S7', catalogProblems({ sourceLanguage: 'it', strings: { 'Ciao %@': { localizations: { en: { stringUnit: { state: 'translated', value: 'Hi' } } } } } }).length === 1, 'il gate non vede un segnaposto perso')
check('S7', catalogProblems({ sourceLanguage: 'it', strings: { Ciao: {} } }).length === 1, 'il gate non vede una stringa senza inglese')
check('S7', yml.includes('developmentLanguage: it') && yml.includes('CFBundleDevelopmentRegion: it') && /CFBundleLocalizations: \[it, en\]/.test(yml), 'project.yml non dichiara it come lingua di sviluppo e it/en come localizzazioni')
const catalog = JSON.parse(read('ios/App/Localizable.xcstrings'))
const problems = catalogProblems(catalog)
check('S7', problems.length === 0, problems.slice(0, 5).join('; '))
const infoCatalog = JSON.parse(read('ios/App/InfoPlist.xcstrings'))
check('S7', catalogProblems(infoCatalog).length === 0, catalogProblems(infoCatalog).join('; '))
// Le stringhe che il compilatore non estrae (FuorirottaCore, che le cerca nel bundle principale) devono stare nel catalogo.
const coreDir = join(ROOT, 'ios/Packages/FuorirottaCore/Sources')
for (const f of swiftFiles(coreDir)) {
  for (const m of readFileSync(f, 'utf8').matchAll(/String\(localized: "((?:[^"\\]|\\.)*)", bundle: \.main\)/g)) {
    const key = m[1].replace(/\\\([^)]*(?:\([^)]*\))?[^)]*\)/g, '%@')
    const found = Object.keys(catalog.strings).some((k) => k === key || k.replace(/%lld/g, '%@') === key)
    check('S7', found, `${f.slice(ROOT.length + 1)}: "${m[1]}" non e' nel catalogo`)
  }
}
const categories = [...read('ios/Packages/FuorirottaCore/Sources/FuorirottaCore/ApiContract.swift').matchAll(/categories = \[(.*)\]/g)][0][1]
for (const c of categories.match(/"[^"]+"/g) ?? []) check('S7', c.slice(1, -1) in catalog.strings, `categoria ${c} non e' nel catalogo`)
ok('S7', `catalogo it/en completo (${Object.keys(catalog.strings).length} stringhe), it lingua di sviluppo, il gate fallisce su una traduzione mancante`)

// S5 sicurezza del rilascio (D-08, D-09, T-27-35..38). Solo testo: gira uguale su Linux in CI.
// Ogni riga con `git tag` o `git push` deve nominare un tag ios-; nessuna puo' nominarne uno v* (auto-deploy
// rilascia il v* piu' alto in produzione). Funzione pura, provata su uno script piantato.
export function tagViolations(script: string): string[] {
  const found: string[] = []
  script.split('\n').forEach((line, i) => {
    if (!/git (tag|push)/.test(line)) return
    if (!line.includes('ios-')) found.push(`riga ${i + 1}: tag senza ios-`)
    if (/["'\s]v(?:\$|\d)/.test(line)) found.push(`riga ${i + 1}: tag v*`)
  })
  return found
}
check('S5', tagViolations('git tag -a "v${version}" -m x').length > 0, 'il matcher non vede git tag v${version}')
check('S5', tagViolations('git push --quiet origin "v2.1.0"').length > 0, 'il matcher non vede git push v2.1.0')
check('S5', tagViolations('git tag -a "ios-${version}" -m x\ngit push origin "ios-${version}"').length === 0, 'falso positivo su ios-')
const releaseIos = read('scripts/release-ios.sh')
const tv = tagViolations(releaseIos)
check('S5', tv.length === 0, `release-ios.sh: ${tv.join('; ')}`)
check('S5', (releaseIos.match(/git (?:tag|push)[^\n]*ios-\$\{version\}/g) ?? []).length >= 2, 'tag e push di ios-${version} mancanti')
const exportOpts = read('ios/ExportOptions.plist')
check('S5', /<key>testFlightInternalTestingOnly<\/key>\s*<true\/>/.test(exportOpts), 'testFlightInternalTestingOnly non e\' true')
check('S5', /<key>destination<\/key>\s*<string>upload<\/string>/.test(exportOpts), 'destination non e\' upload')
const gi = read('.gitignore').split('\n').map((l) => l.trim())
check('S5', gi.includes('*.p8') && gi.includes('*.mobileprovision'), '.gitignore senza *.p8 / *.mobileprovision')
const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => /\.(p8|mobileprovision)$/.test(f))
check('S5', tracked.length === 0, `tracciati: ${tracked.join(', ')}`)
check('S5', /<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(read('ios/App/PrivacyInfo.xcprivacy')), 'NSPrivacyTracking non e\' false')
ok('S5', 'rilascio app: solo tag ios-, solo tester interni, nessuna chiave tracciata (il matcher fallisce su un tag v piantato)')

// S8 test UI solo in locale (UAT7 A1): salvano e tolgono eventi, su produzione sporcherebbero un account vero.
// Lo schema di produzione non ha target di test UI; ogni classe di test UI passa da LocalTestCase (il guardiano).
export function uiTestsInProdScheme(text: string): string[] {
  const uiTargets = [...text.matchAll(/^ {2}(\S[^:\n]*):\n {4}type: bundle\.ui-testing$/gm)].map((m) => m[1])
  if (uiTargets.length === 0) return ['nessun target bundle.ui-testing trovato']
  const schemes = text.slice(text.indexOf('\nschemes:\n'))
  const prod = /^ {2}Fuorirotta:\n((?:(?: {4}.*)?\n)*)/m.exec(schemes)
  if (!schemes.startsWith('\nschemes:') || !prod) return ['schema Fuorirotta mancante']
  return uiTargets.filter((t) => prod[1].includes(t)).map((t) => `${t} nello schema di produzione`)
}
const planted = 'targets:\n  App:\n    type: application\n  AppUITests:\n    type: bundle.ui-testing\nschemes:\n  Fuorirotta:\n    test:\n      targets:\n        - AppUITests\n  Fuorirotta Locale:\n    test:\n      targets:\n        - AppUITests\n'
check('S8', uiTestsInProdScheme(planted).length === 1, 'il matcher non vede un test UI piantato nello schema di produzione')
check('S8', uiTestsInProdScheme(planted.replace('    test:\n      targets:\n        - AppUITests\n  Fuorirotta Locale', '  Fuorirotta Locale')).length === 0, 'falso positivo con i test solo nello schema Locale')
const prodUi = uiTestsInProdScheme(yml)
check('S8', prodUi.length === 0, prodUi.join('; '))
check('S8', /DebugLocal:\n {10}SWIFT_ACTIVE_COMPILATION_CONDITIONS: \$\(inherited\) LOCAL_API/.test(yml) && (yml.match(/LOCAL_API/g) ?? []).length === 1, 'LOCAL_API non e\' solo nella configurazione DebugLocal dei test UI')
const unguarded = swiftFiles(join(ROOT, 'ios/UITests'))
  .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/class (\w+): XCTestCase/g)].map((m) => m[1]))
  .filter((c) => c !== 'LocalTestCase')
check('S8', unguarded.length === 0, `classi di test UI senza LocalTestCase: ${unguarded.join(', ')}`)
ok('S8', 'test UI fuori dallo schema di produzione e fermati senza LOCAL_API (il matcher fallisce su uno schema piantato)')
