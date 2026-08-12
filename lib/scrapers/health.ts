/**
 * Calcolo puro di stato di salute, baseline trailing e anomalia per sorgente (SRC-08).
 *
 * Nessun import di Prisma: riceve lo storico gia' letto dal chiamante e restituisce un
 * oggetto dati. La lettura dal database resta responsabilita' di `app/api/monitoring/route.ts`.
 */

export type HealthStatus = 'healthy' | 'degraded' | 'failed' | 'insufficient_history'

export interface RunRecord {
  startedAt: Date
  eventCount: number
  durationMs: number
  error: string | null
}

export interface SourceHealth {
  source: string
  region: string
  status: HealthStatus
  lastRun: {
    timestamp: string
    eventCount: number
    durationMs: number
    error: string | null
  }
  baseline: {
    windowSize: number
    runsRecorded: number
    avgEventCount: number
  } | null
  anomaly: boolean | null
}

// Valori iniziali, rivedibili dopo aver osservato dati reali in produzione (vedi SUMMARY).
export const HEALTH_WINDOW_SIZE = 7
export const HEALTH_DROP_THRESHOLD = 0.4

const MAX_ERROR_LENGTH = 500

/**
 * Tronca a 500 caratteri conservando l'inizio (dove sta la causa) e aggiungendo un
 * carattere di ellissi solo quando ha effettivamente troncato.
 */
export function truncateError(message: string | null): string | null {
  if (message === null) return null
  if (message.length <= MAX_ERROR_LENGTH) return message
  return message.slice(0, MAX_ERROR_LENGTH) + '…'
}

function roundHalfUp(value: number, decimals: number): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * Calcola stato, baseline e flag di anomalia per una coppia (source, region).
 *
 * @param runs Ordinato per `startedAt` decrescente; `runs[0]` e' l'ultima esecuzione.
 *   Il chiamante deve filtrare a monte le coppie senza alcuna esecuzione registrata:
 *   questa funzione richiede almeno una run.
 */
export function computeSourceHealth(source: string, region: string, runs: RunRecord[]): SourceHealth {
  if (runs.length === 0) {
    throw new Error('computeSourceHealth richiede almeno una run: il chiamante deve filtrare le coppie senza esecuzioni')
  }

  const lastRun = runs[0]

  // Baseline: fino a HEALTH_WINDOW_SIZE esecuzioni riuscite (error nullo) piu' recenti
  // fra quelle strettamente precedenti a lastRun.
  const baselineRuns = runs
    .slice(1)
    .filter(run => run.error === null)
    .slice(0, HEALTH_WINDOW_SIZE)

  const runsRecorded = baselineRuns.length
  const baselineComplete = runsRecorded === HEALTH_WINDOW_SIZE

  let baseline: SourceHealth['baseline'] = null
  let rawMean: number | null = null

  // La media non viene mai calcolata su zero esecuzioni.
  if (runsRecorded > 0) {
    rawMean = baselineRuns.reduce((sum, run) => sum + run.eventCount, 0) / runsRecorded
    baseline = {
      windowSize: HEALTH_WINDOW_SIZE,
      runsRecorded,
      // avgEventCount esposto nel payload e' arrotondato; il confronto di anomalia sotto
      // usa invece rawMean, non arrotondato.
      avgEventCount: roundHalfUp(rawMean, 1)
    }
  }

  let anomaly: boolean | null = null
  if (baselineComplete && rawMean !== null) {
    // Confronto strettamente minore: un calo esattamente pari alla soglia non e' anomalo.
    anomaly = lastRun.eventCount < rawMean * (1 - HEALTH_DROP_THRESHOLD)
  }

  // Precedenza dello stato, prima condizione vera vince.
  let status: HealthStatus
  if (lastRun.error !== null) {
    status = 'failed'
  } else if (!baselineComplete) {
    status = 'insufficient_history'
  } else if (anomaly) {
    status = 'degraded'
  } else {
    status = 'healthy'
  }

  return {
    source,
    region,
    status,
    lastRun: {
      timestamp: lastRun.startedAt.toISOString(),
      eventCount: lastRun.eventCount,
      durationMs: lastRun.durationMs,
      error: lastRun.error
    },
    baseline,
    anomaly
  }
}

// Self-check minimale delle diramazioni di stato: `npx tsx lib/scrapers/health.ts`.
// Non un framework di test, solo un demo() con assert che fallisce rumorosamente se la
// precedenza di stato o il confronto di anomalia si rompono.
if (require.main === module) {
  const run = (eventCount: number, error: string | null = null): RunRecord => ({
    startedAt: new Date(),
    eventCount,
    durationMs: 1000,
    error
  })

  // 1 sola run -> baseline vuota, insufficient_history, anomaly null
  const oneRun = computeSourceHealth('s', 'r', [run(100)])
  console.assert(oneRun.status === 'insufficient_history', 'atteso insufficient_history con 1 run')
  console.assert(oneRun.baseline === null, 'atteso baseline null con 0 run precedenti')
  console.assert(oneRun.anomaly === null, 'atteso anomaly null quando baseline incompleta')

  // 8 run (1 lastRun + 7 baseline) tutte a 100 -> healthy, baseline completa
  const healthyRuns = [run(100), ...Array(HEALTH_WINDOW_SIZE).fill(null).map(() => run(100))]
  const healthy = computeSourceHealth('s', 'r', healthyRuns)
  console.assert(healthy.status === 'healthy', 'atteso healthy con conteggio stabile')
  console.assert(healthy.anomaly === false, 'atteso anomaly false quando baseline completa e nessun calo')
  console.assert(healthy.baseline?.avgEventCount === 100, 'media attesa 100')

  // Calo esattamente pari alla soglia (60 = 100 * (1 - 0.4)) -> NON anomalo (confronto stretto)
  const exactThreshold = [run(60), ...Array(HEALTH_WINDOW_SIZE).fill(null).map(() => run(100))]
  const exact = computeSourceHealth('s', 'r', exactThreshold)
  console.assert(exact.anomaly === false, 'atteso anomaly false su calo esattamente pari alla soglia')
  console.assert(exact.status === 'healthy', 'atteso healthy su calo esattamente pari alla soglia')

  // Calo sotto la soglia -> anomalo, status degraded
  const belowThreshold = [run(50), ...Array(HEALTH_WINDOW_SIZE).fill(null).map(() => run(100))]
  const degraded = computeSourceHealth('s', 'r', belowThreshold)
  console.assert(degraded.anomaly === true, 'atteso anomaly true su calo sotto la soglia')
  console.assert(degraded.status === 'degraded', 'atteso status degraded')

  // lastRun con errore -> failed, precedenza sopra a tutto il resto
  const failed = computeSourceHealth('s', 'r', [run(0, 'boom'), ...Array(HEALTH_WINDOW_SIZE).fill(null).map(() => run(100))])
  console.assert(failed.status === 'failed', 'atteso status failed quando lastRun.error non e\' nullo')

  // truncateError: nessuna ellissi sotto soglia, ellissi solo se tronca davvero
  console.assert(truncateError(null) === null, 'truncateError(null) deve restare null')
  console.assert(truncateError('breve') === 'breve', 'stringa corta non deve essere alterata')
  const long = 'x'.repeat(600)
  const truncated = truncateError(long)
  console.assert(truncated !== null && truncated.length === MAX_ERROR_LENGTH + 1 && truncated.endsWith('…'), 'stringa lunga deve troncare a 500 char + ellissi')

  console.log('[health.ts] self-check OK')
}
