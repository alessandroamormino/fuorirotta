/**
 * Cascata di matching locationName -> Comune (D-05): match esatto, poi
 * normalizzato. Nessun fuzzy matching: un aggancio per similarita' e'
 * indistinguibile da uno corretto guardando il risultato ("Castel San
 * Giovanni" e "Castel San Pietro" distano pochissimo per similarita'), quindi
 * un mismatch entrerebbe nel database senza lasciare traccia. Alias e
 * disambiguazione degli omonimi per distanza/regione (D-07) arrivano in
 * 06-02: qui la cascata si ferma al gradino 'normalized', mai a
 * 'ambiguous'/'homonym_*'.
 *
 * Nessun import di Prisma: riceve i comuni gia' letti dal chiamante e
 * restituisce un esito puro. La lettura dal database resta responsabilita'
 * del chiamante.
 */
import { normalizeComuneName } from './normalize'

export type ComuneRow = {
  id: number
  istatCode: string
  name: string
  aliases: string[]
  provinceCode: string
  provinceName: string
  regionCode: string
  regionName: string
  latitude: number | null
  longitude: number | null
}

// 06-02 aggiunge 'alias', 'homonym_distance', 'homonym_region', 'ambiguous'.
export type MatchStep = 'exact' | 'normalized' | 'unmatched' | 'no_input'

export type ResolveInput = {
  locationName: string | null
  address: string | null
  source: string
  latitude: number | null
  longitude: number | null
}

export type ResolveOutcome = {
  comuneId: number | null
  matchStep: MatchStep
  candidateName: string | null
  latitude: number | null
  longitude: number | null
  coordinateSource: 'source' | 'comune_centroid' | null
}

export type ComuneIndex = {
  byExactName: Map<string, ComuneRow>
  // Nome normalizzato -> lista di candidati: piu' di un candidato per la stessa
  // chiave e' un omonimo (es. Livo CO / Livo TN), disambiguato in 06-02 senza
  // cambiare questa firma.
  byNormalizedName: Map<string, ComuneRow[]>
}

export function buildComuneIndex(comuni: ComuneRow[]): ComuneIndex {
  const byExactName = new Map<string, ComuneRow>()
  const byNormalizedName = new Map<string, ComuneRow[]>()

  for (const comune of comuni) {
    byExactName.set(comune.name, comune)

    const normalized = normalizeComuneName(comune.name)
    const bucket = byNormalizedName.get(normalized)
    if (bucket) {
      bucket.push(comune)
    } else {
      byNormalizedName.set(normalized, [comune])
    }
  }

  return { byExactName, byNormalizedName }
}

/**
 * Coordinate risolte secondo D-09/D-14: la sorgente, quando presente, vince
 * sempre e non viene mai sostituita dal centroide. Il centroide si applica
 * solo in assenza di coordinate di sorgente e solo se il comune risolto ne ha
 * uno (un comune senza punto resta agganciabile ma non produce centroide).
 */
function coordinatesFor(
  input: ResolveInput,
  comune: ComuneRow | null
): Pick<ResolveOutcome, 'latitude' | 'longitude' | 'coordinateSource'> {
  if (input.latitude !== null && input.longitude !== null) {
    return { latitude: input.latitude, longitude: input.longitude, coordinateSource: 'source' }
  }
  if (comune && comune.latitude !== null && comune.longitude !== null) {
    return { latitude: comune.latitude, longitude: comune.longitude, coordinateSource: 'comune_centroid' }
  }
  return { latitude: null, longitude: null, coordinateSource: null }
}

export function resolveComune(input: ResolveInput, index: ComuneIndex): ResolveOutcome {
  const name = input.locationName?.trim() || ''

  if (!name) {
    // Distinto da 'unmatched' (D-16): qui la sorgente non ha dato un nome,
    // non e' un nome cercato e non risolto.
    return { comuneId: null, matchStep: 'no_input', candidateName: null, ...coordinatesFor(input, null) }
  }

  // Gradino 1: match esatto sul nome ufficiale del comune.
  const exact = index.byExactName.get(name)
  if (exact) {
    return { comuneId: exact.id, matchStep: 'exact', candidateName: name, ...coordinatesFor(input, exact) }
  }

  // Gradino 2: match sul nome normalizzato (minuscole, accenti, punteggiatura, Sant'/S.).
  const normalized = normalizeComuneName(name)
  const candidates = index.byNormalizedName.get(normalized)
  if (candidates && candidates.length === 1) {
    const comune = candidates[0]
    return { comuneId: comune.id, matchStep: 'normalized', candidateName: name, ...coordinatesFor(input, comune) }
  }
  // candidates.length > 1 e' un omonimo: nessuna disambiguazione qui (06-02),
  // resta non risolto piuttosto che indovinare.

  return { comuneId: null, matchStep: 'unmatched', candidateName: name, ...coordinatesFor(input, null) }
}

// Self-check: `npx tsx lib/territorial/resolve.ts`.
// Non un framework di test, solo un demo() con assert che fallisce rumorosamente.
if (require.main === module) {
  const milano: ComuneRow = {
    id: 1,
    istatCode: '015146',
    name: 'Milano',
    aliases: [],
    provinceCode: 'MI',
    provinceName: 'Milano',
    regionCode: '03',
    regionName: 'Lombardia',
    latitude: 45.4642,
    longitude: 9.19,
  }
  const bergamo: ComuneRow = {
    id: 2,
    istatCode: '016024',
    name: 'Bergamo',
    aliases: [],
    provinceCode: 'BG',
    provinceName: 'Bergamo',
    regionCode: '03',
    regionName: 'Lombardia',
    latitude: 45.6983,
    longitude: 9.6773,
  }
  const senzaCentroide: ComuneRow = {
    id: 3,
    istatCode: '999999',
    name: 'Senza Centroide',
    aliases: [],
    provinceCode: 'XX',
    provinceName: 'Test',
    regionCode: '00',
    regionName: 'Test',
    latitude: null,
    longitude: null,
  }
  const index = buildComuneIndex([milano, bergamo, senzaCentroide])
  const base = { address: null as string | null, source: 'test' }

  // Gradino 'exact'
  const exact = resolveComune({ ...base, locationName: 'Milano', latitude: null, longitude: null }, index)
  console.assert(exact.matchStep === 'exact' && exact.comuneId === 1, "atteso match esatto su 'Milano'")
  console.assert(
    exact.coordinateSource === 'comune_centroid' && exact.latitude === 45.4642,
    'atteso centroide di Milano quando manca la coordinata di sorgente'
  )

  // Gradino 'normalized'
  const normalized = resolveComune({ ...base, locationName: 'MILANO', latitude: null, longitude: null }, index)
  console.assert(normalized.matchStep === 'normalized' && normalized.comuneId === 1, "atteso match normalizzato su 'MILANO'")

  // 'unmatched'
  const unmatched = resolveComune({ ...base, locationName: 'Comune Inesistente', latitude: null, longitude: null }, index)
  console.assert(unmatched.matchStep === 'unmatched' && unmatched.comuneId === null, 'atteso unmatched su nome sconosciuto')

  // 'no_input' — distinto da 'unmatched'
  const noInputNull = resolveComune({ ...base, locationName: null, latitude: null, longitude: null }, index)
  console.assert(noInputNull.matchStep === 'no_input' && noInputNull.comuneId === null, 'atteso no_input su locationName nullo')
  const noInputEmpty = resolveComune({ ...base, locationName: '', latitude: null, longitude: null }, index)
  console.assert(noInputEmpty.matchStep === 'no_input', 'atteso no_input su locationName vuoto')

  // Coordinate di sorgente vincono sempre sul centroide
  const withSource = resolveComune({ ...base, locationName: 'Bergamo', latitude: 45.7, longitude: 9.7 }, index)
  console.assert(
    withSource.coordinateSource === 'source' && withSource.latitude === 45.7,
    'le coordinate di sorgente devono vincere sul centroide'
  )

  // Comune risolto ma senza centroide -> nessuna coordinata prodotta
  const noCentroid = resolveComune({ ...base, locationName: 'Senza Centroide', latitude: null, longitude: null }, index)
  console.assert(
    noCentroid.comuneId === 3 && noCentroid.coordinateSource === null && noCentroid.latitude === null,
    'un comune senza centroide non deve produrre coordinate'
  )

  console.log('[resolve.ts] self-check OK')
}
