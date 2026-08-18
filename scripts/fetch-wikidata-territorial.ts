#!/usr/bin/env -S npx tsx
/**
 * Scarica da Wikidata (CC0, verificato e approvato al checkpoint del Task 1 di
 * 06-03) le due sorgenti che l'ISTAT ufficiale non porta: la coordinata del
 * centro abitato/municipio di ogni comune (D-10) e i nomi alternativi
 * bilingue/trilingue (D-03/TERR-02).
 *
 * Perche' Wikidata e non opendatasicilia/comuni-italiani: quest'ultimo non ha
 * un file di licenza rintracciabile (404 su LICENSE.md), quindi "tutti i
 * diritti riservati" per i termini di default di GitHub. Wikidata e' CC0.
 *
 * Query SPARQL (endpoint pubblico, richiede uno User-Agent esplicito):
 * - coordinate: comune (wd:Q747074) + codice ISTAT (wdt:P635) + punto
 *   (wdt:P625, estratto via psv: per avere lat/lon separati invece di un
 *   letterale Point(...) da riparsare)
 * - nomi ufficiali (wdt:P1448) e label nativa (wdt:P1705) — NON rdfs:label,
 *   che per l'Alto Adige restituisce esonimi (Milano -> "Mailand" in tedesco),
 *   non i nomi statutari. Verificato in sessione: le due proprieta' bastano e
 *   Bolzano/Bozen, Falzes/Pfalzen compaiono correttamente sotto P1448.
 *
 * Nessuna riga viene generata a intuito: se un comune non ha ne' P1448 ne'
 * P1705 su Wikidata, semplicemente non produce un alias — non e' un dato
 * assente da riempire, e' un dato che quel comune non ha (es. Ortisei ha solo
 * il nome ufficiale, nessuna native label registrata al momento del fetch).
 *
 * Rigenerazione: `npx tsx scripts/fetch-wikidata-territorial.ts`
 * (nessun accesso al database, solo rete + scrittura file sotto data/).
 */
import { writeFileSync } from 'fs'
import path from 'path'
import { normalizeComuneName } from '../lib/territorial/normalize'

const ENDPOINT = 'https://query.wikidata.org/sparql'
const USER_AGENT = 'fuorirotta-seed/1.0 (https://fuori-rotta.it; contatto via repository GitHub)'
const REPO_ROOT = path.resolve(__dirname, '..')

async function runQuery(query: string): Promise<string[][]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/csv',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `query=${encodeURIComponent(query)}`,
  })
  if (!res.ok) {
    throw new Error(`Wikidata SPARQL ha risposto ${res.status}: ${await res.text()}`)
  }
  const text = await res.text()
  const lines = text.split(/\r\n|\n/).filter(l => l !== '')
  // CSV semplice: nessun campo restituito da queste query contiene virgole.
  return lines.map(line => line.split(','))
}

// NON aggregata con GROUP BY/SAMPLE: verificato in sessione che la forma
// aggregata perde in modo silenzioso ~240 comuni (quasi tutta la Sardegna,
// che pure ha la coordinata su Wikidata — verificato query diretta su
// Cagliari/Q1897) senza nessun errore o troncamento dichiarato nella
// risposta, probabilmente per un limite interno del motore SPARQL su GROUP
// BY a questa scala. La forma non aggregata (piu' righe, una per comune con
// piu' di uno statement P625) e' completa e il dedup si fa lato client.
const COORDS_QUERY = `
SELECT ?istat ?latitude ?longitude WHERE {
  ?c wdt:P31 wd:Q747074 ;
     wdt:P635 ?istat ;
     p:P625/psv:P625 [
       wikibase:geoLatitude ?latitude ;
       wikibase:geoLongitude ?longitude
     ] .
}
`

const OFFICIAL_NAMES_QUERY = `
SELECT ?istat ?officialName WHERE {
  ?c wdt:P31 wd:Q747074 ; wdt:P635 ?istat ; wdt:P1448 ?officialName .
}
`

const NATIVE_LABELS_QUERY = `
SELECT ?istat ?nativeLabel WHERE {
  ?c wdt:P31 wd:Q747074 ; wdt:P635 ?istat ; wdt:P1705 ?nativeLabel .
}
`

/**
 * Un valore P1448/P1705 puo' essere una forma combinata "Pfalzen / Falzes"
 * (un'unica stringa per due nomi ufficiali) — split su '/' e trim. Funzione
 * pura, self-check in coda al file.
 */
export function splitCombinedForms(raw: string): string[] {
  return raw
    .split('/')
    .map(s => s.trim())
    .filter(s => s !== '')
}

/**
 * Costruisce le righe istat_code,alias a partire dai nomi grezzi raccolti
 * (officiali + nativi, gia' uniti), rimuovendo duplicati e ogni alias che
 * normalizza alla stessa chiave del nome italiano del comune (l'array alias
 * serve a risolvere nomi DIVERSI dal nome canonico, non a ripeterlo).
 */
export function buildAliasRows(
  rawByIstat: Map<string, string[]>,
  italianNameByIstat: Map<string, string>
): { istatCode: string; alias: string }[] {
  const rows: { istatCode: string; alias: string }[] = []
  for (const [istatCode, rawValues] of rawByIstat) {
    const italianName = italianNameByIstat.get(istatCode)
    const italianKey = italianName ? normalizeComuneName(italianName) : null
    const seen = new Set<string>()
    for (const raw of rawValues) {
      for (const alias of splitCombinedForms(raw)) {
        const key = normalizeComuneName(alias)
        if (key === '' || seen.has(key)) continue
        if (italianKey !== null && key === italianKey) continue
        seen.add(key)
        rows.push({ istatCode, alias })
      }
    }
  }
  return rows
}

function groupByIstat(rows: string[][]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  // rows[0] e' l'intestazione della risposta CSV di Wikidata.
  for (const [istat, value] of rows.slice(1)) {
    if (!istat || !value) continue
    const bucket = map.get(istat)
    if (bucket) bucket.push(value)
    else map.set(istat, [value])
  }
  return map
}

async function main() {
  console.log('[FetchWikidata] interrogo l\'endpoint SPARQL pubblico...')

  const coordsRows = await runQuery(COORDS_QUERY)
  // Un comune puo' avere piu' di uno statement P625 (es. Cagliari, due punti
  // leggermente diversi): si tiene il primo incontrato, dedup lato client
  // invece che con GROUP BY/SAMPLE lato SPARQL (vedi commento su COORDS_QUERY).
  const coordsByIstat = new Map<string, { lat: string; lon: string }>()
  for (const [istat, lat, lon] of coordsRows.slice(1)) {
    if (!istat || !lat || !lon || coordsByIstat.has(istat)) continue
    coordsByIstat.set(istat, { lat, lon })
  }
  console.log(`[FetchWikidata] coordinate: ${coordsByIstat.size} comuni con punto centro abitato`)

  const coordsCsvLines = [
    '# Fonte: Wikidata SPARQL (P31=comune italiano Q747074, P635=codice ISTAT, P625=coordinata)',
    '# Licenza: CC0 1.0 (Wikidata) - https://www.wikidata.org/wiki/Wikidata:Licensing',
    `# Data di scarico: ${new Date().toISOString().slice(0, 10)}`,
    '# Rigenerazione: npx tsx scripts/fetch-wikidata-territorial.ts',
    'istat_code,latitude,longitude',
    ...[...coordsByIstat.entries()].map(([istat, { lat, lon }]) => `${istat},${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`),
  ]
  writeFileSync(path.join(REPO_ROOT, 'data/coordinate-wikidata.csv'), coordsCsvLines.join('\n') + '\n')

  const officialRows = await runQuery(OFFICIAL_NAMES_QUERY)
  const nativeRows = await runQuery(NATIVE_LABELS_QUERY)
  const officialByIstat = groupByIstat(officialRows)
  const nativeByIstat = groupByIstat(nativeRows)

  const combined = new Map<string, string[]>()
  for (const [istat, values] of officialByIstat) combined.set(istat, [...values])
  for (const [istat, values] of nativeByIstat) {
    const bucket = combined.get(istat)
    if (bucket) bucket.push(...values)
    else combined.set(istat, [...values])
  }

  // Nome italiano per istat_code: stessa fonte ISTAT gia' scaricata sotto
  // data/, non una query aggiuntiva. Se il file non e' presente non e'
  // bloccante: l'unico effetto e' che il dedup contro il nome italiano non
  // scarta nulla (nessun falso positivo, solo un alias ridondante in piu').
  const italianNameByIstat = new Map<string, string>()
  try {
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(path.join(REPO_ROOT, 'data/Elenco-comuni-italiani.xlsx'))
    const ws = wb.worksheets[0]
    for (let r = 2; r <= ws.rowCount; r++) {
      const code = String(ws.getRow(r).getCell(5).value ?? '').padStart(6, '0')
      const name = ws.getRow(r).getCell(7).value
      if (code && code !== '000000' && typeof name === 'string') italianNameByIstat.set(code, name)
    }
  } catch {
    console.log('[FetchWikidata] data/Elenco-comuni-italiani.xlsx non trovato, dedup contro il nome italiano saltato')
  }

  const aliasRows = buildAliasRows(combined, italianNameByIstat)
  console.log(`[FetchWikidata] alias: ${aliasRows.length} righe per ${combined.size} comuni con P1448/P1705`)

  const aliasCsvLines = [
    '# Fonte: Wikidata SPARQL, proprieta\' P1448 (nome ufficiale) e P1705 (native label)',
    '# NON rdfs:label: in tedesco restituisce esonimi (Milano -> "Mailand"), non i nomi statutari',
    '# Licenza: CC0 1.0 (Wikidata) - https://www.wikidata.org/wiki/Wikidata:Licensing',
    `# Data di scarico: ${new Date().toISOString().slice(0, 10)}`,
    '# Rigenerazione: npx tsx scripts/fetch-wikidata-territorial.ts',
    'istat_code,alias',
    ...aliasRows.map(({ istatCode, alias }) => `${istatCode},${alias}`),
  ]
  writeFileSync(path.join(REPO_ROOT, 'data/comuni-aliases.csv'), aliasCsvLines.join('\n') + '\n')

  console.log('[FetchWikidata] scritti data/coordinate-wikidata.csv e data/comuni-aliases.csv')
}

// Self-check: `npx tsx scripts/fetch-wikidata-territorial.ts --self-check`.
// Copre solo le funzioni pure (split forme combinate, costruzione alias),
// nessuna chiamata di rete. Deve girare PRIMA di main(), altrimenti
// --self-check farebbe comunque le tre query di rete.
function selfCheck() {
  console.assert(
    JSON.stringify(splitCombinedForms('Pfalzen / Falzes')) === JSON.stringify(['Pfalzen', 'Falzes']),
    "atteso split di 'Pfalzen / Falzes' in due forme"
  )
  console.assert(
    JSON.stringify(splitCombinedForms('Ortisei')) === JSON.stringify(['Ortisei']),
    'una forma singola non deve essere alterata'
  )

  const raw = new Map([['021008', ['Bolzano', 'Bozen', 'Bolzano']]])
  const italian = new Map([['021008', 'Bolzano']])
  const rows = buildAliasRows(raw, italian)
  console.assert(
    rows.length === 1 && rows[0].alias === 'Bozen',
    "atteso un solo alias 'Bozen' per Bolzano (il nome italiano stesso e' escluso, i duplicati pure)"
  )

  console.log('[fetch-wikidata-territorial.ts] self-check OK')
}

if (require.main === module) {
  if (process.argv.includes('--self-check')) {
    selfCheck()
  } else {
    main().catch(err => {
      console.error(`[FetchWikidata] ERRORE: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    })
  }
}
