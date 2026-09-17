/**
 * Segnale unico di copertura (Fase 15, ROLL-03, D-01/D-02/D-04).
 *
 * Una regione e' "viva" se ha piu' di COVERAGE_THRESHOLD eventi futuri
 * canonici. Nessuna cache in processo, nessuna materializzazione notturna:
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

/**
 * Ri-misurato dal vivo sul Postgres locale il 2026-09-17, DOPO l'ingestione
 * di Emilia-Romagna e Puglia (15-03-PLAN.md, comando: `SELECT region,
 * count(*) FROM events WHERE date_start >= now() AND canonical_event_id IS
 * NULL GROUP BY region`):
 *
 *   lombardia:       1.806 eventi futuri canonici
 *   emilia-romagna:      6 eventi futuri canonici (bash scripts/dev-db.sh
 *                        npx tsx -e "runRegion('emilia-romagna')", dati reali)
 *   puglia:              0 — non ingerita: l'host resta bloccato dal difetto
 *                        TLS verificato in 15-RESEARCH.md Pitfall 2 e
 *                        riverificato in questa sessione (identico
 *                        UNABLE_TO_VERIFY_LEAF_SIGNATURE), non un problema di
 *                        questa fase (T-15-02 vieta di aggirarlo)
 *
 * Emilia-Romagna, la piu' povera fra le regioni EFFETTIVAMENTE ingerite oggi,
 * ha 6 eventi futuri. 2 sta abbondantemente sotto quel numero (un terzo) e
 * abbondantemente sopra una manciata di righe residue — una manciata di
 * eventi finiti in una regione per un errore di aggancio non deve mai
 * sembrare una sorgente viva. Nessuna isteresi, nessuna finestra di grazia
 * (D-02): una regione con esattamente 2 eventi futuri NON e' viva, con 3 lo
 * e'. Puglia resta a 0 e quindi fuori da getLiveRegions() finche' l'host non
 * torna raggiungibile — non e' un difetto di questa costante, e' il segnale
 * che funziona esattamente come D-01 lo vuole: una sorgente morta si spegne
 * da sola.
 */
export const COVERAGE_THRESHOLD = 2

export async function getLiveRegions(): Promise<Set<string>> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const rows = await prisma.event.groupBy({
    by: ['region'],
    where: { dateStart: { gte: today }, canonicalEventId: null, region: { not: null } },
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
 * `getLiveRegions()` un livello piu' sotto: STESSA `COVERAGE_THRESHOLD`, non
 * una seconda costante (D-10). Nessuna cache in processo, nessuna
 * materializzazione: una query ad ogni chiamata (D-04), un JOIN sull'indice
 * su `comune_id` invece di un secondo GROUP BY su `region` — gli eventi non
 * portano la provincia direttamente, solo `comune_id`, quindi la si legge
 * via `comuni.province_code`. Un evento senza `comune_id` (Pitfall di D-03:
 * il 34% degli eventi futuri ne era privo all'epoca) non ha una provincia
 * nota e resta fuori da questo conteggio — resta pero' dentro
 * `getLiveRegions()`, che non dipende da `comune_id`.
 */
export async function getLiveProvinces(): Promise<Set<string>> {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const rows = await prisma.$queryRaw<{ provinceCode: string; count: number }[]>`
    SELECT c.province_code AS "provinceCode", count(*)::int AS count
    FROM events e
    JOIN comuni c ON c.id = e.comune_id
    WHERE e.date_start >= ${today}
      AND e.canonical_event_id IS NULL
      AND e.comune_id IS NOT NULL
    GROUP BY c.province_code
  `

  return new Set(
    rows.filter((row) => row.count > COVERAGE_THRESHOLD).map((row) => row.provinceCode)
  )
}
