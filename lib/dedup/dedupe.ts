/**
 * Deduplica cross-sorgente (Fase 10, D-01..D-08).
 *
 * Perche' il ricalcolo e' completo a ogni esecuzione: le componenti connesse
 * sono una proprieta' indipendente dall'ordine in cui gli archi vengono
 * elaborati (D-02), gli id sono autoincrementanti e nessuna riga viene mai
 * cancellata (D-05), quindi il MIN(id) di una componente non puo' che restare
 * stabile fra un'esecuzione e la successiva — una fusione gia' assegnata non
 * cambia mai canonica. Questo e' cio' che rende sicuro ripassare su TUTTI gli
 * eventi a ogni scrape invece di limitarsi ai soli eventi nuovi.
 *
 * Perche' si scrive solo sul diff: una `update()` incondizionata toccherebbe
 * `updatedAt` (`@updatedAt`) anche a parita' di valori, e la seconda
 * esecuzione smetterebbe di essere un no-op osservabile (DEDUP-06). Stesso
 * principio gia' applicato in `lib/territorial/backfill.ts`.
 *
 * Grammatica di `merge_reason` (dichiarata una volta sola, qui, e mai
 * duplicata altrove): la stringa scritta su una riga MEMBRO e'
 * `exact;comune=<comuneId>;date=<YYYY-MM-DD>` (gradino 1, 10-02) oppure
 * `trgm=<score arrotondato a 2 decimali>;comune=<comuneId>;date=<YYYY-MM-DD>`
 * (gradino 2, pg_trgm, questo piano); la stringa scritta su una riga senza
 * comune e' esattamente `no_geo`, senza suffissi — cosi' la metrica di D-07 e'
 * contabile con `WHERE merge_reason = 'no_geo'`, una query sola; ogni altra
 * riga ha `merge_reason` null.
 */
import { prisma } from '../prisma'
import { updateClusterCache } from '../clusterCache'
import { normalizeTitle } from './normalizeTitle'
import { MAX_BUCKET_SIZE, TITLE_SIMILARITY_THRESHOLD } from './config'

export type MatchInput = {
  id: number
  title: string
  comuneId: number | null
  dateStart: Date
}

export type MatchVerdict = {
  merge: boolean
  score: number | null
  reason: string
}

export type DedupReport = {
  scanned: number
  buckets: number
  bucketsSkipped: number
  pairsEvaluated: number
  groups: number
  merged: number
  updated: number
  unchanged: number
  noGeo: number
  byReason: Record<string, number>
  clusterFeatureCount: number
}

const BATCH_SIZE = 5 // stesso vincolo di connection pool documentato in lib/scrapers/utils.ts (limite 9)

function dayUTC(date: Date): string {
  // UTC, non ora locale del processo (D-06): il Postgres locale gira in UTC e
  // con l'ora locale il confine "stesso giorno" si sfaserebbe di 1-2 ore a
  // seconda dell'ora legale — lo stesso errore gia' corretto in lib/clusterCache.ts.
  return date.toISOString().slice(0, 10)
}

/**
 * Confronta due eventi e decide se rappresentano la stessa occorrenza fisica.
 * Asincrona fin da ora, anche se in questo piano non esegue nessuna query:
 * 10-03 le aggiunge il gradino `pg_trgm` (una query parametrizzata via
 * `$queryRaw`, mai concatenazione di stringhe, T-10-01) senza cambiare la firma.
 *
 * Ordine dei controlli, ognuno con un `reason` distinto e mai sovrapposto:
 * 1. comuneId nullo su uno dei due lati -> 'no_geo' (D-07): senza prossimita'
 *    verificabile la condizione congiunta di DEDUP-02 non e' mai soddisfatta,
 *    a prescindere da quanto sia simile il titolo.
 * 2. comuneId diversi -> 'different_comune' (D-05): mai una distanza in km.
 * 3. giorno UTC di dateStart diverso -> 'different_date' (D-06): giorno
 *    esatto, nessuna tolleranza di ±1 e nessuna sovrapposizione di intervalli
 *    (dateEnd e' nullable e fonderebbe una sagra intera con la sua terza
 *    serata).
 * 4. normalizeTitle dei due titoli non vuoto e identico -> 'exact', score 1
 *    (D-08 gradino 1). Due titoli che normalizzano entrambi a stringa vuota
 *    non producono MAI un match: l'uguaglianza fra due stringhe vuote non e'
 *    un'uguaglianza di titolo.
 * 5. gradino 2 (pg_trgm, questo piano): se uno dei due titoli normalizzati e'
 *    stringa vuota -> 'not_comparable', nessuna query (un titolo non
 *    normalizzabile non e' confrontabile). Altrimenti si interroga
 *    `similarity()` sui titoli NORMALIZZATI (non i titoli grezzi: il gradino 2
 *    eredita la stessa insensibilita' a maiuscole/diacritici del gradino 1) e
 *    si confronta con `TITLE_SIMILARITY_THRESHOLD` (lib/dedup/config.ts, unica
 *    sorgente del numero — il gradino 1 non lo legge mai, D-09). `score` porta
 *    sempre il valore misurato, anche quando non basta a fondere: serve a
 *    diagnosticare una coppia rimasta appena sotto senza rieseguire
 *    l'algoritmo.
 */
export async function matchPair(a: MatchInput, b: MatchInput): Promise<MatchVerdict> {
  if (a.comuneId === null || b.comuneId === null) {
    return { merge: false, score: null, reason: 'no_geo' }
  }

  if (a.comuneId !== b.comuneId) {
    return { merge: false, score: null, reason: 'different_comune' }
  }

  if (dayUTC(a.dateStart) !== dayUTC(b.dateStart)) {
    return { merge: false, score: null, reason: 'different_date' }
  }

  const titleA = normalizeTitle(a.title)
  const titleB = normalizeTitle(b.title)
  if (titleA !== '' && titleA === titleB) {
    return { merge: true, score: 1, reason: 'exact' }
  }

  if (titleA === '' || titleB === '') {
    return { merge: false, score: null, reason: 'not_comparable' }
  }

  // Tagged template -> query parametrizzata dal driver, mai concatenazione di
  // stringhe (T-10-01, stesso idioma gia' applicato in
  // app/api/events/route.ts per il parsing delle citta').
  const rows = await prisma.$queryRaw<{ sim: number }[]>`
    SELECT similarity(${titleA}, ${titleB}) AS sim
  `
  const sim = rows[0]?.sim ?? 0

  if (sim >= TITLE_SIMILARITY_THRESHOLD) {
    return { merge: true, score: sim, reason: `trgm=${sim.toFixed(2)}` }
  }
  return { merge: false, score: sim, reason: 'below_threshold' }
}

/**
 * Union-find (disjoint-set) scritto a mano, path compression, nessuna
 * libreria di grafi — stesso spirito con cui lib/territorial/distance.ts
 * implementa haversine a mano.
 *
 * L'unione va SEMPRE verso l'id piu' basso (Math.min fra le due radici): cosi'
 * la radice di ogni componente converge naturalmente al MIN(id), che e'
 * esattamente la regola di canonicita' di D-02, e non serve nessuna passata
 * separata "trova il minimo per gruppo". Le componenti connesse risultanti
 * sono indipendenti dall'ordine in cui union() viene chiamata.
 */
class DisjointSet {
  private parent = new Map<number, number>()

  private ensure(id: number): number {
    if (!this.parent.has(id)) this.parent.set(id, id)
    return id
  }

  find(id: number): number {
    this.ensure(id)
    let root = id
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!
    }
    // Path compression: ripiega ogni nodo attraversato direttamente sulla radice.
    let cur = id
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!
      this.parent.set(cur, root)
      cur = next
    }
    return root
  }

  union(a: number, b: number): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return
    const lower = Math.min(rootA, rootB)
    const higher = Math.max(rootA, rootB)
    this.parent.set(higher, lower)
  }

  // true solo se il nodo e' mai stato toccato da un union/find precedente.
  has(id: number): boolean {
    return this.parent.has(id)
  }
}

type BestVerdict = { score: number; otherId: number; reason: string }

/**
 * A parita' di piu' archi che coinvolgono lo stesso nodo, tiene il verdetto
 * con score piu' alto e, a parita' di score, quello con l'altro id piu' basso
 * — cosi' l'esito e' deterministico indipendentemente dall'ordine di
 * valutazione delle coppie (D-02).
 */
function considerBestVerdict(
  best: Map<number, BestVerdict>,
  nodeId: number,
  otherId: number,
  score: number,
  reason: string
): void {
  const current = best.get(nodeId)
  if (
    !current ||
    score > current.score ||
    (score === current.score && otherId < current.otherId)
  ) {
    best.set(nodeId, { score, otherId, reason })
  }
}

export async function dedupeEvents(): Promise<DedupReport> {
  const events = await prisma.event.findMany({
    select: {
      id: true,
      title: true,
      comuneId: true,
      dateStart: true,
      canonicalEventId: true,
      mergeScore: true,
      mergeReason: true,
    },
  })

  const report: DedupReport = {
    scanned: events.length,
    buckets: 0,
    bucketsSkipped: 0,
    pairsEvaluated: 0,
    groups: 0,
    merged: 0,
    updated: 0,
    unchanged: 0,
    noGeo: 0,
    byReason: {},
    clusterFeatureCount: 0,
  }

  // 2. Bucket in memoria per chiave `${comuneId}|${giornoUTC}`. Le righe con
  // comuneId null non entrano in nessun bucket: ricevono 'no_geo' al passo 5.
  const buckets = new Map<string, MatchInput[]>()
  for (const event of events) {
    if (event.comuneId === null) continue
    const key = `${event.comuneId}|${dayUTC(event.dateStart)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(event)
    else buckets.set(key, [event])
  }
  report.buckets = buckets.size

  const disjointSet = new DisjointSet()
  const bestVerdictFor = new Map<number, BestVerdict>()

  // 3. Per ogni bucket, tutte le coppie non ordinate; matchPair su ciascuna;
  // ogni verdetto merge:true diventa un arco.
  for (const bucket of buckets.values()) {
    if (bucket.length > MAX_BUCKET_SIZE) {
      report.bucketsSkipped++
      console.warn(
        `[Dedup] bucket saltato per dimensione (${bucket.length} > ${MAX_BUCKET_SIZE}): ${bucket[0].comuneId}|${dayUTC(bucket[0].dateStart)}`
      )
      continue
    }

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]
        const b = bucket[j]
        const verdict = await matchPair(a, b)
        report.pairsEvaluated++
        // Chiave di statistica normalizzata: 'trgm=0.87' e 'trgm=0.91' sono lo
        // stesso motivo ai fini del conteggio aggregato, il punteggio esatto
        // vive gia' per intero in merge_reason sulla riga del database.
        const reasonKey = verdict.reason.split('=')[0]
        report.byReason[reasonKey] = (report.byReason[reasonKey] ?? 0) + 1

        if (verdict.merge && verdict.score !== null) {
          disjointSet.union(a.id, b.id)
          considerBestVerdict(bestVerdictFor, a.id, b.id, verdict.score, verdict.reason)
          considerBestVerdict(bestVerdictFor, b.id, a.id, verdict.score, verdict.reason)
        }
      }
    }
  }

  // 5. Stato atteso, riga per riga (vedi header per la grammatica di merge_reason).
  type TargetState = { canonicalEventId: number | null; mergeScore: number | null; mergeReason: string | null }
  const targets = new Map<number, TargetState>()
  const membersPerRoot = new Map<number, number>()

  for (const event of events) {
    if (event.comuneId === null) {
      targets.set(event.id, { canonicalEventId: null, mergeScore: null, mergeReason: 'no_geo' })
      report.noGeo++
      continue
    }

    const root = disjointSet.has(event.id) ? disjointSet.find(event.id) : event.id

    if (root === event.id) {
      // Radice del proprio gruppo (o riga mai valutata come duplicato): tutte e tre le colonne null.
      targets.set(event.id, { canonicalEventId: null, mergeScore: null, mergeReason: null })
    } else {
      const best = bestVerdictFor.get(event.id)!
      targets.set(event.id, {
        canonicalEventId: root,
        mergeScore: best.score,
        mergeReason: `${best.reason};comune=${event.comuneId};date=${dayUTC(event.dateStart)}`,
      })
      membersPerRoot.set(root, (membersPerRoot.get(root) ?? 0) + 1)
    }
  }

  report.groups = membersPerRoot.size
  report.merged = [...membersPerRoot.values()].reduce((sum, n) => sum + n, 0)

  // 6. Scrittura in batch da 5, solo sul diff: nessuna colonna di sorgente
  // compare mai in `data`.
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async event => {
        const target = targets.get(event.id)!
        const unchanged =
          event.canonicalEventId === target.canonicalEventId &&
          event.mergeScore === target.mergeScore &&
          event.mergeReason === target.mergeReason

        if (!unchanged) {
          await prisma.event.update({
            where: { id: event.id },
            data: {
              canonicalEventId: target.canonicalEventId,
              mergeScore: target.mergeScore,
              mergeReason: target.mergeReason,
            },
          })
        }

        return unchanged
      })
    )

    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
      if (result.value) report.unchanged++
      else report.updated++
    }
  }

  // 7. updateClusterCache() in coda: senza, un evento appena fuso resta un pin
  // doppio sulla mappa finche' non arriva il prossimo trigger naturale della
  // cache (stesso Pitfall 4 gia' documentato per il backfill territoriale).
  await updateClusterCache()
  const cache = await prisma.mapClusterCache.findUnique({ where: { id: 'default' } })
  report.clusterFeatureCount = cache?.eventCount ?? 0

  return report
}
