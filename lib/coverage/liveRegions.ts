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

/**
 * Misurato dal vivo sul Postgres locale il 2026-09-17 (comando:
 * `SELECT region, count(*) FROM events WHERE date_start >= now() AND
 * canonical_event_id IS NULL GROUP BY region`): l'unica regione con dati
 * oggi, Lombardia, ne ha 1.806. Nessun secondo punto dati esiste ancora per
 * calibrare un vero taglio — Emilia-Romagna e Puglia (D-14) non sono
 * ancora state ingerite. 0 e' l'unico valore che oggi non esclude
 * arbitrariamente una regione appena accesa con pochi eventi reali: "viva"
 * equivale per ora a "almeno un evento futuro canonico". Il piano
 * 15-03-PLAN.md ri-misura questa costante sui volumi reali di
 * Emilia-Romagna e Puglia una volta ingerite (15-RESEARCH.md Open
 * Question 3) — non stimare un numero piu' alto qui prima di allora.
 */
export const COVERAGE_THRESHOLD = 0

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
