/**
 * Scraper runner script
 *
 * Executes all 3 scrapers concurrently and saves results to PostgreSQL.
 *
 * Usage:
 *   npx tsx frontend/lib/scrapers/runner.ts
 *   npx tsx frontend/lib/scrapers/runner.ts --from 2026-03-01 --to 2026-06-30
 */

import { SOURCE_REGISTRY, getSourceById } from './registry'
import type { SourceRegistryEntry } from './registry'
import { saveEvents, logMetrics } from './utils'
import { truncateError } from './health'
import { prisma } from '../prisma'
import { acquireRegionLock, releaseRegionLock, getActiveLockedRegions } from './regionLock'
import type { ScrapeParams, ScrapeResult, RunResult } from './types'

/**
 * Elenco delle regioni dichiarate nel registry, nell'ordine di prima
 * apparizione (D-04). Il 404 di app/api/cron/scrape/route.ts e il generatore
 * di crontab della 14-04 dipendono da questa stabilità dell'ordine: non
 * sostituire con un ordinamento alfabetico o un Set non ordinato.
 */
export function getRegions(): string[] {
  return Array.from(new Set(SOURCE_REGISTRY.map(entry => entry.region)))
}

/**
 * Sorgenti del registry che appartengono a una regione. Confronto di
 * uguaglianza su stringa, mai costruzione di SQL: e' la mitigazione per
 * costruzione di T-14-02 (SQL injection via `region`).
 */
export function getSourcesByRegion(region: string): SourceRegistryEntry[] {
  return SOURCE_REGISTRY.filter(entry => entry.region === region)
}

/**
 * Raggruppa le sorgenti per hostname, nell'ordine di prima apparizione
 * dell'host. D-02: il Crawl-delay e' un vincolo per host (Fase 8 D-08/D-10),
 * quindi host diversi possono scrapare in parallelo senza violare nulla,
 * mentre due sorgenti sullo stesso host vanno serializzate fra loro.
 */
export function groupSourcesByHost(entries: SourceRegistryEntry[]): SourceRegistryEntry[][] {
  const byHost = new Map<string, SourceRegistryEntry[]>()
  for (const entry of entries) {
    const host = new URL(entry.url).hostname
    const group = byHost.get(host)
    if (group) {
      group.push(entry)
    } else {
      byHost.set(host, [entry])
    }
  }
  return Array.from(byHost.values())
}

/** Hostname distinti delle sorgenti di una regione. */
function getHostsForRegion(region: string): Set<string> {
  return new Set(getSourcesByRegion(region).map(entry => new URL(entry.url).hostname))
}

/**
 * True se un'ALTRA regione con un lock attivo condivide almeno un host con
 * `region` (CR-02, Fase 15 review): il Crawl-delay e' un vincolo per host
 * (D-02), ma il refresh on-demand (app/api/events/route.ts) acquisiva solo
 * un lock PER REGIONE — nessuna visibilita' fra due `runRegion()` di regioni
 * diverse. Prima di SRC-04 questo era innocuo (solo la Lombardia poteva
 * innescare un refresh); ora ogni regione puo', e SoloSagre condivide
 * www.solosagre.it con tutte e 20.
 *
 * ponytail: query-then-acquire, non atomico — una finestra stretta fra
 * questo controllo e l'INSERT di acquireRegionLock resta possibile (due
 * refresh per host diverso partiti nello stesso istante). Un lock per-host
 * vero richiederebbe una riga aggiuntiva o una transazione dedicata; qui
 * basta ridurre la finestra da "nessuna protezione" a "una corsa di pochi
 * millisecondi", coerente con "no nuova tabella, nessun secondo livello di
 * lock" (vedi anche il commento in cima a regionLock.ts sul perche' non e'
 * un pg_advisory_lock). Alzare il livello di garanzia se mai si osservasse
 * la corsa dal vivo, non prima.
 */
export async function isHostBusyForRegion(region: string): Promise<boolean> {
  const hosts = getHostsForRegion(region)
  if (hosts.size === 0) return false

  const lockedRegions = await getActiveLockedRegions()
  for (const lockedRegion of lockedRegions) {
    if (lockedRegion === region) continue
    for (const host of getHostsForRegion(lockedRegion)) {
      if (hosts.has(host)) return true
    }
  }
  return false
}

/**
 * Giorno del refresh completo: la domenica (UTC) nessun dettaglio viene
 * saltato e ogni pagina viene riscaricata.
 *
 * Perche' serve: saltare il dettaglio degli eventi gia' noti rende lo scrape
 * quotidiano minuti invece di ore, ma una pagina di dettaglio PUO' cambiare
 * dopo la prima lettura — un orario spostato, un indirizzo corretto. Senza un
 * giro completo periodico quelle correzioni non arriverebbero mai.
 *
 * Perche' il giorno della settimana e non una colonna `detailFetchedAt`:
 * quella colonna sarebbe una migrazione, un backfill su 12.499 righe e uno
 * stato in piu' da mantenere, per ottenere la stessa cosa che un confronto
 * sul calendario da' gratis. Se un giorno servisse una politica per-evento
 * (es. ricontrollare piu' spesso gli eventi imminenti) allora la colonna si
 * giustifica; oggi no.
 */
export const FULL_DETAIL_REFRESH_WEEKDAY = 0

/** Domenica UTC: nessun dettaglio saltato, si riscarica tutto. */
export function isFullDetailRefreshDay(now: Date = new Date()): boolean {
  return now.getUTCDay() === FULL_DETAIL_REFRESH_WEEKDAY
}

/**
 * `sourceUrl` degli eventi di questa sorgente il cui dettaglio e' gia' stato
 * letto e salvato. `description` non nulla e' il marcatore: e' il campo che
 * esiste SOLO nella pagina di dettaglio, quindi se c'e', quella pagina e'
 * stata scaricata almeno una volta.
 *
 * Conseguenza accettata: un evento la cui pagina di dettaglio non ha davvero
 * descrizione viene riscaricato ogni giorno per sempre. Sono pochi e il costo
 * e' proporzionale a quanti sono — nessuno stato in piu' da mantenere per
 * distinguerli.
 *
 * Solo il runner parla col database: gli adattatori ricevono l'insieme gia'
 * pronto via ScrapeParams e restano puri.
 */
async function detailCachedUrls(sourceId: string): Promise<Set<string>> {
  const rows = await prisma.event.findMany({
    where: { source: sourceId, description: { not: null }, sourceUrl: { not: null } },
    select: { sourceUrl: true }
  })
  return new Set(rows.map(row => row.sourceUrl).filter((url): url is string => Boolean(url)))
}

/**
 * Scrape di una singola regione (SCHED-01, D-01): filtra il registry sulla
 * regione, raggruppa per host (D-02) ed esegue i gruppi in parallelo fra
 * loro e in sequenza dentro ogni gruppo. Non decide codici HTTP: se la
 * regione non ha sorgenti restituisce un RunResult a zero, ed e' la ROUTE a
 * rispondere 404 con getRegions() (D-03). Non esegue la coda di aggancio
 * territoriale/deduplica/cache dei cluster: quella coda e' del job
 * consolidato separato (D-05/D-06/D-07, 14-03), non di questa funzione.
 *
 * @param region - Slug di regione (D-04), gia' validato dal chiamante
 * @param params - Optional date range parameters
 * @returns RunResult con saved, skipped, total e errors per la sola regione
 */
export async function runRegion(region: string, params?: ScrapeParams): Promise<RunResult> {
  console.log(`[Scraper] Starting scrape of region "${region}"...`)
  const startedAt = new Date()

  try {
    const groups = groupSourcesByHost(getSourcesByRegion(region))

    // Il refresh completo settimanale ignora la cache dei dettagli.
    const fullRefresh = isFullDetailRefreshDay()
    if (fullRefresh) {
      console.log('[Scraper] Refresh completo settimanale: nessuna pagina di dettaglio saltata.')
    }

    // Gruppi (host diversi) in parallelo fra loro; dentro ogni gruppo (stesso
    // host) le sorgenti in sequenza — D-02.
    const groupSettled = await Promise.allSettled(
      groups.map(async group => {
        const groupResults: ScrapeResult[] = []
        for (const entry of group) {
          try {
            const entryParams: ScrapeParams = fullRefresh
              ? { ...params }
              : { ...params, detailCachedUrls: await detailCachedUrls(entry.id) }
            const adapterResult = await entry.scrape(entryParams)
            groupResults.push({ ...adapterResult, region: entry.region })
          } catch (err) {
            groupResults.push({
              events: [],
              source: entry.id,
              region: entry.region,
              duration: 0,
              error: err instanceof Error ? err.message : 'Unknown error'
            })
          }
        }
        return groupResults
      })
    )

    const results: ScrapeResult[] = groupSettled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))

    logMetrics(results)

    // Storico scrape_runs: un problema qui non deve mai impedire il salvataggio eventi.
    await recordScrapeRuns(results, startedAt)

    const errors = results.filter(r => r.error).map(r => `${r.source}: ${r.error}`)
    const allEvents = results.flatMap(r => r.events)

    if (allEvents.length === 0) {
      console.log(`[Scraper] No events to save for region "${region}".`)
      return { saved: 0, skipped: 0, total: 0, errors }
    }

    const { saved, skipped } = await saveEvents(allEvents, region)
    console.log(`[Scraper] Done. ${saved} new events saved to database for region "${region}".`)

    return { saved, skipped, total: allEvents.length, errors }
  } catch (error) {
    console.error(`[Scraper] Fatal error scraping region "${region}":`, error)
    throw error
  }
}

/**
 * Scrive una riga scrape_runs per ogni risultato (SRC-07), a esecuzione conclusa.
 * Avvolta in try/catch: un fallimento della scrittura dello storico non deve mai far
 * fallire lo scrape, gli eventi vengono salvati comunque e l'errore viene loggato.
 */
async function recordScrapeRuns(results: ScrapeResult[], startedAt: Date): Promise<void> {
  try {
    await Promise.all(
      results.map(result =>
        prisma.scrapeRun.create({
          data: {
            source: result.source,
            region: result.region,
            startedAt,
            durationMs: result.duration,
            eventCount: result.events.length,
            error: truncateError(result.error ?? null)
          }
        })
      )
    )
  } catch (error) {
    console.error('[Scraper] Failed to record scrape run history:', error)
  }
}

// Run directly: npx tsx lib/scrapers/runner.ts [source] [--region <slug>] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N]
//
// WR-02 (Fase 15 review): "solosagre" da solo NON basta piu' a identificare
// una sorgente unica — SRC-04 lo condivide fra 20 regioni. `--region <slug>`
// e' obbligatorio insieme a un `source` ambiguo (il ramo sotto esce con
// errore e l'elenco delle regioni se manca); combinato con `source` esegue
// SOLO quella sorgente in quella regione, non l'intera regione.
//
// Stessa guardia a tre condizioni degli altri self-check del progetto. Oggi
// questo modulo non e' raggiungibile dal bundle browser (i client importano
// lib/scrapers/registry.ts direttamente, mai il barrel che riesporta di qui),
// quindi la forma nuda non esplodeva — ma e' la stessa mina che ha ucciso la
// homepage quando connectionLimit.ts, quello SI' raggiungibile, l'ha usata.
// Basterebbe un import del barrel da un componente client per riaccenderla.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const args = process.argv.slice(2)
  const params: ScrapeParams = {}
  let sourceId: string | null = null
  let regionSlug: string | null = null
  let eventLimit: number | null = null

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      params.dateFrom = args[i + 1]
      i++
    } else if (args[i] === '--to' && args[i + 1]) {
      params.dateTo = args[i + 1]
      i++
    } else if (args[i] === '--region' && args[i + 1]) {
      regionSlug = args[i + 1]
      i++
    } else if (args[i] === '--limit' && args[i + 1]) {
      // Tetto per le PROVE in locale: tiene il Postgres di sviluppo leggibile
      // invece di riversarci l'intero catalogo di ogni fonte nuova. Il cron di
      // produzione non lo passa mai, quindi in produzione legge tutto quello
      // che la fonte espone — nessun limite implicito, mai.
      // Tronca a valle dello scrape, non a monte: la richiesta di rete e'
      // gia' partita e l'adattatore resta puro. Non risparmia banda, risparmia
      // righe in tabella, che e' il problema che deve risolvere.
      const parsed = Number.parseInt(args[i + 1], 10)
      if (!Number.isInteger(parsed) || parsed < 1) {
        console.error(`[Scraper] --limit richiede un intero positivo, ricevuto "${args[i + 1]}".`)
        process.exit(1)
      }
      eventLimit = parsed
      i++
    } else if (!args[i].startsWith('--')) {
      sourceId = args[i]
    }
  }

  const run = async () => {
    if (sourceId) {
      // WR-02 (Fase 15 review): controllato PRIMA di regionSlug cosi'
      // "solosagre --region toscana" esegue la sola sorgente di quella
      // regione, non l'intera regione (ramo sotto). Senza questo, un source
      // ambiguo (piu' di una entry con lo stesso id — oggi solo 'solosagre',
      // dopo SRC-04) risolveva sempre, silenziosamente, alla prima entry
      // dichiarata (Lombardia), qualunque fosse l'intento dell'operatore.
      const matches = SOURCE_REGISTRY.filter(e => e.id === sourceId)
      if (matches.length === 0) {
        const ids = Array.from(new Set(SOURCE_REGISTRY.map(e => e.id))).join(', ')
        console.error(`[Scraper] Unknown source "${sourceId}". Available: ${ids}`)
        process.exit(1)
      }
      if (matches.length > 1 && !regionSlug) {
        const regions = matches.map(e => e.region).join(', ')
        console.error(
          `[Scraper] "${sourceId}" e' condiviso da piu' regioni (${regions}) — specifica --region <slug>, es. "${sourceId} --region ${matches[0].region}".`
        )
        process.exit(1)
      }
      const entry = getSourceById(sourceId, regionSlug ?? undefined)
      if (!entry) {
        const regions = matches.map(e => e.region).join(', ')
        console.error(`[Scraper] Nessuna sorgente "${sourceId}" per la regione "${regionSlug}". Disponibili: ${regions}`)
        process.exit(1)
      }
      console.log(`[Scraper] Running single scraper: ${entry.id} (${entry.region})`)
      const startedAt = new Date()
      const adapterResult = await entry.scrape(params)
      const result: ScrapeResult = { ...adapterResult, region: entry.region }
      logMetrics([result])
      await recordScrapeRuns([result], startedAt)
      let toSave = result.events
      if (eventLimit !== null && toSave.length > eventLimit) {
        console.log(`[Scraper] --limit ${eventLimit}: salvo ${eventLimit} eventi su ${toSave.length} trovati (prova locale, NON e' il comportamento di produzione).`)
        toSave = toSave.slice(0, eventLimit)
      }
      if (toSave.length > 0) {
        const { saved, skipped } = await saveEvents(toSave, entry.region)
        console.log(`[Scraper] Done. ${saved} new events saved, ${skipped} skipped.`)
      } else {
        console.log('[Scraper] No events found.')
      }
    } else if (regionSlug) {
      if (getSourcesByRegion(regionSlug).length === 0) {
        const regions = getRegions().join(', ')
        console.error(`[Scraper] Unknown region "${regionSlug}". Available: ${regions}`)
        process.exit(1)
      }
      console.log(`[Scraper] Running region: ${regionSlug}`)
      // Stessa coppia importata da ./regionLock usata dalla route cron (D-13):
      // mai una seconda implementazione del lock per il chiamante CLI.
      if (!(await acquireRegionLock(regionSlug))) {
        console.error(`[Scraper] Scrape gia' in corso per la regione "${regionSlug}", esco.`)
        process.exit(1)
      }
      try {
        await runRegion(regionSlug, params)
      } finally {
        await releaseRegionLock(regionSlug)
      }
    } else {
      // Nessun argomento: scrape sequenziale di tutte le regioni dichiarate
      // nel registry (14-03), non piu' runAllScrapers() — quel ramo non
      // aveva ne' lock ne' scoping per regione. Stessa coppia acquireRegion-
      // Lock/releaseRegionLock del ramo --region sopra (D-13): una regione
      // gia' occupata (es. da un trigger cron in corso) viene saltata, non
      // interrompe il ciclo sulle altre.
      for (const region of getRegions()) {
        console.log(`[Scraper] Running region: ${region}`)
        if (!(await acquireRegionLock(region))) {
          console.error(`[Scraper] Scrape gia' in corso per la regione "${region}", salto.`)
          continue
        }
        try {
          await runRegion(region, params)
        } finally {
          await releaseRegionLock(region)
        }
      }
    }
    await prisma.$disconnect()
  }

  run().catch(async (error) => {
    console.error('[Scraper] Execution failed:', error)
    await prisma.$disconnect()
    process.exit(1)
  })
}
