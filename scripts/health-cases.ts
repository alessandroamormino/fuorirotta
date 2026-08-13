/**
 * Casi di confine per computeSourceHealth (SRC-08). Nessun framework, nessun import di
 * Prisma: la funzione e' pura, gli input sono array costruiti in memoria — gira in meno di
 * un secondo e non tocca mai il database. Eseguire con `npx tsx scripts/health-cases.ts`.
 *
 * L'invariante centrale che questo file protegge: `anomaly` non collassa mai su `false`
 * quando la risposta onesta e' "non ancora misurabile" (baseline incompleta o assente).
 */
import assert from 'node:assert/strict'
import {
  computeSourceHealth,
  truncateError,
  HEALTH_WINDOW_SIZE,
  HEALTH_DROP_THRESHOLD,
  type RunRecord
} from '../lib/scrapers/health'

let seq = 0
function run(eventCount: number, error: string | null = null): RunRecord {
  // startedAt distinto per ogni run (decrescente non e' verificato da computeSourceHealth,
  // che si fida dell'ordine del chiamante — qui basta che ogni run abbia una data valida).
  seq += 1
  return { startedAt: new Date(2026, 0, seq), eventCount, durationMs: 1000, error }
}

function ok(label: string): void {
  console.log(`ok  ${label}`)
}

// --- Caso 1: anomalia rilevata --------------------------------------------------------
{
  const runs = [run(10), ...Array.from({ length: HEALTH_WINDOW_SIZE }, () => run(100))]
  const health = computeSourceHealth('s', 'r', runs)
  assert.equal(health.anomaly, true, 'Caso 1 (SRC-08): atteso anomaly=true su un crollo netto del conteggio')
  assert.equal(health.status, 'degraded', 'Caso 1 (SRC-08): atteso status=degraded quando anomaly e\' true')
  ok('Caso 1: anomalia rilevata su crollo netto del conteggio (anomaly=true, status=degraded)')
}

// --- Caso 2: baseline completa e sana ---------------------------------------------------
{
  const runs = [run(98), ...Array.from({ length: HEALTH_WINDOW_SIZE }, () => run(100))]
  const health = computeSourceHealth('s', 'r', runs)
  assert.equal(health.anomaly, false, 'Caso 2 (SRC-08): atteso anomaly=false con conteggio stabile')
  assert.equal(health.status, 'healthy', 'Caso 2 (SRC-08): atteso status=healthy')
  ok('Caso 2: baseline completa e sana (anomaly=false, status=healthy)')
}

// --- Caso 3: confine della finestra, un passo sotto -------------------------------------
{
  const runs = [run(100), ...Array.from({ length: HEALTH_WINDOW_SIZE - 1 }, () => run(100))]
  const health = computeSourceHealth('s', 'r', runs)
  assert.equal(health.status, 'insufficient_history', 'Caso 3 (SRC-08): atteso status=insufficient_history con HEALTH_WINDOW_SIZE-1 run di baseline')
  assert.equal(health.anomaly, null, 'Caso 3 (SRC-08): atteso anomaly=null, MAI false, quando la baseline e\' incompleta')
  assert.notEqual(health.anomaly, false, 'Caso 3 (SRC-08): anomaly non deve mai collassare su false per omissione')
  ok('Caso 3: confine della finestra, un passo sotto (status=insufficient_history, anomaly=null non false)')
}

// --- Caso 4: confine della finestra, esatto ----------------------------------------------
{
  const runs = [run(100), ...Array.from({ length: HEALTH_WINDOW_SIZE }, () => run(100))]
  const health = computeSourceHealth('s', 'r', runs)
  assert.equal(typeof health.anomaly, 'boolean', 'Caso 4 (SRC-08): con esattamente HEALTH_WINDOW_SIZE run di baseline, anomaly deve essere un booleano, non null')
  ok('Caso 4: confine della finestra, esatto (anomaly e\' un booleano, non null)')
}

// --- Caso 5: storico vuoto ----------------------------------------------------------------
{
  const runs = [run(100)]
  const health = computeSourceHealth('s', 'r', runs)
  assert.equal(health.baseline, null, 'Caso 5 (SRC-08): atteso baseline=null con un solo run e nessuna baseline')
  assert.equal(health.anomaly, null, 'Caso 5 (SRC-08): atteso anomaly=null con un solo run e nessuna baseline')
  ok('Caso 5: storico vuoto (baseline=null, anomaly=null)')
}

// --- Caso 6: soglia esatta, da entrambi i lati --------------------------------------------
{
  // Baseline media = 100. Soglia = 100 * (1 - HEALTH_DROP_THRESHOLD) = 60.
  const threshold = 100 * (1 - HEALTH_DROP_THRESHOLD)
  assert.equal(threshold, 60, 'precondizione del caso 6: HEALTH_DROP_THRESHOLD e\' cambiato, ricalcolare i valori attesi')

  const atThreshold = [run(threshold), ...Array.from({ length: HEALTH_WINDOW_SIZE }, () => run(100))]
  const healthAt = computeSourceHealth('s', 'r', atThreshold)
  assert.equal(healthAt.anomaly, false, 'Caso 6a (SRC-08): un calo esattamente pari alla soglia non e\' anomalo (confronto strettamente minore)')
  assert.equal(healthAt.status, 'healthy', 'Caso 6a (SRC-08): status=healthy sulla soglia esatta')

  const belowThreshold = [run(threshold - 1), ...Array.from({ length: HEALTH_WINDOW_SIZE }, () => run(100))]
  const healthBelow = computeSourceHealth('s', 'r', belowThreshold)
  assert.equal(healthBelow.anomaly, true, 'Caso 6b (SRC-08): un evento sotto la soglia esatta e\' anomalo')
  assert.equal(healthBelow.status, 'degraded', 'Caso 6b (SRC-08): status=degraded un evento sotto la soglia esatta')

  ok('Caso 6: soglia esatta da entrambi i lati (soglia=non anomala, soglia-1=anomala)')
}

// --- Caso 7: precisione della media (ordine confronto vs arrotondamento) ------------------
{
  // Baseline: 6 x 100 + 1 x 101 => rawMean = 701/7 = 100.142857... => avgEventCount
  // esposto (arrotondato a 1 decimale) = 100.1.
  //   soglia con rawMean non arrotondato = 0.6 * 100.142857... = 60.0857142857...
  //   soglia con avgEventCount arrotondato = 0.6 * 100.1 = 60.06
  // lastRun.eventCount = 60.07 cade STRETTAMENTE fra le due soglie: e' l'unico valore che
  // distingue "confronto sul valore grezzo" (60.07 < 60.0857 => anomaly=true) da un'ipotetica
  // implementazione scorretta che arrotondasse la media PRIMA di confrontare
  // (60.07 < 60.06 => false). Il contratto dichiara che si usa il valore non arrotondato:
  // questo caso e' l'unico modo di provarlo, non solo di asserirlo.
  const baseline = [...Array.from({ length: HEALTH_WINDOW_SIZE - 1 }, () => run(100)), run(101)]
  const runs = [run(60.07), ...baseline]
  const health = computeSourceHealth('s', 'r', runs)

  assert.equal(health.baseline?.avgEventCount, 100.1, 'Caso 7 (SRC-08): avgEventCount atteso arrotondato a 100.1')
  assert.equal(health.anomaly, true, 'Caso 7 (SRC-08): il confronto di anomalia deve usare la media NON arrotondata — se questo assert fallisce, il confronto sta arrotondando prima di confrontare')
  ok('Caso 7: precisione della media — il confronto usa il valore non arrotondato, non avgEventCount')
}

// --- Caso 8: l'errore ha la precedenza -----------------------------------------------------
{
  const runs = [run(0, 'errore di test'), ...Array.from({ length: HEALTH_WINDOW_SIZE }, () => run(100))]
  const health = computeSourceHealth('s', 'r', runs)
  assert.equal(health.status, 'failed', 'Caso 8 (SRC-08): status=failed quando lastRun.error non e\' nullo, a prescindere da baseline/anomalia')
  ok('Caso 8: l\'errore ha la precedenza su ogni altra condizione (status=failed)')
}

// --- Caso 9: esecuzioni fallite escluse dalla baseline --------------------------------------
{
  const runs = [
    run(100),
    run(999, 'err interno alla baseline'), // esclusa: non deve contare ne' pesare sulla media
    ...Array.from({ length: HEALTH_WINDOW_SIZE }, () => run(100)),
    run(999, 'err oltre la finestra') // esclusa anche questa, e comunque fuori dalla slice(0,7)
  ]
  const health = computeSourceHealth('s', 'r', runs)
  assert.equal(health.baseline?.runsRecorded, HEALTH_WINDOW_SIZE, 'Caso 9 (SRC-08): runsRecorded deve contare solo le run riuscite')
  assert.equal(health.baseline?.avgEventCount, 100, 'Caso 9 (SRC-08): la media non deve essere sporcata dai conteggi delle run fallite (999)')
  assert.equal(health.status, 'healthy', 'Caso 9 (SRC-08): status=healthy una volta escluse le run fallite dalla baseline')
  ok('Caso 9: esecuzioni fallite escluse dalla baseline (runsRecorded e avgEventCount ignorano gli error)')
}

// --- Caso 10: troncamento -------------------------------------------------------------------
{
  const long = 'x'.repeat(600)
  const truncatedLong = truncateError(long)
  assert.ok(truncatedLong !== null, 'Caso 10 (SRC-08): truncateError su stringa lunga non deve restituire null')
  assert.equal(truncatedLong!.length, 501, 'Caso 10 (SRC-08): 500 caratteri conservati + 1 carattere di ellissi')
  assert.ok(truncatedLong!.startsWith('x'.repeat(500)), 'Caso 10 (SRC-08): i primi 500 caratteri devono essere conservati invariati')
  assert.ok(truncatedLong!.endsWith('…'), 'Caso 10 (SRC-08): la stringa troncata deve terminare con il carattere di ellissi')

  const exact = 'y'.repeat(500)
  assert.equal(truncateError(exact), exact, 'Caso 10 (SRC-08): una stringa di esattamente 500 caratteri non deve essere alterata ne\' ricevere ellissi')

  assert.equal(truncateError(null), null, 'Caso 10 (SRC-08): truncateError(null) deve restare null')
  ok('Caso 10: troncamento a 500 caratteri + ellissi solo quando tronca davvero, null invariato')
}

console.log('PASS: health-cases (10/10) — computeSourceHealth verificata su tutti i confini di SRC-08')
