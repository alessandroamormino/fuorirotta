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
 * critica — qui la sezione critica e' lo scrape stesso, quasi cinque ore per
 * in-lombardia.it (4h53m osservate in produzione il 2026-09-15): tenere una
 * connessione del pool bloccata per mezza giornata e' proprio il problema che
 * D-16 vuole risolvere, non uno strumento per risolverlo.
 */
import { prisma } from '../prisma'

// 8h. Il valore precedente (2h) veniva dal limite inferiore della Fase 8
// (>=53 min, 08-05-SUMMARY.md) e l'Assumption A3 di 14-RESEARCH.md avvertiva
// che non era validato contro un run piu' lungo. La prova a N=1 del
// 2026-09-16 l'ha falsificata: due run di in-lombardia da 4h53m e 5h05m,
// col lock scaduto a meta' strada e un secondo scrape partito sopra il primo
// (3 sovrapposizioni osservate).
//
// 8h non e' un margine scelto a occhio: il costo dello scrape e' aritmetico,
// (pagine AJAX + pagine di dettaglio) x INLOMBARDIA_CRAWL_DELAY_MS, cioe'
// ~1660 x 10s = 4h37m di pavimento per la Lombardia di oggi. 8h copre quel
// pavimento con quasi il doppio di margine e resta molto sotto le 24h fra
// due run della stessa regione, cosi' un lock davvero orfano si autoripara
// entro la giornata.
//
// Se una regione superasse le 8h il numero va rialzato QUI e in nessun altro
// punto — ma prima conviene chiedersi perche' sta scaricando cosi' tante
// pagine di dettaglio (vedi ScrapeParams.detailCachedUrls).
export const LOCK_TTL_MS = 8 * 60 * 60 * 1000

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

/**
 * Regioni con un lock ATTUALMENTE attivo (non scaduto), lette dalle stesse
 * righe di `acquireRegionLock`/`releaseRegionLock` (CR-02, Fase 15 review):
 * nessuna tabella nuova, nessun secondo livello di lock. Usata dal refresh
 * on-demand (app/api/events/route.ts) per il controllo cross-regione a
 * livello di host — mai per decidere un'acquisizione: quella resta SOLO
 * `acquireRegionLock`, l'unica sezione critica reale e atomica.
 */
export async function getActiveLockedRegions(): Promise<string[]> {
  const rows = await prisma.regionLock.findMany({
    where: { expiresAt: { gt: new Date() } },
    select: { region: true },
  })
  return rows.map((row) => row.region)
}
