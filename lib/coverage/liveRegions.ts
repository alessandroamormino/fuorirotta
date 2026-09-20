/**
 * Segnale unico di copertura (Fase 15, ROLL-03, D-01/D-02/D-04).
 *
 * Una regione e' "viva" se ha piu' di COVERAGE_THRESHOLD eventi canonici
 * DISPONIBILI — in corso o futuri. Nessuna cache in processo, nessuna materializzazione notturna:
 * una query `GROUP BY region` ad ogni chiamata, sull'indice composito
 * `idx_events_region_date_start` (prisma/schema.prisma). Mappa, sitemap e
 * ogni pagina `/[regione]` chiamano SEMPRE questa funzione — nessun altro
 * file deve ripetere la query (grep -rl "by: \['region'\]" lo dimostra).
 *
 * DEDUP-01: filtra `canonicalEventId: null`. Senza questo filtro una
 * regione piena di duplicati sembrerebbe piu' viva di quanto sia davvero —
 * un evento fuso in tre righe conterebbe tre volte invece di una.
 *
 * Soglia secca (D-02): nessuna isteresi, nessuna finestra di grazia. Una
 * regione con esattamente COVERAGE_THRESHOLD eventi futuri canonici NON e'
 * viva; con COVERAGE_THRESHOLD + 1 lo e'.
 */
import { prisma } from '../prisma'
import { istatRegionToSlug } from '../scrapers/regionSlug'
import { romeMidnightUTC, todayInRome } from '../dateWindow'

/**
 * Ri-misurato dal vivo sul Postgres locale il 2026-09-19, DOPO l'ingestione
 * dell'Alto Adige (19-01-SUMMARY.md, comando: `SELECT region, count(*) FROM
 * events WHERE date_start >= now() AND canonical_event_id IS NULL AND
 * region IS NOT NULL GROUP BY region ORDER BY count DESC`):
 *
 *   trentino-alto-adige: 17.449 eventi futuri canonici
 *   lombardia:            1.647 eventi futuri canonici
 *   toscana:                  7 eventi futuri canonici
 *   emilia-romagna:            5 eventi futuri canonici
 *   umbria:                    3 eventi futuri canonici
 *   piemonte:                  3 eventi futuri canonici
 *   campania:                  2 eventi futuri canonici
 *   lazio:                     2 eventi futuri canonici
 *   veneto:                    2 eventi futuri canonici
 *   liguria:                   1 evento futuro canonico
 *
 * Regola di scelta (D-07, Fase 19): il valore deve stare sopra il massimo
 * osservato fra le regioni servite dalla sola SoloSagre — al momento della
 * ricerca le piu' ricche erano toscana 7, piemonte 3, umbria 3, confermate
 * identiche dalla misura di oggi — con un margine dichiarato. Adottata la
 * proposta di 19-RESEARCH.md: COVERAGE_THRESHOLD = 10, quasi il doppio del
 * massimo osservato (7), cosi' un rumore SoloSagre-only non puo' sembrare
 * una fonte viva nemmeno con qualche evento residuo in piu' di quelli
 * misurati oggi.
 *
 * Regioni che passano da viva (soglia precedente, 2) a spenta (soglia
 * nuova, 10) per effetto di questo cambio, nominate per iscritto prima del
 * deploy come richiesto da D-07:
 *
 *   - toscana        (7 eventi futuri canonici, sola SoloSagre)
 *   - emilia-romagna (5 eventi futuri canonici, fonte "ricca" adottata in
 *                     Fase 15 ma mai arrivata al volume promesso — vedi
 *                     19-CONTEXT.md "Deferred Ideas", riconsiderazione
 *                     rimandata a una fase futura)
 *   - umbria         (3 eventi futuri canonici, sola SoloSagre)
 *   - piemonte       (3 eventi futuri canonici, sola SoloSagre)
 *
 * Nessuna isteresi, nessuna finestra di grazia (D-02, Fase 15): una regione
 * con esattamente 10 eventi futuri NON e' viva, con 11 lo e'. Le pagine
 * delle quattro regioni sopra passano da indicizzabili a `200 + noindex`
 * (Fase 15 D-11) — conseguenza voluta del segnale di copertura che funziona
 * come progettato, non una rimozione (19-02-PLAN.md).
 */
export const COVERAGE_THRESHOLD = 10

/**
 * Inizio della finestra di copertura: mezzanotte di OGGI a Roma, come istante
 * UTC. La stessa che usa app/api/events/route.ts, e per la stessa ragione
 * (lib/dateWindow.ts): `date_start`/`date_end` sono `@db.Timestamp(6)` e
 * portano mezzanotte LOCALE scritta come cifre UTC, quindi un
 * `setUTCHours(0,0,0,0)` sbaglia il confronto di 1-2 ore secondo l'ora
 * legale. Era esattamente cio' che faceva questo file prima del 2026-09-20.
 */
function coverageWindowStart(): Date {
  return romeMidnightUTC(todayInRome())
}

/**
 * "Disponibile" = in corso o futuro, cioe' COALESCE(dateEnd, dateStart) >=
 * inizio finestra, scritto come OR esplicito perche' Prisma non ha COALESCE
 * nei filtri e `dateEnd` e' nullable.
 *
 * 2026-09-20: prima qui c'era `dateStart >= oggi`, e cioe' il segnale di
 * copertura contava una cosa DIVERSA da quella che l'API mostra
 * (app/api/events/route.ts, bugfix 2026-09-10, semantica di overlap). Una
 * regione fatta soprattutto di mostre e rassegne gia' cominciate risultava
 * spenta mentre la mappa la mostrava piena — misurato sul Postgres locale:
 * lazio 8 contro 37, emilia-romagna 10 contro 25, toscana 74 contro 158. Le
 * due regole ora sono la stessa regola, e il numero pubblicato e' il numero
 * che si vede.
 *
 * Il prezzo: il predicato su `date_end` non e' coperto da
 * `idx_events_region_date_start`. E' lo stesso prezzo che /api/events paga
 * gia' ad ogni richiesta, su un ordine di grandezza in piu' di righe lette.
 */
function availableWindow(windowStart: Date) {
  return [
    { dateEnd: { gte: windowStart } },
    { AND: [{ dateEnd: null }, { dateStart: { gte: windowStart } }] }
  ]
}

export async function getLiveRegions(): Promise<Set<string>> {
  const windowStart = coverageWindowStart()

  const rows = await prisma.event.groupBy({
    by: ['region'],
    where: {
      OR: availableWindow(windowStart),
      canonicalEventId: null,
      region: { not: null }
    },
    _count: { region: true }
  })

  return new Set(
    rows
      .filter((row) => row._count.region > COVERAGE_THRESHOLD)
      .map((row) => row.region as string)
  )
}

/**
 * Quattro codici provincia sardi (Fase 15, D-10, 15-RESEARCH.md Pitfall 4)
 * abitano ancora la tabella `comuni` per un debito di seed della Fase 6, ma
 * sono stati aboliti dalla riforma amministrativa del 2016 (fusi nella
 * provincia unica del Sud Sardegna, che pero' non e' mai stata seedata come
 * `province_code` a se'). Esclusi SOLO dalla pubblicazione: gli eventi dei
 * comuni di quelle province restano agganciati e visibili su mappa/ricerca,
 * l'aggancio comuneId non cambia. Nessuna pagina indicizzabile deve
 * affermare l'esistenza di una provincia che non esiste piu'.
 */
const ABOLISHED_PROVINCE_CODES = new Set(['OT', 'OG', 'VS', 'CI'])

/**
 * Una riga per ogni provincia amministrativa vigente, con lo slug regione e
 * lo slug provincia gia' calcolati (D-10: forma dello slug decisa come
 * `istatRegionToSlug(provinceName)`, letta e stampata, non la sigla — i 110
 * nomi provincia distinti sono stati verificati senza collisioni). Fonte
 * unica: sia `app/[regione]/[provincia]/page.tsx` (validazione a cascata:
 * provincia che non appartiene a QUELLA regione -> notFound()) sia
 * `app/sitemap.ts` leggono da qui, cosi' nessuno dei due ricostruisce la
 * corrispondenza slug<->codice per conto proprio.
 */
export interface ProvinceRef {
  provinceCode: string
  provinceName: string
  regionSlug: string
  provinceSlug: string
}

export async function getProvinceDirectory(): Promise<ProvinceRef[]> {
  const rows = await prisma.comune.findMany({
    distinct: ['provinceCode'],
    select: { provinceCode: true, provinceName: true, regionName: true },
    orderBy: { provinceCode: 'asc' }
  })

  return rows
    .filter((row) => !ABOLISHED_PROVINCE_CODES.has(row.provinceCode))
    .map((row) => ({
      provinceCode: row.provinceCode,
      provinceName: row.provinceName,
      regionSlug: istatRegionToSlug(row.regionName),
      provinceSlug: istatRegionToSlug(row.provinceName)
    }))
}

/**
 * `getLiveRegions()` un livello piu' sotto: STESSA `COVERAGE_THRESHOLD` e
 * STESSA finestra "in corso o futuro" (vedi availableWindow), non una
 * seconda costante ne' una seconda regola (D-10). Nessuna cache in processo, nessuna
 * materializzazione: una query ad ogni chiamata (D-04), un JOIN sull'indice
 * su `comune_id` invece di un secondo GROUP BY su `region` — gli eventi non
 * portano la provincia direttamente, solo `comune_id`, quindi la si legge
 * via `comuni.province_code`. Un evento senza `comune_id` (Pitfall di D-03:
 * il 34% degli eventi futuri ne era privo all'epoca) non ha una provincia
 * nota e resta fuori da questo conteggio — resta pero' dentro
 * `getLiveRegions()`, che non dipende da `comune_id`.
 */
export async function getLiveProvinces(): Promise<Set<string>> {
  const windowStart = coverageWindowStart()

  const rows = await prisma.$queryRaw<{ provinceCode: string; count: number }[]>`
    SELECT c.province_code AS "provinceCode", count(*)::int AS count
    FROM events e
    JOIN comuni c ON c.id = e.comune_id
    WHERE (e.date_end >= ${windowStart} OR (e.date_end IS NULL AND e.date_start >= ${windowStart}))
      AND e.canonical_event_id IS NULL
      AND e.comune_id IS NOT NULL
    GROUP BY c.province_code
  `

  return new Set(
    rows.filter((row) => row.count > COVERAGE_THRESHOLD).map((row) => row.provinceCode)
  )
}
