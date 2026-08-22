/**
 * Composizione a lettura dei campi di un evento fuso (Fase 10, D-13/DEDUP-04).
 *
 * Perche' a lettura e non materializzata: le colonne di sorgente restano
 * intatte per costruzione, quindi il principio "mai sovrascrivere il dato di
 * sorgente" della Fase 6 e' rispettato senza doverci pensare, e cambiare la
 * gerarchia di fiducia (SOURCE_REGISTRY[*].trustRank) non richiede nessun
 * backfill: il prossimo GET vede subito il nuovo ordine. Costo accettato: una
 * query in piu' in lettura, sui soli gruppi realmente fusi (vedi
 * groupMembersByCanonical() e i chiamanti in app/api/events/).
 */
import type { Event as PrismaEvent } from '@prisma/client'
import { SOURCE_REGISTRY } from '../scrapers/registry'

// Campi componibili: quelli su cui una sorgente puo' essere piu' o meno
// ricca di un'altra per lo STESSO evento. Esclusioni motivate:
// - `sourceUrl` resta accoppiato a `source` della riga canonica: comporlo
//   separatamente farebbe puntare il link "vai al sito" a una sorgente che la
//   riga non dichiara (T-10-13).
// - `dateStart`/`comuneId`/`resolvedLatitude`/`resolvedLongitude`/
//   `coordinateSource` sono le colonne su cui il gruppo e' stato costruito
//   (D-01..D-08) o che il backfill territoriale possiede (Fase 6): non sono
//   campi "di contenuto" componibili.
// - `id`/`source`/`sourceId`/`createdAt`/`updatedAt` e le tre colonne di
//   fusione (`canonicalEventId`/`mergeScore`/`mergeReason`) sono identita' e
//   contabilita' della riga, mai del "contenuto" dell'evento.
export const COMPOSABLE_FIELDS = [
  'title',
  'description',
  'imageUrl',
  'locationName',
  'address',
  'phone',
  'category'
] as const

type ComposableField = (typeof COMPOSABLE_FIELDS)[number]

/**
 * Legge la gerarchia di fiducia dal registry (unica dichiarazione, D-12).
 * Una sorgente non presente nel registry restituisce il valore meno
 * prioritario possibile: una sorgente non dichiarata non puo' mai vincere per
 * errore su una sorgente nota.
 */
export function trustRankFor(source: string): number {
  const entry = SOURCE_REGISTRY.find((s) => s.id === source)
  return entry ? entry.trustRank : Number.MAX_SAFE_INTEGER
}

// Vuoto significa null, undefined, stringa vuota o stringa di soli spazi: un
// `if (value)` scarterebbe anche uno `0` legittimo (nessun campo componibile
// e' numerico oggi, ma il test resta esplicito sul contenuto testuale, stesso
// spirito del controllo su null/undefined gia' in lib/serializeEvent.ts).
function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

/**
 * Raggruppa le righe membro per `canonicalEventId`, ogni lista ordinata per
 * `id` crescente: due ispezioni consecutive dello stesso gruppo mostrano
 * sempre lo stesso ordine.
 */
export function groupMembersByCanonical(members: PrismaEvent[]): Map<number, PrismaEvent[]> {
  const byCanonical = new Map<number, PrismaEvent[]>()
  for (const member of members) {
    if (member.canonicalEventId === null) continue
    const list = byCanonical.get(member.canonicalEventId)
    if (list) {
      list.push(member)
    } else {
      byCanonical.set(member.canonicalEventId, [member])
    }
  }
  for (const list of byCanonical.values()) {
    list.sort((a, b) => a.id - b.id)
  }
  return byCanonical
}

/**
 * Copia `source[key]` su `target[key]` se non vuoto, restituendo true se lo
 * ha fatto. Generica su `K extends ComposableField` (non sull'unione diretta
 * `ComposableField`) apposta: e' l'unico modo per cui TypeScript accetta
 * l'assegnazione `target[key] = value` senza un cast `any`, perche' lega il
 * tipo del valore letto a quello scritto tramite lo stesso parametro generico.
 */
function assignIfPresent<K extends ComposableField>(
  target: PrismaEvent,
  source: PrismaEvent,
  key: K
): boolean {
  const value = source[key]
  if (isEmpty(value)) return false
  target[key] = value
  return true
}

/**
 * Costruisce la versione "piu' ricca" di un evento fuso: per ciascun campo di
 * COMPOSABLE_FIELDS prende il primo valore non vuoto seguendo l'ordine
 * trustRank crescente (a parita', id crescente — la stessa regola che decide
 * la canonica, cosi' i due criteri non si contraddicono mai). I campi di
 * identita' e territoriali restano SEMPRE quelli della riga canonica.
 *
 * Non modifica ne' `canonical` ne' `members`: restituisce sempre un nuovo
 * oggetto. Con `members` vuoto restituisce un oggetto uguale alla canonica
 * campo per campo.
 */
export function composeEvent(canonical: PrismaEvent, members: PrismaEvent[]): PrismaEvent {
  const candidates = [canonical, ...members].slice().sort((a, b) => {
    const rankDiff = trustRankFor(a.source) - trustRankFor(b.source)
    if (rankDiff !== 0) return rankDiff
    return a.id - b.id
  })

  const composed: PrismaEvent = { ...canonical }

  for (const field of COMPOSABLE_FIELDS) {
    for (const candidate of candidates) {
      if (assignIfPresent(composed, candidate, field)) break
    }
  }

  return composed
}

// Self-check: `npx tsx lib/dedup/compose.ts`. Nessun accesso al database: il
// modulo e' puro e il suo self-check deve restare eseguibile senza container.
// Le fixture qui sotto sono oggetti costruiti a mano — nominare le tre
// sorgenti in QUESTA regione del file e' l'unico posto in cui e' permesso
// (il codice di produzione sopra le legge sempre da SOURCE_REGISTRY).
if (require.main === module) {
  const base: PrismaEvent = {
    id: 1,
    source: 'opendata_lombardia',
    sourceId: 'x1',
    title: 'Sagra del Gorgonzola',
    description: null,
    dateStart: new Date('2026-08-27T00:00:00Z'),
    dateEnd: null,
    locationName: 'Lomello',
    address: null,
    phone: null,
    latitude: null,
    longitude: null,
    category: 'sagra',
    sourceUrl: 'https://opendata.example/x1',
    imageUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    comuneId: 2372,
    resolvedLatitude: null,
    resolvedLongitude: null,
    coordinateSource: null,
    canonicalEventId: null,
    mergeScore: null,
    mergeReason: null
  } as unknown as PrismaEvent

  // trustRankFor: ordine dichiarato in SOURCE_REGISTRY.
  console.assert(
    trustRankFor('in-lombardia') < trustRankFor('opendata_lombardia'),
    'in-lombardia deve avere trustRank minore (piu' + " prioritario) di opendata_lombardia"
  )
  console.assert(
    trustRankFor('opendata_lombardia') < trustRankFor('solosagre'),
    'opendata_lombardia deve avere trustRank minore di solosagre'
  )
  console.assert(
    trustRankFor('sorgente-sconosciuta') === Number.MAX_SAFE_INTEGER,
    'una sorgente non dichiarata deve avere il rango meno prioritario possibile'
  )

  // composeEvent(canonica, []) === canonica campo per campo.
  const noMembers = composeEvent(base, [])
  for (const field of COMPOSABLE_FIELDS) {
    console.assert(
      noMembers[field] === base[field],
      `composeEvent senza membri deve lasciare invariato il campo ${field}`
    )
  }

  // Membro piu' fidato con description valorizzata, canonica con description null -> vince il membro.
  const memberInLombardia: PrismaEvent = {
    ...base,
    id: 2,
    source: 'in-lombardia',
    description: 'Descrizione ricca da in-lombardia',
    imageUrl: 'https://in-lombardia.example/img.jpg'
  }
  const composedWithRicherMember = composeEvent(base, [memberInLombardia])
  console.assert(
    composedWithRicherMember.description === 'Descrizione ricca da in-lombardia',
    'la description del membro piu' + " fidato deve vincere quando la canonica e' vuota"
  )

  // Entrambi valorizzati -> vince trustRank piu' basso, non l'ordine di arrivo.
  const canonicalWithDescription: PrismaEvent = {
    ...base,
    description: 'Descrizione opendata (meno fidata)'
  }
  const composedTiebreak = composeEvent(canonicalWithDescription, [memberInLombardia])
  console.assert(
    composedTiebreak.description === 'Descrizione ricca da in-lombardia',
    'a parita' + " di campi valorizzati vince il trustRank piu' basso, non la canonica per default"
  )

  // Valore di soli spazi conta come vuoto e viene saltato.
  const memberBlank: PrismaEvent = {
    ...base,
    id: 3,
    source: 'in-lombardia',
    description: '   '
  }
  const composedBlankSkipped = composeEvent(canonicalWithDescription, [memberBlank])
  console.assert(
    composedBlankSkipped.description === 'Descrizione opendata (meno fidata)',
    'un valore di soli spazi deve essere trattato come vuoto e saltato'
  )

  // A parita' di trustRank, vince l'id piu' basso.
  const memberSameRankLowerId: PrismaEvent = {
    ...base,
    id: 0,
    source: 'opendata_lombardia',
    description: 'Descrizione id piu' + ' basso'
  }
  const composedSameRank = composeEvent(canonicalWithDescription, [memberSameRankLowerId])
  console.assert(
    composedSameRank.description === 'Descrizione id piu' + ' basso',
    "a parita' di trustRank deve vincere l'id piu' basso"
  )

  // Nessuna mutazione di canonica ne' membri.
  const canonicalCopy = { ...canonicalWithDescription }
  const memberCopy = { ...memberInLombardia }
  composeEvent(canonicalWithDescription, [memberInLombardia])
  console.assert(
    JSON.stringify(canonicalWithDescription) === JSON.stringify(canonicalCopy),
    'composeEvent non deve mutare la riga canonica passata in ingresso'
  )
  console.assert(
    JSON.stringify(memberInLombardia) === JSON.stringify(memberCopy),
    'composeEvent non deve mutare i membri passati in ingresso'
  )

  // Campi di identita' e territoriali restano SEMPRE della canonica.
  const memberDifferentIdentity: PrismaEvent = {
    ...base,
    id: 99,
    source: 'in-lombardia',
    sourceId: 'diverso',
    sourceUrl: 'https://in-lombardia.example/altro',
    dateStart: new Date('2099-01-01T00:00:00Z'),
    comuneId: 1,
    canonicalEventId: 1,
    mergeScore: 0.9,
    mergeReason: 'trgm=0.90;comune=2372;date=2026-08-27'
  }
  const composedIdentity = composeEvent(base, [memberDifferentIdentity])
  console.assert(
    composedIdentity.id === base.id &&
      composedIdentity.source === base.source &&
      composedIdentity.sourceId === base.sourceId &&
      composedIdentity.sourceUrl === base.sourceUrl &&
      composedIdentity.dateStart.getTime() === base.dateStart.getTime() &&
      composedIdentity.comuneId === base.comuneId &&
      composedIdentity.canonicalEventId === base.canonicalEventId &&
      composedIdentity.mergeScore === base.mergeScore &&
      composedIdentity.mergeReason === base.mergeReason,
    "i campi di identita' e territoriali devono restare quelli della canonica"
  )

  // groupMembersByCanonical: ordinamento per id crescente entro ogni gruppo.
  const groupMembers: PrismaEvent[] = [
    { ...base, id: 5, canonicalEventId: 1 },
    { ...base, id: 3, canonicalEventId: 1 },
    { ...base, id: 4, canonicalEventId: 2 }
  ]
  const grouped = groupMembersByCanonical(groupMembers)
  console.assert(
    JSON.stringify(grouped.get(1)?.map((m) => m.id)) === JSON.stringify([3, 5]),
    "groupMembersByCanonical deve ordinare i membri di ogni gruppo per id crescente, ottenuto: " +
      JSON.stringify(grouped.get(1)?.map((m) => m.id))
  )
  console.assert(
    JSON.stringify(grouped.get(2)?.map((m) => m.id)) === JSON.stringify([4]),
    'groupMembersByCanonical deve separare correttamente i gruppi diversi'
  )

  console.log('[compose.ts] self-check OK')
}
