/**
 * Batch size unico, derivato dal `connection_limit` reale (D-16, SCHED-04).
 *
 * Prima di questa fase il batch size (5) era scritto a mano in tre file
 * (`lib/scrapers/utils.ts`, `lib/territorial/backfill.ts`,
 * `lib/dedup/dedupe.ts`) con un commento "limite pool: 9" mai verificato
 * contro il valore reale di `connection_limit`. Questo file e' l'unico
 * punto che deriva il numero — i tre consumatori lo importano, non lo
 * ridichiarano.
 *
 * Nessun import di Prisma qui: il file resta puro e sincrono, leggibile da
 * un self-check senza toccare il database (stesso spirito di
 * `lib/scrapers/health.ts`).
 */

// Fallback dichiarato: NON viene ricalcolato da `os.cpus()` perche' in un
// container Docker `os.cpus().length` ignora i limiti cgroup e riporta le
// CPU dell'HOST, non quelle assegnate al container (nodejs/node#28762). Se
// in futuro `DATABASE_URL` smette di dichiarare `connection_limit`, questo
// valore va aggiornato A MANO, QUI E IN NESSUN ALTRO PUNTO, confrontandolo
// con quanto osservato in produzione (vedi user_setup di 14-05-PLAN.md) —
// non lasciato "intelligente" e silenziosamente sbagliato il giorno in cui
// qualcuno aggiunge un limite CPU al container.
export const FALLBACK_CONNECTION_LIMIT = 5

/**
 * Legge `connection_limit` dalla `DATABASE_URL`. Nessuna eccezione mai
 * propagata: URL assente, vuota, malformata, o con un valore non
 * intero/negativo/zero restituiscono tutte il fallback dichiarato sopra —
 * mai `NaN`, mai 0, mai un numero negativo che renderebbe un ciclo di batch
 * infinito.
 */
export function getConnectionLimit(databaseUrl = process.env.DATABASE_URL ?? ''): number {
  try {
    const url = new URL(databaseUrl)
    const raw = url.searchParams.get('connection_limit')
    const parsed = raw ? parseInt(raw, 10) : NaN
    return Number.isInteger(parsed) && parsed > 0 ? parsed : FALLBACK_CONNECTION_LIMIT
  } catch {
    return FALLBACK_CONNECTION_LIMIT
  }
}

// Margine di sicurezza sotto il limite reale: con D-05 i tre consumatori
// (lib/scrapers/utils.ts, lib/territorial/backfill.ts, lib/dedup/dedupe.ts)
// non girano piu' insieme (il job consolidato e' separato dallo scrape),
// quindi il budget non va piu' diviso in tre come il vecchio commento
// "limite 9", mai verificato, lasciava intendere.
export const PRISMA_BATCH_SIZE = Math.max(1, getConnectionLimit() - 1)

// Self-check minimale, idioma di lib/scrapers/health.ts: `npx tsx lib/scrapers/connectionLimit.ts`.
// Non un framework di test, solo un demo() con assert che fallisce
// rumorosamente se il parsing o il ramo di riserva si rompono.
//
// La guardia a tre condizioni non e' difensiva a vuoto, e' obbligatoria qui:
// questo modulo FINISCE nel bundle del browser. La catena e'
// app/HomeClient.tsx ('use client') -> lib/categories/taxonomy.ts ->
// lib/scrapers/registry.ts -> lib/scrapers/solosagre.ts ->
// lib/scrapers/utils.ts -> questo file. Nel bundle browser `module` non
// esiste, quindi `require.main === module` da solo esplode con "module is not
// defined" alla valutazione del modulo — prima che la pagina renda una sola
// riga. Stesso idioma gia' usato in lib/eventStatus.ts, lib/dateWindow.ts,
// lib/pagination.ts, lib/eventOrdering.ts e lib/territorial/distance.ts, tutti
// con lo stesso commento: e' la convenzione del progetto, non una variante.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  console.assert(
    getConnectionLimit('postgresql://u:p@host:5432/db?connection_limit=9') === 9,
    'atteso 9 con ?connection_limit=9'
  )
  console.assert(
    getConnectionLimit('postgresql://u:p@host:5432/db?connection_limit=1') === 1,
    'atteso 1 con ?connection_limit=1'
  )
  console.assert(
    getConnectionLimit('postgresql://u:p@host:5432/db') === FALLBACK_CONNECTION_LIMIT,
    'atteso il valore di riserva senza connection_limit nella URL'
  )
  console.assert(
    getConnectionLimit('postgresql://u:p@host:5432/db?connection_limit=abc') === FALLBACK_CONNECTION_LIMIT,
    'atteso il valore di riserva con connection_limit non intero'
  )
  console.assert(
    getConnectionLimit('postgresql://u:p@host:5432/db?connection_limit=-3') === FALLBACK_CONNECTION_LIMIT,
    'atteso il valore di riserva con connection_limit negativo'
  )
  console.assert(
    getConnectionLimit('postgresql://u:p@host:5432/db?connection_limit=0') === FALLBACK_CONNECTION_LIMIT,
    'atteso il valore di riserva con connection_limit zero'
  )
  console.assert(
    getConnectionLimit('') === FALLBACK_CONNECTION_LIMIT,
    'atteso il valore di riserva su stringa vuota'
  )
  console.assert(
    getConnectionLimit('non-e-una-url-valida') === FALLBACK_CONNECTION_LIMIT,
    'atteso il valore di riserva su URL malformata, senza eccezione propagata'
  )
  console.assert(
    Number.isInteger(PRISMA_BATCH_SIZE) && PRISMA_BATCH_SIZE >= 1,
    'PRISMA_BATCH_SIZE deve essere sempre un intero >= 1'
  )

  console.log('[connectionLimit.ts] self-check OK')
}
