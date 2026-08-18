/**
 * Cascata di matching locationName/address -> Comune (D-05, D-07, D-11).
 *
 * Tre gradini deterministici, in ordine, mai un gradino per similarita': match
 * esatto, poi normalizzato, poi alias. Un aggancio per similarita' e'
 * indistinguibile da uno corretto guardando il risultato ("Castel San
 * Giovanni" e "Castel San Pietro" distano pochissimo per similarita'), quindi
 * un mismatch entrerebbe nel database senza lasciare traccia. Quando un
 * gradino restituisce piu' di un candidato (omonimi, es. Livo CO/TN) si
 * disambigua per distanza dalle coordinate di sorgente o per regione della
 * sorgente (D-07); se resta ambiguo non si aggancia.
 *
 * Nessun import di Prisma: riceve i comuni gia' letti dal chiamante e
 * restituisce un esito puro. La lettura dal database resta responsabilita'
 * del chiamante.
 */
import { normalizeComuneName } from './normalize'
import { extractComuneCandidates } from './addressParse'
import { isPlausibleCoordinate } from './bbox'
import { calculateDistanceKm } from './distance'
import { getSourceById } from '../scrapers/registry'

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

export type MatchStep =
  | 'exact'
  | 'normalized'
  | 'alias'
  | 'homonym_distance'
  | 'homonym_region'
  | 'ambiguous'
  | 'unmatched'
  | 'no_input'

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
  // D-11: true quando la coordinata di sorgente esisteva ma e' stata scartata
  // perche' implausibile (fuori dal bounding box Italia, o 0,0) e sostituita
  // dal centroide del comune (o da nulla se il comune non ne ha uno).
  sourceCoordinateRejected: boolean
}

export type ComuneIndex = {
  // Nome esatto -> lista di candidati: due comuni omonimi possono condividere
  // lo stesso nome ufficiale letterale (es. Livo CO / Livo TN) — un Map a
  // singolo valore sovrascriverebbe silenziosamente il primo con l'ultimo
  // inserito, producendo un aggancio sbagliato indistinguibile da uno
  // corretto. Piu' di un candidato per la stessa chiave passa dalla stessa
  // disambiguazione degli omonimi usata per normalizzato/alias.
  byExactName: Map<string, ComuneRow[]>
  // Nome normalizzato -> lista di candidati: piu' di un candidato per la
  // stessa chiave e' un omonimo (es. Livo CO / Livo TN), disambiguato sotto.
  byNormalizedName: Map<string, ComuneRow[]>
  // Alias normalizzato -> lista di candidati, stessa meccanica di collisione
  // del nome normalizzato (D-03: l'array aliases e' la fonte).
  byAliasName: Map<string, ComuneRow[]>
}

function pushToBucket(map: Map<string, ComuneRow[]>, key: string, comune: ComuneRow): void {
  const bucket = map.get(key)
  if (bucket) bucket.push(comune)
  else map.set(key, [comune])
}

export function buildComuneIndex(comuni: ComuneRow[]): ComuneIndex {
  const byExactName = new Map<string, ComuneRow[]>()
  const byNormalizedName = new Map<string, ComuneRow[]>()
  const byAliasName = new Map<string, ComuneRow[]>()

  for (const comune of comuni) {
    pushToBucket(byExactName, comune.name, comune)
    pushToBucket(byNormalizedName, normalizeComuneName(comune.name), comune)

    for (const alias of comune.aliases) {
      const normalizedAlias = normalizeComuneName(alias)
      if (!normalizedAlias) continue
      pushToBucket(byAliasName, normalizedAlias, comune)
    }
  }

  return { byExactName, byNormalizedName, byAliasName }
}

// Sorgenti "venue-first": location_name porta il nome di una sede (piazza,
// teatro, centro storico), non un comune — il comune va cercato prima in
// address. Aggiungere una sorgente venue-first futura e' una riga sola qui;
// tutte le altre sorgenti restano sul comportamento di default (locationName).
type SourceStrategy = 'location_name' | 'address_then_location_name'
const SOURCE_STRATEGY: Record<string, SourceStrategy> = {
  'in-lombardia': 'address_then_location_name',
}

function namesToTry(input: ResolveInput): string[] {
  const strategy = SOURCE_STRATEGY[input.source] ?? 'location_name'
  const locationName = input.locationName?.trim() || ''

  if (strategy === 'address_then_location_name') {
    const fromAddress = extractComuneCandidates(input.address)
    return locationName ? [...fromAddress, locationName] : fromAddress
  }

  return locationName ? [locationName] : []
}

/**
 * Disambiguazione degli omonimi (D-07): (1) se l'input porta coordinate di
 * sorgente plausibili, vince il candidato piu' vicino; (2) altrimenti si
 * restringe ai candidati la cui regione corrisponde alla regione della
 * sorgente, letta dal registry — se resta esattamente un candidato, quello
 * vince; (3) altrimenti resta ambiguo, nessun aggancio inventato.
 *
 * Avvertenza per il prossimo che tocca questo file: il gradino (2) assume che
 * ogni sorgente appartenga a UNA regione (lib/scrapers/registry.ts). Questa
 * relazione sorgente->regione smette di essere 1:1 dalla Fase 15, quando
 * SoloSagre si generalizza a tutte le regioni — a quel punto il gradino va
 * rivisto (non puo' piu' restringere su `region` singola).
 */
function disambiguateHomonyms(
  candidates: ComuneRow[],
  input: ResolveInput
): { comune: ComuneRow | null; matchStep: 'homonym_distance' | 'homonym_region' | 'ambiguous' } {
  if (
    input.latitude !== null &&
    input.longitude !== null &&
    isPlausibleCoordinate(input.latitude, input.longitude)
  ) {
    let nearest: ComuneRow | null = null
    let nearestDistanceKm = Infinity
    for (const candidate of candidates) {
      if (candidate.latitude === null || candidate.longitude === null) continue
      const distanceKm = calculateDistanceKm(
        input.latitude,
        input.longitude,
        candidate.latitude,
        candidate.longitude
      )
      if (distanceKm < nearestDistanceKm) {
        nearestDistanceKm = distanceKm
        nearest = candidate
      }
    }
    if (nearest) return { comune: nearest, matchStep: 'homonym_distance' }
    // Nessun candidato ha un centroide: si passa al gradino regione sotto.
  }

  const sourceRegion = getSourceById(input.source)?.region
  if (sourceRegion) {
    const regionMatches = candidates.filter(
      c => c.regionName.toLowerCase() === sourceRegion.toLowerCase()
    )
    if (regionMatches.length === 1) {
      return { comune: regionMatches[0], matchStep: 'homonym_region' }
    }
  }

  return { comune: null, matchStep: 'ambiguous' }
}

/**
 * Cascata per un singolo nome candidato: esatto -> normalizzato -> alias.
 * Nessun gradino ulteriore dopo l'alias (D-05).
 */
function singleNameResolve(
  name: string,
  index: ComuneIndex,
  input: ResolveInput
): { comune: ComuneRow | null; matchStep: MatchStep } {
  let sawAmbiguous = false

  const exactCandidates = index.byExactName.get(name)
  if (exactCandidates && exactCandidates.length === 1) {
    return { comune: exactCandidates[0], matchStep: 'exact' }
  }
  if (exactCandidates && exactCandidates.length > 1) {
    const disambiguated = disambiguateHomonyms(exactCandidates, input)
    if (disambiguated.comune) return { comune: disambiguated.comune, matchStep: disambiguated.matchStep }
    sawAmbiguous = true
  }

  const normalized = normalizeComuneName(name)

  const normalizedCandidates = index.byNormalizedName.get(normalized)
  if (normalizedCandidates && normalizedCandidates.length === 1) {
    return { comune: normalizedCandidates[0], matchStep: 'normalized' }
  }
  if (normalizedCandidates && normalizedCandidates.length > 1) {
    const disambiguated = disambiguateHomonyms(normalizedCandidates, input)
    if (disambiguated.comune) return { comune: disambiguated.comune, matchStep: disambiguated.matchStep }
    sawAmbiguous = true
  }

  const aliasCandidates = index.byAliasName.get(normalized)
  if (aliasCandidates && aliasCandidates.length === 1) {
    return { comune: aliasCandidates[0], matchStep: 'alias' }
  }
  if (aliasCandidates && aliasCandidates.length > 1) {
    const disambiguated = disambiguateHomonyms(aliasCandidates, input)
    if (disambiguated.comune) return { comune: disambiguated.comune, matchStep: disambiguated.matchStep }
    sawAmbiguous = true
  }

  return { comune: null, matchStep: sawAmbiguous ? 'ambiguous' : 'unmatched' }
}

/**
 * Coordinate risolte secondo D-09/D-11/D-14: la sorgente, quando presente e
 * plausibile, vince sempre e non viene mai sostituita dal centroide. Una
 * coordinata di sorgente implausibile (fuori bbox Italia, o 0,0) e' trattata
 * come assente e sostituita dal centroide, segnalata via
 * `sourceCoordinateRejected`. Il centroide si applica anche in assenza pura
 * di coordinate di sorgente, e solo se il comune risolto ne ha uno.
 */
function coordinatesFor(
  input: ResolveInput,
  comune: ComuneRow | null
): Pick<ResolveOutcome, 'latitude' | 'longitude' | 'coordinateSource' | 'sourceCoordinateRejected'> {
  if (input.latitude !== null && input.longitude !== null) {
    if (isPlausibleCoordinate(input.latitude, input.longitude)) {
      return {
        latitude: input.latitude,
        longitude: input.longitude,
        coordinateSource: 'source',
        sourceCoordinateRejected: false,
      }
    }
    if (comune && comune.latitude !== null && comune.longitude !== null) {
      return {
        latitude: comune.latitude,
        longitude: comune.longitude,
        coordinateSource: 'comune_centroid',
        sourceCoordinateRejected: true,
      }
    }
    return { latitude: null, longitude: null, coordinateSource: null, sourceCoordinateRejected: true }
  }
  if (comune && comune.latitude !== null && comune.longitude !== null) {
    return {
      latitude: comune.latitude,
      longitude: comune.longitude,
      coordinateSource: 'comune_centroid',
      sourceCoordinateRejected: false,
    }
  }
  return { latitude: null, longitude: null, coordinateSource: null, sourceCoordinateRejected: false }
}

export function resolveComune(input: ResolveInput, index: ComuneIndex): ResolveOutcome {
  const names = namesToTry(input)

  if (names.length === 0) {
    // Distinto da 'unmatched' (D-16): qui la sorgente non ha dato nessun
    // candidato (locationName e address, dopo l'eventuale pre-estrazione,
    // sono entrambi vuoti), non e' un nome cercato e non risolto.
    return { comuneId: null, matchStep: 'no_input', candidateName: null, ...coordinatesFor(input, null) }
  }

  let lastFailure: { name: string; matchStep: MatchStep } | null = null

  for (const name of names) {
    const result = singleNameResolve(name, index, input)
    if (result.comune) {
      return {
        comuneId: result.comune.id,
        matchStep: result.matchStep,
        candidateName: name,
        ...coordinatesFor(input, result.comune),
      }
    }
    lastFailure = { name, matchStep: result.matchStep }
  }

  // Tutti i candidati esauriti senza aggancio: riporta l'ultimo tentativo,
  // il piu' informativo per il report raggruppato di D-06.
  return {
    comuneId: null,
    matchStep: lastFailure!.matchStep,
    candidateName: lastFailure!.name,
    ...coordinatesFor(input, null),
  }
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
  const bolzano: ComuneRow = {
    id: 4,
    istatCode: '021008',
    name: 'Bolzano',
    aliases: ['Bozen'],
    provinceCode: 'BZ',
    provinceName: 'Bolzano',
    regionCode: '04',
    regionName: 'Trentino-Alto Adige',
    latitude: 46.4983,
    longitude: 11.3548,
  }
  // Omonimi reali (D-07): Livo esiste in provincia di Como e in Trentino.
  const livoComo: ComuneRow = {
    id: 5,
    istatCode: '013133',
    name: 'Livo',
    aliases: [],
    provinceCode: 'CO',
    provinceName: 'Como',
    regionCode: '03',
    regionName: 'Lombardia',
    latitude: 46.06,
    longitude: 9.31,
  }
  const livoTrento: ComuneRow = {
    id: 6,
    istatCode: '022115',
    name: 'Livo',
    aliases: [],
    provinceCode: 'TN',
    provinceName: 'Trento',
    regionCode: '04',
    regionName: 'Trentino-Alto Adige',
    latitude: 46.31,
    longitude: 11.05,
  }

  const index = buildComuneIndex([milano, bergamo, senzaCentroide, bolzano, livoComo, livoTrento])
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

  // Gradino 'alias'
  const alias = resolveComune({ ...base, locationName: 'Bozen', latitude: null, longitude: null }, index)
  console.assert(alias.matchStep === 'alias' && alias.comuneId === 4, "atteso match alias su 'Bozen' -> Bolzano")

  // 'unmatched'
  const unmatched = resolveComune({ ...base, locationName: 'Comune Inesistente', latitude: null, longitude: null }, index)
  console.assert(unmatched.matchStep === 'unmatched' && unmatched.comuneId === null, 'atteso unmatched su nome sconosciuto')

  // 'no_input' — distinto da 'unmatched'
  const noInputNull = resolveComune({ ...base, locationName: null, latitude: null, longitude: null }, index)
  console.assert(noInputNull.matchStep === 'no_input' && noInputNull.comuneId === null, 'atteso no_input su locationName nullo')
  const noInputEmpty = resolveComune({ ...base, locationName: '', latitude: null, longitude: null }, index)
  console.assert(noInputEmpty.matchStep === 'no_input', 'atteso no_input su locationName vuoto')

  // Omonimo risolto per distanza: coordinate vicine a Livo (CO).
  const homonymDistance = resolveComune(
    { ...base, locationName: 'Livo', latitude: 46.05, longitude: 9.3 },
    index
  )
  console.assert(
    homonymDistance.matchStep === 'homonym_distance' && homonymDistance.comuneId === 5,
    "atteso homonym_distance -> Livo (CO), ottenuto " + JSON.stringify(homonymDistance)
  )

  // Omonimo risolto per regione della sorgente: nessuna coordinata, sorgente 'solosagre' (regione 'lombardia').
  const homonymRegion = resolveComune(
    { locationName: 'Livo', address: null, source: 'solosagre', latitude: null, longitude: null },
    index
  )
  console.assert(
    homonymRegion.matchStep === 'homonym_region' && homonymRegion.comuneId === 5,
    "atteso homonym_region -> Livo (CO) per sorgente lombarda, ottenuto " + JSON.stringify(homonymRegion)
  )

  // Omonimo ambiguo: nessuna coordinata, sorgente sconosciuta al registry -> non aggancia.
  const ambiguous = resolveComune({ ...base, locationName: 'Livo', latitude: null, longitude: null }, index)
  console.assert(
    ambiguous.matchStep === 'ambiguous' && ambiguous.comuneId === null,
    'atteso ambiguous quando ne' + "' distanza ne' regione disambiguano, ottenuto " + JSON.stringify(ambiguous)
  )

  // Coordinata implausibile (0,0) sostituita dal centroide e segnalata.
  const implausible = resolveComune({ ...base, locationName: 'Milano', latitude: 0, longitude: 0 }, index)
  console.assert(
    implausible.coordinateSource === 'comune_centroid' &&
      implausible.sourceCoordinateRejected === true &&
      implausible.latitude === 45.4642,
    'atteso centroide + sourceCoordinateRejected=true per coordinata 0,0, ottenuto ' + JSON.stringify(implausible)
  )

  // Coordinata di sorgente plausibile: nessuna sostituzione, nessuna segnalazione.
  const plausible = resolveComune({ ...base, locationName: 'Milano', latitude: 45.5, longitude: 9.2 }, index)
  console.assert(
    plausible.coordinateSource === 'source' && plausible.sourceCoordinateRejected === false,
    'una coordinata plausibile non deve essere segnalata come scartata'
  )

  // Sorgente 'in-lombardia': il candidato viene dall'address, non da locationName
  // (che qui porta il nome di una sede, non un comune).
  const inLombardiaFromAddress = resolveComune(
    {
      locationName: 'Piazza Duomo',
      address: 'Via Roma - Milano',
      source: 'in-lombardia',
      latitude: null,
      longitude: null,
    },
    index
  )
  console.assert(
    inLombardiaFromAddress.matchStep === 'exact' &&
      inLombardiaFromAddress.comuneId === 1 &&
      inLombardiaFromAddress.candidateName === 'Milano',
    "atteso match su 'Milano' letto da address per in-lombardia, ottenuto " + JSON.stringify(inLombardiaFromAddress)
  )

  // Sorgente 'in-lombardia', address senza candidato estraibile: fallback su locationName.
  const inLombardiaFallback = resolveComune(
    { locationName: 'Bergamo', address: 'Piazza Duomo', source: 'in-lombardia', latitude: null, longitude: null },
    index
  )
  console.assert(
    inLombardiaFallback.matchStep === 'exact' && inLombardiaFallback.comuneId === 2,
    "atteso fallback su locationName 'Bergamo' quando address non produce candidati, ottenuto " +
      JSON.stringify(inLombardiaFallback)
  )

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
