/**
 * Cancellazione dei salvataggi 12 mesi dopo la fine dell'evento (Fase 22, D-01).
 *
 * Perche' esiste: "Passati" tiene un evento finito per SAVED_RETENTION_MONTHS
 * mesi e /privacy lo dichiara. Il purge dei 7 giorni (purge.ts) lascia vivo il
 * salvataggio con event_id NULL e l'istantanea aggiornata; senza questo passo
 * quella riga resterebbe per sempre e la promessa sarebbe falsa.
 *
 * Una riga si cancella solo se la fine dell'istantanea e' STRETTAMENTE prima
 * della soglia (un evento che finisce esattamente alla soglia resta) e, quando
 * la riga viva esiste ancora, anche quella e' finita prima della soglia: un
 * evento che le date dell'istantanea danno per chiuso ma che la fonte ha
 * spostato in avanti e' vivo, e cancellarlo toglierebbe un salvataggio
 * attivo.
 */

import { prisma } from '../prisma'
import { SAVED_RETENTION_MONTHS } from '../saved/retention'

export interface PurgeSavedReport {
  /** Mezzanotte UTC di oggi meno SAVED_RETENTION_MONTHS mesi. */
  cutoff: Date
  /** Salvataggi cancellabili (in dryRun e' l'unico numero che conta). */
  eligible: number
  /** Salvataggi effettivamente cancellati (0 se dryRun). */
  deleted: number
}

/** Soglia a mezzanotte UTC, come purgeCutoff: stesso confine di giorno in tutto il job. */
export function savedCutoff(now: Date = new Date()): Date {
  const cutoff = new Date(now)
  cutoff.setUTCHours(0, 0, 0, 0)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - SAVED_RETENTION_MONTHS)
  return cutoff
}

export async function purgeOldSaves(
  options: { now?: Date; dryRun?: boolean; onlyUser?: string } = {}
): Promise<PurgeSavedReport> {
  const { dryRun = false, onlyUser } = options
  const cutoff = savedCutoff(options.now)
  // `onlyUser` esiste solo perche' il gate (scripts/retention-purge.test.sh)
  // possa esercitare la cancellazione vera sul proprio utente di prova senza
  // toccare un salvataggio reale. La produzione non lo passa mai.
  const user = onlyUser ?? null

  if (dryRun) {
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM saved_events s
      WHERE COALESCE(s.date_end, s.date_start) < ${cutoff}
        AND (${user}::text IS NULL OR s.user_id = ${user})
        AND NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.id = s.event_id AND COALESCE(e.date_end, e.date_start) >= ${cutoff}
        )
    `
    return { cutoff, eligible: rows[0]?.n ?? 0, deleted: 0 }
  }

  const deleted = await prisma.$executeRaw`
    DELETE FROM saved_events s
    WHERE COALESCE(s.date_end, s.date_start) < ${cutoff}
      AND (${user}::text IS NULL OR s.user_id = ${user})
      AND NOT EXISTS (
        SELECT 1 FROM events e
        WHERE e.id = s.event_id AND COALESCE(e.date_end, e.date_start) >= ${cutoff}
      )
  `
  return { cutoff, eligible: deleted, deleted }
}
