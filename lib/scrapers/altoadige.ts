/**
 * Open Data Hub Sudtirol scraper (Fase 19, 19-01 Task 1/3).
 *
 * Scarica JSON da tourism.api.opendatahub.com/v1/Event — API pubblica senza
 * chiave, licenza CC0 dichiarata nel payload stesso (LicenseInfo.License,
 * verificato dal vivo il 2026-09-19). A differenza di emiliaromagna.ts
 * l'endpoint E' paginato lato server (parametro pagenumber/TotalPages) e ogni
 * item porta un array EventDate[] con piu' occorrenze future invece di una
 * sola coppia dateStart/dateEnd (D-10, 19-CONTEXT.md).
 *
 * pagesize=300 non e' arbitrario: misurato il 2026-09-19, pagesize=3 produce
 * 1.002 pagine (19-CONTEXT.md), pagesize=300 ne produce 11 da ~15 MB l'una
 * (19-RESEARCH.md Pitfall 1, curl diretto sulla pagina 1: 15.322.225 byte).
 * timeout: 60000 (il doppio del default di fetchWithRetry, 30000) per la
 * stessa ragione: una pagina da 15 MB su rete lenta puo' non bastare nei
 * 30s di default. Se il costo di banda diventasse un problema, la leva e'
 * il parametro `enddate` (non verificato in questa fase, non usato qui).
 */

import type { ScrapeParams, AdapterResult, ScrapedEvent } from './types'
import { fetchWithRetry } from './utils'
import { getSourceMetaById } from './sources'
import { readFileSync } from 'fs'
import { join } from 'path'
// Solo per il self-check in coda al file: verifica che deriveAltoAdigeCategory
// produca un valore che canonicalizeCategory (il seam condiviso, mai toccato
// da D-12) risolve correttamente passando per SOURCE_META['altoadige'].categoryMap
// — esattamente il percorso che saveEvents segue a persistenza.
import { canonicalizeCategory } from '../categories/taxonomy'

// Interfacce sui soli campi che servono, tutti opzionali/nullable: il
// payload e' input non fidato (19-RESEARCH.md §Security, ASVS V5), ogni
// accesso annidato passa per optional chaining, mai un cast che silenzi il
// compilatore (T-19-02).
export interface OdhEventDate {
  From?: string | null
  To?: string | null
  Cancelled?: string | null
  IsCancelled?: boolean | null
}

export interface OdhTag {
  Id?: string | null
}

export interface OdhGpsInfo {
  Latitude?: number | null
  Longitude?: number | null
}

export interface OdhEventItem {
  Id?: string | null
  Detail?: {
    it?: { Title?: string | null } | null
    de?: { Title?: string | null } | null
  } | null
  GpsInfo?: OdhGpsInfo[] | null
  LocationInfo?: {
    MunicipalityInfo?: { Name?: { it?: string | null } | null } | null
  } | null
  ODHTags?: OdhTag[] | null
  SmgTags?: string[] | null
  DateBegin?: string | null
  DateEnd?: string | null
  EventDate?: OdhEventDate[] | null
}

interface OdhResponse {
  TotalResults?: number
  TotalPages?: number
  CurrentPage?: number
  Items?: OdhEventItem[]
}

// Forma della fixture salvata su disco (D-01): un envelope con chiave
// minuscola `items`, diverso dalla risposta live (`Items`, maiuscola) — il
// self-check in coda al file legge questa forma, mai la rete.
interface OdhFixtureEnvelope {
  TotalResults?: number
  items?: OdhEventItem[]
}

export async function scrapeAltoAdige(params: ScrapeParams = {}): Promise<AdapterResult> {
  const startTime = Date.now()

  try {
    const dateFromIso = params.dateFrom ?? new Date().toISOString().slice(0, 10)
    const pageSize = 300

    let pageNumber = 1
    let totalPages = 1
    const allItems: OdhEventItem[] = []

    do {
      const url = `https://tourism.api.opendatahub.com/v1/Event?active=true&begindate=${dateFromIso}&pagesize=${pageSize}&pagenumber=${pageNumber}`
      const response = await fetchWithRetry(url, { timeout: 60000 })
      const body: OdhResponse = await response.json()
      totalPages = body.TotalPages ?? 1
      allItems.push(...(body.Items ?? []))
      pageNumber++
    } while (pageNumber <= totalPages)

    const events = transformAltoAdigeItems(allItems, params)

    const duration = Date.now() - startTime
    // TotalResults/Items vuoti non sono un errore fatale — stesso ragionamento
    // di emiliaromagna.ts righe 68-74: e' il segnale di
    // lib/coverage/liveRegions.ts a occuparsene, mai questa funzione.
    return { events, source: 'altoadige', duration }
  } catch (error) {
    const duration = Date.now() - startTime
    return {
      events: [],
      source: 'altoadige',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

// I 7 nomi canonici sono definiti in lib/categories/taxonomy.ts (D-12
// esclude esplicitamente di toccare quel file). Ripetuti qui SOLO come
// stringhe letterali di ritorno per la logica di regole testuali — l'unica
// fonte di verita' sul VALORE dei nomi resta taxonomy.ts, che il self-check
// importa per confrontare (mai una lista ridigitata a mano nel gate).

/**
 * Regole testuali D-11: famiglie di parole chiave ricavate dai titoli
 * REALMENTE presenti nella fixture (19-01-PLAN.md, misurato 2026-09-19).
 * L'ordine qui sotto NON e' l'ordine di elencazione del piano — e' un ordine
 * di PRECEDENZA scelto per risolvere i titoli che incrociano piu' famiglie
 * (es. "Mercatino di Natale" contiene sia "mercatino" che "natale": va in
 * Fiere e mercati, non Sagre e feste, quindi quella famiglia va controllata
 * prima). Verificato contro l'intera fixture: nessun titolo del blocco
 * <behavior> del piano cambia esito con questo ordine.
 */
import { categoryFromTitle } from '../categories/fromTitle'

/**
 * Deriva la categoria di un item (D-11), dentro l'adattatore — mai in
 * lib/categories/taxonomy.ts (D-12 lo esclude esplicitamente). Precedenza:
 * 1. Un tag (ODHTags poi SmgTags, nell'ordine del payload) che mappa a una
 *    categoria REALE in categoryMap vince immediatamente, anche se il
 *    titolo suggerirebbe qualcos'altro — un item puo' avere sia un tag di
 *    marketing sia un tag reale insieme (es. "eventi super" +
 *    "törggeleveranstaltungen"), e il tag reale non deve perdere solo
 *    perche' compare dopo nell'array.
 * 2. Se nessun tag reale e' presente ma ALMENO UN tag riconosciuto mappa
 *    esplicitamente ad 'Altro' (marketing, es. "regionale top event"),
 *    quel tag ha comunque precedenza sul titolo: e' un contenuto
 *    informativo dichiarato dalla sorgente, non un default silenzioso
 *    (D-11), e ignorarlo per inseguire una parola chiave nel titolo
 *    vanificherebbe "i tag hanno precedenza sul titolo".
 * 3. Solo se NESSUN tag e' riconosciuto, le regole testuali sul titolo.
 * 4. Altrimenti null (canonicalizeCategory lo risolve in 'Altro' senza
 *    lanciare).
 *
 * Ritorna un valore GREZZO — o un tag raw (risolto poi da
 * SOURCE_META['altoadige'].categoryMap via canonicalizeCategory) o uno dei 7
 * nomi canonici (mappato 1:1 nello stesso categoryMap) — mai un accesso al
 * database: la funzione resta pura.
 */
export function deriveAltoAdigeCategory(item: OdhEventItem): string | null {
  const categoryMap = getSourceMetaById('altoadige')?.categoryMap ?? {}
  const rawTags: string[] = [
    ...(item.ODHTags ?? []).map((tag) => tag?.Id).filter((id): id is string => Boolean(id)),
    ...(item.SmgTags ?? [])
  ]

  let sawFallbackTag = false
  for (const tag of rawTags) {
    if (Object.prototype.hasOwnProperty.call(categoryMap, tag)) {
      const mapped = categoryMap[tag]
      if (mapped !== 'Altro') {
        return tag
      }
      sawFallbackTag = true
    }
  }
  if (sawFallbackTag) {
    return 'Altro'
  }

  const title = item.Detail?.it?.Title ?? item.Detail?.de?.Title ?? ''
  return categoryFromTitle(title)
}

export function transformAltoAdigeItems(items: OdhEventItem[], params: ScrapeParams = {}): ScrapedEvent[] {
  // Stesso default di emiliaromagna.ts: oggi -> +6 mesi, sovrascrivibile.
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const sixMonthsLater = new Date()
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6)
  sixMonthsLater.setHours(23, 59, 59, 999)

  const dateFrom = params.dateFrom ? new Date(params.dateFrom) : today
  dateFrom.setHours(0, 0, 0, 0)
  const dateTo = params.dateTo ? new Date(params.dateTo) : sixMonthsLater
  dateTo.setHours(23, 59, 59, 999)

  const results: ScrapedEvent[] = []

  for (const item of items) {
    if (!item.Id) continue

    // Titolo: italiano, ripiego sul tedesco, ripiego finale su 'Evento'
    // (3/151 item della fixture non hanno Detail.it.Title: due hanno solo
    // il tedesco, uno non ha nessun titolo — Pitfall documentato in
    // 19-RESEARCH.md/19-CONTEXT.md).
    const title = item.Detail?.it?.Title ?? item.Detail?.de?.Title ?? 'Evento'

    // Pitfall 2: MAI fidarsi di DateBegin/DateEnd a livello di item — possono
    // essere null anche con occorrenze future valide (item
    // urn:event:momentus:event-5035-A nella fixture). Iterare SEMPRE
    // EventDate.
    const gps = item.GpsInfo?.[0]
    const latitude = typeof gps?.Latitude === 'number' ? gps.Latitude : null
    const longitude = typeof gps?.Longitude === 'number' ? gps.Longitude : null

    // Pattern 2 (19-RESEARCH.md): MunicipalityInfo.Name.it e' il comune vero,
    // MAI ContactInfos.it.City, che puo' essere la frazione (Stelvio vs
    // Prato allo Stelvio).
    const locationName = item.LocationInfo?.MunicipalityInfo?.Name?.it ?? null

    const sourceUrl = `https://tourism.api.opendatahub.com/v1/Event/${encodeURIComponent(item.Id)}`

    const category = deriveAltoAdigeCategory(item)

    for (const eventDate of item.EventDate ?? []) {
      if (!eventDate.From) continue
      const from = new Date(eventDate.From)
      if (Number.isNaN(from.getTime())) continue
      if (from < dateFrom || from > dateTo) continue

      const cancelled = eventDate.IsCancelled === true || eventDate.Cancelled === '1'
      if (cancelled) continue

      const to = eventDate.To ? new Date(eventDate.To) : from

      results.push({
        source: 'altoadige',
        // D-10: {Id}#{From grezzo} — ~32 (GUID) + 1 + ~19 (ISO) = ~52 char,
        // ampiamente sotto i 255 di events.sourceId (@@unique([source,
        // sourceId]), nessuna migrazione Prisma).
        sourceId: `${item.Id}#${eventDate.From}`,
        title,
        description: null, // fixture trimmata senza Detail.<lingua>.BaseText — T-19-01, via d'uscita: quando una fixture aggiornata lo porti e un gate lo copra
        dateStart: from,
        dateEnd: Number.isNaN(to.getTime()) ? from : to,
        locationName,
        address: null, // ContactInfos.<lingua>.Address non presente nella fixture trimmata — stesso limite noto di description
        latitude,
        longitude,
        category,
        sourceUrl,
        imageUrl: null, // non presente nella fixture trimmata
        phone: null // ContactInfos.<lingua>.Phonenumber non presente nella fixture trimmata
        // istatCode: MAI valorizzato — Open Data Hub non fornisce codici
        // ISTAT, l'aggancio per nome avviene nel backfill territoriale
        // notturno esistente (lib/territorial/backfill.ts), non qui.
        // Residuo noto ~5% su 73 nomi campione (Corvara, Malles, Santa
        // Cristina Val Gardena, San Vigilio): comuneId resta null, l'evento
        // resta comunque visibile su mappa via latitude/longitude.
      })
    }
  }

  return results
}

// Self-check: `npx tsx lib/scrapers/altoadige.ts`. Stesso idioma TAP di
// emiliaromagna.ts (righe 170-246) — mai un framework di test nuovo nel
// progetto. Gira SOLO sulla fixture salvata, mai sulla rete.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  let failed = false
  let passCount = 0
  let failCount = 0
  const assert = (cond: boolean, msg: string) => {
    if (cond) {
      passCount++
    } else {
      console.error(`FAIL: ${msg}`)
      failed = true
      failCount++
    }
  }

  const fixturePath = join(__dirname, '__fixtures__', 'altoadige-events.json')
  const envelope: OdhFixtureEnvelope = JSON.parse(readFileSync(fixturePath, 'utf-8'))
  const fixtureItems = envelope.items ?? []
  assert(fixtureItems.length > 0, `la fixture deve avere almeno un item, trovati ${fixtureItems.length}`)

  // Finestra scritta in chiaro (mai la data odierna implicita): la fixture
  // invecchia, un gate che confronta con new Date() diventerebbe rosso da
  // solo al passare del calendario (trappola dichiarata nel piano).
  const wideWindow = { dateFrom: '2026-09-19', dateTo: '2027-12-31' }

  // --- Pitfall 2: DateBegin/DateEnd nulli a livello di item, EventDate valida ---
  const momentusNoTopLevelDates = fixtureItems.find((it) => it.Id === 'urn:event:momentus:event-5035-A')
  if (!momentusNoTopLevelDates) throw new Error('fixture priva dell\'item urn:event:momentus:event-5035-A')
  assert(
    momentusNoTopLevelDates.DateBegin == null && momentusNoTopLevelDates.DateEnd == null,
    'urn:event:momentus:event-5035-A deve avere DateBegin/DateEnd nulli a livello di item (precondizione del test)'
  )
  const momentusRows = transformAltoAdigeItems([momentusNoTopLevelDates], wideWindow)
  assert(
    momentusRows.length >= 1,
    `urn:event:momentus:event-5035-A deve produrre almeno una riga nonostante DateBegin/DateEnd nulli, ottenute ${momentusRows.length}`
  )

  // --- D-10: K date future -> K righe, sourceId tutti distinti ---
  const museoItem = fixtureItems.find((it) => it.Id === 'BCE00279FA6643ED8234BBC66585993A')
  if (!museoItem) throw new Error('fixture priva dell\'item BCE00279FA6643ED8234BBC66585993A')
  // Stessa normalizzazione dei bordi finestra di transformAltoAdigeItems
  // (new Date + setHours in ORA LOCALE): ricalcolarla diversamente qui
  // (es. confrontando con un Date costruito da stringa data-sola, sempre
  // UTC) produce un confine leggermente diverso da quello usato dalla
  // funzione sotto test — un falso off-by-one, non un bug del transform.
  const windowFrom = new Date(wideWindow.dateFrom)
  windowFrom.setHours(0, 0, 0, 0)
  const windowTo = new Date(wideWindow.dateTo)
  windowTo.setHours(23, 59, 59, 999)
  const expectedFutureOccurrences = (museoItem.EventDate ?? []).filter((ed) => {
    if (!ed.From) return false
    const from = new Date(ed.From)
    if (Number.isNaN(from.getTime())) return false
    if (from < windowFrom || from > windowTo) return false
    return !(ed.IsCancelled === true || ed.Cancelled === '1')
  }).length
  const museoRows = transformAltoAdigeItems([museoItem], wideWindow)
  assert(
    museoRows.length === expectedFutureOccurrences && expectedFutureOccurrences > 1,
    `BCE00279FA6643ED8234BBC66585993A deve produrre tante righe quante le occorrenze future attese (${expectedFutureOccurrences}), ottenute ${museoRows.length}`
  )
  const museoSourceIds = new Set(museoRows.map((r) => r.sourceId))
  assert(
    museoSourceIds.size === museoRows.length,
    `BCE00279FA6643ED8234BBC66585993A deve avere sourceId tutti distinti, ottenuti ${museoRows.length} righe per ${museoSourceIds.size} sourceId distinti`
  )

  // --- Pattern 2: locationName da MunicipalityInfo.Name.it, mai ContactInfos.it.City ---
  const stelvioItem = fixtureItems.find((it) => it.Id === '5754AC44806A46B9A5E0364CAB9B2C77')
  if (!stelvioItem) throw new Error('fixture priva dell\'item 5754AC44806A46B9A5E0364CAB9B2C77')
  const stelvioRows = transformAltoAdigeItems([stelvioItem], wideWindow)
  assert(stelvioRows.length >= 1, '5754AC44806A46B9A5E0364CAB9B2C77 deve produrre almeno una riga')
  if (stelvioRows.length >= 1) {
    assert(
      stelvioRows[0].locationName === 'Stelvio',
      `atteso locationName 'Stelvio' (comune, non la frazione 'Prato allo Stelvio'), ottenuto '${stelvioRows[0].locationName}'`
    )
  }

  // --- istatCode mai valorizzato su nessuna riga della fixture intera ---
  const allRows = transformAltoAdigeItems(fixtureItems, wideWindow)
  assert(allRows.length > 0, 'la fixture intera deve produrre almeno una riga')
  const withIstatCode = allRows.filter((r) => r.istatCode != null)
  assert(
    withIstatCode.length === 0,
    `nessuna riga deve avere istatCode valorizzato, trovate ${withIstatCode.length}`
  )

  // --- Titolo italiano assente -> ripiego tedesco, poi 'Evento' ---
  const noItalianTitle = fixtureItems.find((it) => it.Id === 'urn:event:momentus:event-635-A')
  if (!noItalianTitle) throw new Error('fixture priva dell\'item urn:event:momentus:event-635-A (senza Detail.it.Title)')
  const noItalianRows = transformAltoAdigeItems([noItalianTitle], wideWindow)
  assert(noItalianRows.length >= 1, 'urn:event:momentus:event-635-A deve produrre almeno una riga')
  if (noItalianRows.length >= 1) {
    assert(
      noItalianRows[0].title === '80 Jahre Pariser Vertrag',
      `atteso ripiego sul titolo tedesco, ottenuto '${noItalianRows[0].title}'`
    )
  }
  const noTitleAtAll = fixtureItems.find((it) => it.Id === 'urn:event:momentus:event-663-A')
  if (!noTitleAtAll) throw new Error('fixture priva dell\'item urn:event:momentus:event-663-A (nessun titolo)')
  const noTitleRows = transformAltoAdigeItems([noTitleAtAll], wideWindow)
  assert(noTitleRows.length >= 1, 'urn:event:momentus:event-663-A deve produrre almeno una riga')
  if (noTitleRows.length >= 1) {
    assert(
      noTitleRows[0].title === 'Evento',
      `atteso ripiego finale 'Evento' quando manca ogni titolo, ottenuto '${noTitleRows[0].title}'`
    )
  }

  // --- D-11: comportamento delle regole di categorizzazione (Task 3) ---
  const CANONICAL_CATEGORY_NAMES = [
    'Sagre e feste',
    'Musica e spettacolo',
    'Arte e cultura',
    'Fiere e mercati',
    'Sport e outdoor',
    'Food & Wine',
    'Altro'
  ]

  // deriveAltoAdigeCategory puo' restituire un RAW TAG (quando il match e'
  // un tag, non il titolo) — esattamente come fanno le altre sorgenti con
  // ScrapedEvent.category. Il valore che conta e' quello RISOLTO da
  // canonicalizeCategory via SOURCE_META['altoadige'].categoryMap, lo
  // stesso seam che saveEvents invoca a persistenza (T-19-xx del piano).
  const resolvedCategory = (item: OdhEventItem): string =>
    canonicalizeCategory('altoadige', deriveAltoAdigeCategory(item))

  const festaTradizioni = fixtureItems.find((it) => it.Id === '5754AC44806A46B9A5E0364CAB9B2C77')
  if (!festaTradizioni) throw new Error('fixture priva dell\'item 5754AC44806A46B9A5E0364CAB9B2C77 (Festa delle tradizioni)')
  assert(
    (festaTradizioni.Detail?.it?.Title ?? '').includes('Festa delle tradizioni e del gusto'),
    'precondizione: 5754AC44806A46B9A5E0364CAB9B2C77 deve avere il titolo atteso'
  )
  assert(
    resolvedCategory(festaTradizioni) !== 'Altro',
    `"Festa delle tradizioni e del gusto" deve ricevere una categoria reale, ottenuto '${resolvedCategory(festaTradizioni)}'`
  )

  const mercatinoNatale = fixtureItems.find((it) => it.Id === 'A84BF2415510410EADF4CB213FCD7098')
  if (!mercatinoNatale) throw new Error('fixture priva dell\'item A84BF2415510410EADF4CB213FCD7098 (Mercatino di Natale)')
  assert(
    resolvedCategory(mercatinoNatale) === 'Fiere e mercati',
    `"Mercatino di Natale a Lagundo" deve finire fra le fiere e i mercati, ottenuto '${resolvedCategory(mercatinoNatale)}'`
  )

  const mercatoMasi = fixtureItems.find((it) => it.Id === 'E2930332B19245A7AE5FE1827EA81407')
  if (!mercatoMasi) throw new Error('fixture priva dell\'item E2930332B19245A7AE5FE1827EA81407 (Mercato dei masi)')
  assert(
    resolvedCategory(mercatoMasi) === 'Fiere e mercati',
    `"18° Mercato dei masi" deve finire fra le fiere e i mercati, ottenuto '${resolvedCategory(mercatoMasi)}'`
  )

  const settimaneCastagna = fixtureItems.find((it) => it.Id === '96E8BF5118B348BDA1165F16440E6334')
  if (!settimaneCastagna) throw new Error('fixture priva dell\'item 96E8BF5118B348BDA1165F16440E6334 (Settimane della Castagna)')
  assert(
    resolvedCategory(settimaneCastagna) === 'Food & Wine',
    `"Settimane della Castagna" deve finire fra enogastronomia, ottenuto '${resolvedCategory(settimaneCastagna)}'`
  )

  const torggelen = fixtureItems.find((it) => it.Id === 'D77663BAD9324D1ABEDB5C51A400329D')
  if (!torggelen) throw new Error('fixture priva dell\'item D77663BAD9324D1ABEDB5C51A400329D (Törggelen)')
  assert(
    resolvedCategory(torggelen) === 'Food & Wine',
    `titolo con "Törggelen" deve finire fra enogastronomia, ottenuto '${resolvedCategory(torggelen)}'`
  )

  const corsaDobbiaco = fixtureItems.find((it) => it.Id === '6886BAE78A7D47AAA0FB484D0B41FD00')
  if (!corsaDobbiaco) throw new Error('fixture priva dell\'item 6886BAE78A7D47AAA0FB484D0B41FD00 (Corsa)')
  assert(
    resolvedCategory(corsaDobbiaco) === 'Sport e outdoor',
    `titolo con "Corsa" deve finire nello sport, ottenuto '${resolvedCategory(corsaDobbiaco)}'`
  )

  const skimarathon = fixtureItems.find((it) => it.Id === '3A8DA1FABDE840A2B049FD7DA9CA2A20')
  if (!skimarathon) throw new Error('fixture priva dell\'item 3A8DA1FABDE840A2B049FD7DA9CA2A20 (Skimarathon)')
  assert(
    resolvedCategory(skimarathon) === 'Sport e outdoor',
    `titolo con "Skimarathon" deve finire nello sport, ottenuto '${resolvedCategory(skimarathon)}'`
  )

  const coppaMondo = fixtureItems.find((it) => it.Id === 'E96DBA2D1BF0495C904C7F4E97BE6963')
  if (!coppaMondo) throw new Error('fixture priva dell\'item E96DBA2D1BF0495C904C7F4E97BE6963 (Coppa del Mondo)')
  assert(
    resolvedCategory(coppaMondo) === 'Sport e outdoor',
    `titolo con "Coppa del Mondo" deve finire nello sport, ottenuto '${resolvedCategory(coppaMondo)}'`
  )

  // Titolo di solo tedesco (Detail.it.Title assente): riceve comunque una
  // valutazione — non deve lanciare, e il valore risolto e' sempre uno dei
  // 7 nomi canonici (mai una stringa inventata).
  const germanOnlyCategory = resolvedCategory(noItalianTitle)
  assert(
    CANONICAL_CATEGORY_NAMES.includes(germanOnlyCategory),
    `un titolo di solo tedesco deve ricevere una valutazione valida (nome canonico), ottenuto '${germanOnlyCategory}'`
  )

  // Tag riconosciuto (marketing, mappato a 'Altro') ha precedenza sul
  // titolo anche quando il titolo suggerirebbe una categoria reale.
  const tagPrecedence = fixtureItems.find((it) => it.Id === 'D9E1AB90093E444691B0B2950BE1BD05')
  if (!tagPrecedence) throw new Error('fixture priva dell\'item D9E1AB90093E444691B0B2950BE1BD05 (precedenza tag)')
  assert(
    (tagPrecedence.SmgTags ?? []).length === 1 && tagPrecedence.SmgTags?.[0] === 'regionale top event',
    'precondizione: D9E1AB90093E444691B0B2950BE1BD05 deve avere il solo tag marketing "regionale top event"'
  )
  assert(
    resolvedCategory(tagPrecedence) === 'Altro',
    `un tag riconosciuto deve avere precedenza sul titolo (qui "castagna"/"festa" suggerirebbero altro), ottenuto '${resolvedCategory(tagPrecedence)}'`
  )

  // Titolo che nessuna regola riconosce -> null da deriveAltoAdigeCategory,
  // canonicalizeCategory lo risolve in 'Altro' senza lanciare.
  const noRuleMatch = fixtureItems.find((it) => it.Id === 'AFC468AC571C410FB57D4A86A47A088D')
  if (!noRuleMatch) throw new Error('fixture priva dell\'item AFC468AC571C410FB57D4A86A47A088D (nessuna regola)')
  assert(
    deriveAltoAdigeCategory(noRuleMatch) === null,
    `un titolo che nessuna regola riconosce deve restituire null, ottenuto '${deriveAltoAdigeCategory(noRuleMatch)}'`
  )
  assert(
    resolvedCategory(noRuleMatch) === 'Altro',
    `un titolo non riconosciuto deve risolvere in 'Altro' via canonicalizeCategory, ottenuto '${resolvedCategory(noRuleMatch)}'`
  )

  const targetTest = 'transformAltoAdigeItems + deriveAltoAdigeCategory implementano il comportamento D-10/D-11/D-12 (19-01)'
  console.log(`# tests ${passCount + failCount}`)
  console.log(`# pass ${passCount}`)
  console.log(`# fail ${failCount}`)
  if (failed) {
    console.log(`not ok 1 - ${targetTest}`)
    process.exit(1)
  } else {
    console.log(`ok 1 - ${targetTest}`)
    console.log('[altoadige.ts] self-check OK')
  }
}
