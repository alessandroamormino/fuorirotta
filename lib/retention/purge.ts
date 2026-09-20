/**
 * Cancellazione definitiva degli eventi CONCLUSI (D-RET-01).
 *
 * Perche' esiste: fino a oggi nessun percorso del progetto cancellava un
 * evento. Il database era un secchio che si riempie e basta — misurato il
 * 2026-09-20 sul Postgres locale: 22.414 righe di cui 1.769 gia' concluse, la
 * piu' vecchia del 2019-12-09. Nessuna di quelle righe puo' piu' comparire in
 * una ricerca (ogni query filtra su data futura), ma tutte pesano su ogni
 * passata whole-table: backfill territoriale, dedup, ricalcolo della cache dei
 * cluster.
 *
 * "Concluso" e' `COALESCE(dateEnd, dateStart) < soglia`, mai `dateStart` da
 * solo: un evento cominciato tre giorni fa e che finisce domani e' IN CORSO, e
 * cancellarlo lo toglierebbe dal sito mentre e' ancora in programma. Gli eventi
 * multi-data entrano gia' come una riga per data (D-10), quindi la valutazione
 * riga per riga e' quella giusta.
 *
 * RETENTION_DAYS non e' zero di proposito: una finestra di grazia copre i fusi,
 * gli eventi senza `dateEnd` che durano fino a notte fonda, e un utente che
 * riapre un link il giorno dopo.
 */

import { prisma } from '../prisma'

/** Giorni di grazia dopo la conclusione, prima della cancellazione definitiva. */
export const RETENTION_DAYS = 7

/** Righe cancellate per giro: tiene la transazione corta sul pool condiviso. */
const PURGE_BATCH_SIZE = 500

export interface PurgeReport {
  /** Mezzanotte UTC di oggi meno RETENTION_DAYS. */
  cutoff: Date
  /**
   * Righe che la guardia considera cancellabili. In dryRun e' l'unico numero
   * che conta: un dryRun che riporta solo `deleted: 0` non dice nulla di
   * quello che sta per succedere, ed e' inutile come anteprima.
   */
  eligible: number
  /** Righe effettivamente cancellate (0 se dryRun). */
  deleted: number
  /** Righe concluse ma risparmiate perche' ancora canoniche per un superstite. */
  keptAsCanonical: number
}

/**
 * Soglia: mezzanotte UTC, non `now()`. Il resto del progetto ragiona sul
 * confine di GIORNO in UTC (lib/clusterCache.ts, i gate di copertura), e due
 * componenti che confrontano date devono usare lo stesso confine — la lezione
 * gia' pagata con scripts/cluster-volume.test.sh.
 */
export function purgeCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now)
  cutoff.setUTCHours(0, 0, 0, 0)
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS)
  return cutoff
}

export async function purgeConcludedEvents(
  options: { dryRun?: boolean; now?: Date; onlySource?: string } = {}
): Promise<PurgeReport> {
  const { dryRun = false, onlySource } = options
  const cutoff = purgeCutoff(options.now)

  // Candidati: conclusi prima della soglia. COALESCE in SQL grezzo perche'
  // Prisma non esprime "il maggiore fra due colonne" in un filtro.
  //
  // `onlySource` esiste per UN motivo solo: permettere al gate
  // (scripts/retention-purge.test.sh) di esercitare la cancellazione VERA
  // sulle proprie righe di prova senza toccare il catalogo. Un test che per
  // funzionare cancella definitivamente righe reali e' una trappola che prima
  // o poi scatta sul database sbagliato. La produzione non lo passa mai.
  const candidates = onlySource
    ? await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM events
        WHERE COALESCE(date_end, date_start) < ${cutoff} AND source = ${onlySource}
      `
    : await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM events WHERE COALESCE(date_end, date_start) < ${cutoff}
      `
  const candidateIds = new Set(candidates.map((r) => r.id))
  if (candidateIds.size === 0) {
    return { cutoff, eligible: 0, deleted: 0, keptAsCanonical: 0 }
  }

  // Guardia anti-resurrezione. La FK events.canonical_event_id -> events.id e'
  // ON DELETE SET NULL: cancellare una riga CANONICA mentre un suo duplicato
  // sopravvive azzera il puntatore del duplicato, che da quel momento risulta
  // canonico e TORNA VISIBILE nelle ricerche. Un evento cancellato che
  // ricompare e' molto peggio di una riga vecchia che resta.
  // Oggi il caso e' vuoto (misurato: 0), ma non e' impossibile — un gruppo di
  // dedup puo' contenere date diverse — e una guardia che oggi non scatta e'
  // esattamente cio' che serve il giorno in cui scatterebbe.
  const referenced = await prisma.$queryRaw<Array<{ canonical_event_id: number }>>`
    SELECT DISTINCT e.canonical_event_id
    FROM events e
    WHERE e.canonical_event_id IS NOT NULL
      AND COALESCE(e.date_end, e.date_start) >= ${cutoff}
  `
  const protectedIds = new Set(
    referenced.map((r) => r.canonical_event_id).filter((id): id is number => id !== null)
  )

  const deletable: number[] = []
  let keptAsCanonical = 0
  for (const id of candidateIds) {
    if (protectedIds.has(id)) keptAsCanonical++
    else deletable.push(id)
  }

  if (dryRun) {
    return { cutoff, eligible: deletable.length, deleted: 0, keptAsCanonical }
  }

  let deleted = 0
  for (let i = 0; i < deletable.length; i += PURGE_BATCH_SIZE) {
    const batch = deletable.slice(i, i + PURGE_BATCH_SIZE)
    const res = await prisma.event.deleteMany({ where: { id: { in: batch } } })
    deleted += res.count
  }

  return { cutoff, eligible: deletable.length, deleted, keptAsCanonical }
}
