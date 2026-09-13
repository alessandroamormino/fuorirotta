/**
 * Lock per regione (D-13, SCHED-03): unica implementazione condivisa da cron,
 * refresh da traffico e CLI manuale. Il lock vive nel database, non nel
 * processo, perche' i tre chiamanti sono processi distinti — un lock in
 * memoria non li vedrebbe, e in Docker sparirebbe a ogni restart.
 *
 * Perche' NON pg_advisory_lock: un advisory lock e' legato alla sessione
 * fisica Postgres. `prisma.$queryRaw` prende in prestito una connessione dal
 * pool interno di Prisma solo per la durata di quella query e la restituisce
 * subito dopo — la chiamata di unlock successiva puo' ricevere una
 * connessione fisica diversa dal pool, nel qual caso l'unlock e' un no-op
 * silenzioso e il lock resta preso finche' quella connessione fisica non
 * chiude (mai, finche' resta nel pool e viene riusata per altre query).
 * L'unica forma sicura di advisory lock con Prisma richiederebbe una
 * transazione esplicita che pinni una connessione per l'intera sezione
 * critica — qui la sezione critica e' lo scrape stesso, fino a oltre un'ora
 * per in-lombardia.it (>=53 min misurati, 08-05-SUMMARY.md): tenere una
 * connessione del pool bloccata per un'ora e' proprio il problema che D-16
 * vuole risolvere, non uno strumento per risolverlo.
 */
import { prisma } from '../prisma'

// 2h: ampio margine sopra il limite inferiore misurato per in-lombardia.it
// (>=53 min, 08-05-SUMMARY.md), ma molto sotto la finestra giornaliera di una
// regione "ricca" — un lock davvero orfano si autoripara entro la giornata.
// NON validato contro un run reale piu' lungo di 2h (Assumption A3,
// 14-RESEARCH.md): se la prova a N=1 (14-05) mostrasse un run oltre il TTL,
// il numero va rialzato QUI e in nessun altro punto.
export const LOCK_TTL_MS = 2 * 60 * 60 * 1000

/**
 * Acquisizione atomica: un solo statement, nessuna finestra fra lettura e
 * scrittura. ON CONFLICT prende un row-lock sulla riga contesa PRIMA di
 * valutare la clausola WHERE (Postgres docs, sql-insert.html) — due
 * acquisizioni concorrenti sulla stessa regione si serializzano da sole,
 * non serve altro codice di sincronizzazione applicativo.
 */
export async function acquireRegionLock(region: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ region: string }[]>`
    INSERT INTO region_locks (region, locked_at, expires_at)
    VALUES (${region}, now(), now() + (${LOCK_TTL_MS}::text || ' milliseconds')::interval)
    ON CONFLICT (region) DO UPDATE
      SET locked_at = EXCLUDED.locked_at, expires_at = EXCLUDED.expires_at
      WHERE region_locks.expires_at < now()
    RETURNING region
  `
  return rows.length === 1
}

/**
 * Rilascio best-effort: un fallimento nel rilascio non deve mai mascherare
 * l'esito reale dello scrape (stesso ragionamento di recordScrapeRuns in
 * runner.ts), e la scadenza ripara comunque il lock entro LOCK_TTL_MS.
 */
export async function releaseRegionLock(region: string): Promise<void> {
  await prisma.regionLock.delete({ where: { region } }).catch(() => {})
}
