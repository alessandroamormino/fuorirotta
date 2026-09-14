#!/usr/bin/env -S npx tsx
/**
 * Genera le righe di crontab dal registry (SCHED-02, D-09): il crontab
 * smette di essere una riga scritta a mano in DEPLOYMENT.md e diventa
 * l'output di questa funzione. Legge SOLO `REGION_SCHEDULES` (registry.ts)
 * e `getRegions()` (runner.ts) — nessuno schedule scritto a mano qui dentro
 * (D-10/D-11 restano l'unica fonte di verita').
 *
 * Puro: non contatta rete ne' database, non legge il crontab installato
 * sull'host. La modalita' `--check` legge invece un DUMP passato come
 * argomento (mai il crontab reale direttamente): quel dump va prodotto a
 * mano con `crontab -l` SULL'HOST, perche' questo script — quando gira
 * dentro il container Docker — non ha accesso al crontab dell'host
 * (namespace utente/cron separato). Vedi DEPLOYMENT.md per la procedura in
 * due passi.
 *
 * Uso:
 *   npx tsx scripts/generate-crontab.ts                 # stampa le righe attese
 *   npx tsx scripts/generate-crontab.ts --check <path>   # confronta con un dump di `crontab -l` ('-' per stdin)
 */
import { readFileSync } from 'fs'
import { getRegions } from '../lib/scrapers/runner'
import { REGION_SCHEDULES, MAINTENANCE_SCHEDULE } from '../lib/scrapers/registry'

const SCRIPT_PATH = '/opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape.sh'
const MAINTENANCE_SCRIPT_PATH = '/opt/docker/fuori-rotta/fuorirotta/scripts/cron-maintenance.sh'
const LOG_PATH = '/var/log/fuorirotta-cron.log'

/**
 * Genera l'intero contenuto del crontab: CRON_TZ (D-12) in testa su una
 * riga propria seguita da una riga vuota, poi una riga per regione
 * (ordine di dichiarazione di SOURCE_REGISTRY via getRegions(), D-04/S4),
 * poi la riga del job consolidato. Nessun algoritmo di scaglionamento
 * automatico qui: a N=1 non c'e' nulla da distribuire, gli orari sono
 * dichiarati a mano in REGION_SCHEDULES (D-11).
 */
export function generate(): string {
  const lines = ['CRON_TZ=Europe/Rome', '']
  for (const region of getRegions()) {
    const schedule = REGION_SCHEDULES[region]
    if (!schedule) {
      // Mai un crontab parziale con una riga silenziosamente omessa
      // (mitigazione della prohibition di transparency di 14-04-PLAN.md).
      throw new Error(`Nessuno schedule dichiarato in REGION_SCHEDULES per la regione "${region}"`)
    }
    lines.push(`${schedule} ${SCRIPT_PATH} ${region} >> ${LOG_PATH} 2>&1`)
  }
  lines.push(`${MAINTENANCE_SCHEDULE} ${MAINTENANCE_SCRIPT_PATH} >> ${LOG_PATH} 2>&1`)
  return lines.join('\n') + '\n'
}

/**
 * Confronta il dump del crontab installato (letto da `installedPath`, `-`
 * per stdin) con l'output atteso, dopo trim() su entrambi i lati (una riga
 * vuota finale in piu' o in meno non e' una divergenza reale). Stampa
 * entrambe le versioni su divergenza — un `--check` che non sa fallire non
 * e' un controllo (D-09, prova di non-vacuita' S5).
 */
function runCheck(installedPath: string): never {
  // Un percorso illeggibile esce 2 come il percorso assente, invece di morire
  // con lo stack trace ENOENT di Node: la procedura di rilevamento drift
  // (DEPLOYMENT.md §"Detect drift") e' manuale e in due passi, quindi un dump
  // mai creato — `crontab -l` fallito, path digitato male — e' il modo piu'
  // probabile in cui questo comando sbaglia, ed e' l'unico caso in cui la
  // differenza fra "combacia" e "non ho potuto guardare" conta davvero.
  let installed: string
  try {
    installed = readFileSync(installedPath === '-' ? 0 : installedPath, 'utf8')
  } catch (error) {
    console.error(
      `Impossibile leggere il dump del crontab installato (${installedPath}): ` +
        (error instanceof Error ? error.message : String(error))
    )
    process.exit(2)
  }
  const expected = generate()
  if (installed.trim() !== expected.trim()) {
    console.error('DIVERGENZA fra registry e crontab installato:')
    console.error('--- installato ---\n' + installed)
    console.error('--- atteso (dal registry) ---\n' + expected)
    process.exit(1)
  }
  console.log('OK: crontab installato combacia col registry')
  process.exit(0)
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const checkIdx = args.indexOf('--check')
  if (checkIdx !== -1) {
    const installedPath = args[checkIdx + 1]
    if (!installedPath) {
      console.error('Uso: generate-crontab.ts --check <path-al-dump-di-crontab-l> (- per stdin)')
      process.exit(2)
    }
    runCheck(installedPath)
  } else {
    process.stdout.write(generate())
  }
}
