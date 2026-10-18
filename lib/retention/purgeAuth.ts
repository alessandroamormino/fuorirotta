/**
 * Pulizia giornaliera dei dati d'accesso (AUTH-08, D-15).
 *
 * Perche' esiste: il rate limit di Better Auth salva in `auth_rate_limit` una
 * riga per indirizzo IP (la chiave e' `<ip>|<percorso>`), e la libreria non le
 * cancella mai da sola; sessioni e stati OAuth scaduti restano in tabella
 * finche' qualcuno non li toglie. Senza questo passo "gli indirizzi IP del
 * rate limit restano 24 ore" sarebbe una promessa, non un fatto.
 *
 * Perche' 24 ore: il job gira una volta al giorno, quindi la vita massima di
 * una riga e' un giro di manutenzione. AUTH_RATE_LIMIT_RETENTION_HOURS E' il
 * numero che /privacy dichiara: check:privacy-pages (21-09) confronta il testo
 * con questo valore, quindi cambiarla senza cambiare il testo fa fallire il
 * gate. Per tenere vera la promessa il taglio NON e' a 24 ore (una riga
 * scritta un minuto dopo il giro sopravviverebbe a quello dopo, ~48 ore): si
 * cancella tutto cio' che e' fuori dalla finestra del throttle
 * (AUTH_RATE_LIMIT_CUTOFF_MINUTES), cosi' a ogni giro resta solo cio' che e'
 * stato scritto dopo, cioe' meno di un giorno.
 *
 * Sessioni e stati di accesso: si cancellano solo quelli GIA' scaduti, mai
 * una sessione viva (cancellarla sloggerebbe una persona).
 */

import { prisma } from '../prisma'

/** Vita massima di una riga di rate limit dato il giro quotidiano; e' il numero scritto in /privacy. */
export const AUTH_RATE_LIMIT_RETENTION_HOURS = 24
/** Minuti oltre i quali un contatore e' fuori dalle finestre del throttle (60 s in lib/auth.ts) e si cancella. */
export const AUTH_RATE_LIMIT_CUTOFF_MINUTES = 5

export interface PurgeAuthReport {
  /** Istante (ms dall'epoca) prima del quale un contatore di rate limit e' vecchio. */
  cutoffMs: number
  /** Contatori di rate limit cancellati (idonei, se dryRun). */
  rateLimitDeleted: number
  /** Sessioni scadute cancellate (idonee, se dryRun). */
  sessionsDeleted: number
  /** Stati di accesso (auth_verification) scaduti cancellati (idonei, se dryRun). */
  verificationsDeleted: number
}

export async function purgeAuthRows(
  options: { now?: Date; dryRun?: boolean } = {}
): Promise<PurgeAuthReport> {
  const { now = new Date(), dryRun = false } = options
  const cutoffMs = now.getTime() - AUTH_RATE_LIMIT_CUTOFF_MINUTES * 60 * 1000
  // last_request e' in millisecondi (BigInt), come lo scrive la libreria.
  const oldRateLimit = { lastRequest: { lt: BigInt(cutoffMs) } }
  const expired = { expiresAt: { lt: now } }

  // ponytail: una deleteMany per tabella, perche' le tre tabelle sono minuscole
  // (qualche migliaio di righe al massimo); se crescessero, il giro a lotti di
  // lib/retention/purge.ts e' l'upgrade.
  if (dryRun) {
    return {
      cutoffMs,
      rateLimitDeleted: await prisma.rateLimit.count({ where: oldRateLimit }),
      sessionsDeleted: await prisma.session.count({ where: expired }),
      verificationsDeleted: await prisma.verification.count({ where: expired }),
    }
  }

  return {
    cutoffMs,
    rateLimitDeleted: (await prisma.rateLimit.deleteMany({ where: oldRateLimit })).count,
    sessionsDeleted: (await prisma.session.deleteMany({ where: expired })).count,
    verificationsDeleted: (await prisma.verification.deleteMany({ where: expired })).count,
  }
}
