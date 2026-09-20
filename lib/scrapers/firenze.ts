/**
 * Adattatore Comune di Firenze — "Eventi a Firenze".
 *
 * Base giuridica: il Comune e' una PA e il dataset dichiara CC-BY 4.0 su
 * `dati.toscana.it`; anche senza licenza esplicita varrebbe l'art. 52 comma 2
 * CAD (open data by default). Nessuna zona grigia.
 *
 * Copertura: la risorsa GeoJSON e' una FINESTRA MOBILE di 30 giorni dalla data
 * odierna, rigenerata ogni giorno dalla programmazione ufficiale di
 * FeelFlorence. Non e' un archivio: un evento sparisce dal feed quando esce
 * dalla finestra. Per questo l'ingest NON cancella nulla di suo — se ne occupa
 * la retention (lib/retention/purge.ts) quando l'evento e' davvero concluso.
 * Copre l'area metropolitana, non la sola Firenze: Fiesole, Scandicci, Sesto
 * Fiorentino, Bagno a Ripoli, Calenzano, Lastra a Signa, Vaglia, Barberino
 * Tavarnelle.
 *
 * QUATTRO TRAPPOLE DEL DATO, tutte osservate sulla fixture reale (135 feature,
 * scaricata il 2026-09-19), non dedotte dalla documentazione:
 *
 *   1. NESSUN identificativo. Il GeoJSON non espone un id: `sourceId` e'
 *      costruito da titolo + data di inizio, deterministico fra due
 *      esecuzioni, cosi' l'upsert su (source, sourceId) aggiorna invece di
 *      duplicare. Stesso rimedio gia' usato da solosagre.
 *   2. `link` PUO' CONTENERE PIU' URL separati da spazio (record 1 della
 *      fixture ne ha due). Prenderlo intero produrrebbe un `sourceUrl` non
 *      navigabile: si tiene il primo.
 *   3. La geometria e' `MultiPoint` e puo' portare PIU' COORDINATE (record 7
 *      ne ha due, sedi diverse dello stesso ciclo). ScrapedEvent ha un punto
 *      solo: si tiene il primo. GeoJSON e' [longitudine, latitudine], in
 *      quest'ordine — invertirli metterebbe gli eventi in Somalia.
 *   4. `comuni` e' MULTI-VALORE separato da a capo quando l'evento attraversa
 *      piu' comuni, ed e' vuoto su 5 record su 135.
 *
 * NESSUN CAMPO CATEGORIA nella sorgente: la categoria si deduce dal titolo con
 * lib/categories/fromTitle.ts, lo stesso modulo dell'Alto Adige. Senza, tutti
 * e 133 gli eventi futuri sarebbero 'Altro' e la barra dei filtri sarebbe
 * inutile in Toscana.
 *
 * Self-check: `npx tsx lib/scrapers/firenze.ts`.
 */
import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'
import { categoryFromTitle } from '../categories/fromTitle'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Risorsa GeoJSON pubblicata da `data.comune.fi.it` e catalogata su
 * `dati.toscana.it` (dataset "Eventi a Firenze"). L'URL porta gli id numerici
 * della risorsa: se il Comune ripubblica il dataset cambiano, e il gate se ne
 * accorge perche' il fetch smette di tornare feature.
 */
export const FIRENZE_GEOJSON_URL =
  'https://data.comune.fi.it/datastore/download.php?id=6289&type=99&format=url&file_format=geojson&file_id=23095'

export interface FirenzeFeature {
  properties?: {
    comuni?: string | null
    data_inizio?: string | null
    data_fine?: string | null
    titolo?: string | null
    descrizione?: string | null
    email?: string | null
    telefono?: string | null
    link?: string | null
    feelflorence_link?: string | null
    appuntamenti?: string | null
  } | null
  geometry?: { type?: string; coordinates?: unknown } | null
}

export async function scrapeFirenze(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    const response = await fetchWithRetry(FIRENZE_GEOJSON_URL)
    const body = (await response.json()) as { features?: FirenzeFeature[] }
    const events = transformFirenzeFeatures(body.features ?? [], params)

    return { events, source: 'firenze', duration: Date.now() - startTime }
  } catch (error) {
    // Stessa politica di emiliaromagna.ts: un errore qui NON spegne la
    // regione a mano. Se il vuoto persiste ci pensa la soglia di copertura
    // (lib/coverage/liveRegions.ts), che e' il meccanismo dichiarato.
    return {
      events: [],
      source: 'firenze',
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/** "17/01/2026" -> Date locale a mezzanotte. Null su formato inatteso. */
export function parseFirenzeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim())
  if (!m) return null
  const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return Number.isNaN(date.getTime()) ? null : date
}

/** Trappola 2: `link` puo' portare piu' URL separati da spazio. */
export function firstUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const first = raw.trim().split(/\s+/)[0]
  return first && /^https?:\/\//i.test(first) ? first : null
}

/**
 * Trappola 3: MultiPoint con N punti, e GeoJSON e' [lon, lat] — non [lat, lon].
 * Restituisce il primo punto valido, oppure null.
 */
export function firstPoint(
  geometry: FirenzeFeature['geometry']
): { latitude: number; longitude: number } | null {
  const coords = geometry?.coordinates
  if (!Array.isArray(coords) || coords.length === 0) return null
  const head = coords[0]
  const pair = Array.isArray(head) && typeof head[0] === 'number' ? head : coords
  if (!Array.isArray(pair) || typeof pair[0] !== 'number' || typeof pair[1] !== 'number') return null
  const [longitude, latitude] = pair as [number, number]
  // Guardia sui limiti terrestri: intercetta un'eventuale inversione futura
  // della sorgente invece di scrivere coordinate impossibili in database.
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude }
}

/** Trappola 4: multi-valore separato da a capo, vuoto su alcuni record. */
export function firstComune(raw: string | null | undefined): string | null {
  if (!raw) return null
  const first = raw.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0)
  return first ?? null
}

function normalizeDescription(raw: string | null | undefined): string | null {
  if (!raw) return null
  const clean = raw
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 500)
  return clean.length > 0 ? clean : null
}

export function transformFirenzeFeatures(
  features: FirenzeFeature[],
  params: ScrapeParams = {}
): ScrapedEvent[] {
  const from = params.dateFrom ? new Date(params.dateFrom) : new Date()
  from.setHours(0, 0, 0, 0)
  const to = params.dateTo ? new Date(params.dateTo) : null

  const events: ScrapedEvent[] = []
  const seen = new Set<string>()

  for (const feature of features) {
    const p = feature?.properties
    if (!p) continue

    const title = (p.titolo ?? '').trim()
    const dateStart = parseFirenzeDate(p.data_inizio)
    if (!title || !dateStart) continue

    const dateEnd = parseFirenzeDate(p.data_fine)

    // Un evento e' ancora utile finche' NON e' concluso: si guarda la data di
    // FINE, non quella di inizio. Un ciclo cominciato a gennaio e in corso
    // fino a dicembre va tenuto — scartarlo perche' e' iniziato nel passato
    // e' lo stesso errore che la retention evita con COALESCE.
    const effectiveEnd = dateEnd ?? dateStart
    if (effectiveEnd < from) continue
    if (to && dateStart > to) continue

    // Trappola 1: nessun id nella sorgente. Deterministico, quindi stabile
    // fra due esecuzioni; `seen` copre il caso di due record identici nello
    // stesso payload, che violerebbero l'unicita' (source, sourceId).
    const sourceId = `${title.toLowerCase().replace(/\s+/g, ' ').trim()}|${p.data_inizio}`
    if (seen.has(sourceId)) continue
    seen.add(sourceId)

    const point = firstPoint(feature.geometry)

    events.push({
      source: 'firenze',
      sourceId,
      title,
      description: normalizeDescription(p.descrizione),
      dateStart,
      dateEnd,
      // Nessun campo "sede" nella sorgente: il comune e' l'unica indicazione
      // di luogo disponibile. Le coordinate sotto sono il dato buono.
      locationName: firstComune(p.comuni),
      address: null,
      latitude: point?.latitude ?? null,
      longitude: point?.longitude ?? null,
      category: categoryFromTitle(title),
      // feelflorence_link e' valorizzato su 135/135, `link` solo su 133 e puo'
      // puntare fuori dal circuito ufficiale: la pagina istituzionale e' la
      // destinazione piu' affidabile, l'altra resta il ripiego.
      sourceUrl: p.feelflorence_link?.trim() || firstUrl(p.link),
      imageUrl: null,
      phone: p.telefono?.trim() || null
    })
  }

  return events
}

// Self-check sulla fixture reale: nessun framework, solo assert che falliscono
// rumorosamente — stesso idioma di emiliaromagna.ts e distance.ts.
// La guardia su `typeof` serve perche' questo modulo finisce nel grafo di
// import del bundle browser: `require.main` nudo esploderebbe alla
// valutazione del modulo.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  const fixturePath = join(__dirname, '__fixtures__', 'firenze-events.json')
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as { features: FirenzeFeature[] }
  const features = fixture.features ?? []

  let pass = 0
  let fail = 0
  const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`ok ${pass + fail} - ${name}`) }
    else { fail++; console.log(`not ok ${pass + fail} - ${name}${detail ? ' # ' + detail : ''}`) }
  }

  check('la fixture porta feature', features.length > 0, `trovate ${features.length}`)

  // Finestra larga: la fixture e' del 2026-09-19 e la sua finestra mobile e'
  // di 30 giorni, quindi un `from` a ieri la copre tutta senza dipendere dal
  // giorno in cui il gate gira.
  const events = transformFirenzeFeatures(features, { dateFrom: '2026-09-19' })
  check('produce eventi', events.length > 100, `prodotti ${events.length} su ${features.length} feature`)

  const withCoords = events.filter((e) => e.latitude !== null && e.longitude !== null)
  check(
    'ogni evento porta coordinate (e' + ' la sorgente non richiede geocoding)',
    withCoords.length === events.length,
    `${withCoords.length}/${events.length}`
  )

  // Trappola 3: le coordinate devono cadere in Toscana, non nell'oceano.
  // [lon, lat] invertiti metterebbero Firenze a latitudine 11.
  const inTuscany = withCoords.filter(
    (e) => e.latitude! > 42.5 && e.latitude! < 44.5 && e.longitude! > 10 && e.longitude! < 12.5
  )
  check(
    'le coordinate cadono in Toscana (lon/lat non invertiti)',
    inTuscany.length === withCoords.length,
    `${inTuscany.length}/${withCoords.length}`
  )

  const ids = new Set(events.map((e) => e.sourceId))
  check('i sourceId sono unici', ids.size === events.length, `${ids.size} id per ${events.length} eventi`)

  // Determinismo: due trasformazioni degli stessi input danno gli stessi id.
  const again = transformFirenzeFeatures(features, { dateFrom: '2026-09-19' })
  check(
    'i sourceId sono deterministici fra due esecuzioni',
    JSON.stringify(again.map((e) => e.sourceId)) === JSON.stringify(events.map((e) => e.sourceId))
  )

  check(
    'nessun sourceUrl multiplo (trappola del campo link)',
    events.every((e) => !e.sourceUrl || !/\s/.test(e.sourceUrl))
  )

  // Soglia 40%: misurata 43,0% sulla fixture dopo l'estensione delle famiglie
  // di parole chiave del 2026-09-20 (era 30,4% prima). Scritta poco sotto il
  // valore osservato, non sopra: deve cadere se la categorizzazione REGREDISCE,
  // non a ogni oscillazione del contenuto della finestra mobile.
  const categorized = events.filter((e) => e.category !== null)
  check(
    'almeno il 40% degli eventi riceve una categoria dal titolo',
    categorized.length >= events.length * 0.4,
    `${categorized.length}/${events.length} categorizzati`
  )

  console.log(`1..${pass + fail}`)
  console.log(`# pass ${pass}`)
  console.log(`# fail ${fail}`)
  if (fail > 0) process.exit(1)
}
