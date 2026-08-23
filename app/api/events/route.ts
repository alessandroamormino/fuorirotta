import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
	checkCache,
	createWorkflowExecution,
	completeWorkflowExecution,
	failWorkflowExecution,
} from "@/lib/cacheService";
import { runAllScrapers } from "@/lib/scrapers";
import { Prisma, Event as PrismaEvent } from "@prisma/client";
import { Event } from "@/lib/types";
import { calculateDistanceKm } from "@/lib/territorial/distance";
import { serializeEvent } from "@/lib/serializeEvent";
import { composeEvent, groupMembersByCanonical } from "@/lib/dedup/compose";

// Helper per convertire Decimal in number

// DEDUP-04: compone i campi di ciascun evento canonico con la sua versione
// piu' ricca (D-13), con UNA sola query aggiuntiva per il lotto passato, mai
// una per evento (niente N+1). Fattorizzata perche' e' chiamata da entrambi i
// rami raggio/non-raggio: applicarla a un solo percorso riprodurrebbe
// esattamente il difetto che WR-01 ha gia' corretto su questo stesso file per
// search/cities.
async function withComposedFields<T extends PrismaEvent>(
	events: T[]
): Promise<T[]> {
	if (events.length === 0) return events;

	const canonicalIds = events.map((e) => e.id);
	const members = await prisma.event.findMany({
		where: { canonicalEventId: { in: canonicalIds } },
		orderBy: { id: "asc" },
	});
	const membersByCanonical = groupMembersByCanonical(members);

	return events.map(
		(e) => composeEvent(e, membersByCanonical.get(e.id) ?? []) as T
	);
}

export async function GET(request: NextRequest) {
	try {
		const searchParams = request.nextUrl.searchParams;

		// Parametri query
		const search = searchParams.get("search") || "";
		const category = searchParams.get("category") || "";
		const dateFrom = searchParams.get("dateFrom");
		const dateTo = searchParams.get("dateTo");
		const lat = searchParams.get("lat");
		const lng = searchParams.get("lng");
		const radius = searchParams.get("radius");
		// WR-03: limit/offset raggiungevano Prisma non validati — parseInt("abc")
		// e' NaN, che come take/skip fa 500-are Prisma per un typo di querystring;
		// senza limite superiore, ?limit=100000000 legge l'intera tabella; con
		// offset negativo, filteredEvents.slice(-5, ...) restituisce la coda
		// invece di segnalare l'errore.
		const clampInt = (raw: string | null, def: number, min: number, max: number) => {
			const n = parseInt(raw ?? "", 10);
			return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
		};
		const limit = clampInt(searchParams.get("limit"), 16, 1, 100);
		const offset = clampInt(searchParams.get("offset"), 0, 0, 100_000);
		const location = searchParams.get("location") || "";

		// Identita' esatta del comune selezionata dall'autocomplete (D-01, D-07,
		// T-09-05): comuneId accettato solo se intero positivo, altrimenti
		// ignorato senza mai raggiungere Prisma o produrre un 500.
		const comuneIdParam = searchParams.get("comuneId");
		const parsedComuneId = comuneIdParam ? parseInt(comuneIdParam, 10) : NaN;
		const comuneId =
			Number.isInteger(parsedComuneId) && parsedComuneId > 0
				? parsedComuneId
				: null;
		const istatCode = searchParams.get("istatCode") || "";

		// Estrai città dal parametro location
		const cities = await parseCitiesFromLocation(location);

		// Build cache query
		const today = new Date().toISOString().split("T")[0];
		const endOfYear = `${new Date().getFullYear()}-12-31`;

		const cacheQuery = {
			cities: cities.length > 0 ? cities : undefined,
			radiusKm: radius ? parseInt(radius) : undefined,
			centerLat: lat ? parseFloat(lat) : undefined,
			centerLng: lng ? parseFloat(lng) : undefined,
			dateFrom: dateFrom || today,
			dateTo: dateTo || endOfYear,
		};

		// CACHE CHECK
		let cacheResult: {
			isCached: boolean;
			isRunning: boolean;
			shouldTrigger: boolean;
			isFresh: boolean;
			ageHours: number | null;
			execution?: {
				id: string;
				lastExecutedAt: Date;
				status: string;
				eventCount: number;
			};
		} | null = null;

		try {
			cacheResult = await checkCache(cacheQuery);

			if (cacheResult.isCached && cacheResult.execution) {
				const ageHours =
					(Date.now() - cacheResult.execution.lastExecutedAt.getTime()) /
					(1000 * 60 * 60);
				console.log(
					`[Cache] Data age: ${ageHours.toFixed(1)}h, Events: ${
						cacheResult.execution.eventCount
					}`
				);
			} else {
				console.log(
					"[Cache] Reading from database (use /api/scrape to update data from sources)"
				);
			}
		} catch (cacheError: any) {
			console.warn("[Cache] Check failed, proceeding with database query");
		}

		// QUERY DATABASE
		// Se non c'è dateFrom, usa l'inizio di oggi (00:00:00) invece dell'ora attuale
		const startDate = dateFrom
			? new Date(dateFrom)
			: new Date(new Date().setHours(0, 0, 0, 0));

		// DEDUP-01: un evento presente in piu' sorgenti compare una volta sola.
		// Va nel where di base (non in uno dei due rami raggio/non-raggio piu'
		// sotto) perche' sono due percorsi di codice distinti che altrimenti
		// erediterebbero il filtro solo uno dei due — esattamente il difetto che
		// WR-01 ha gia' corretto in Fase 9 su questo stesso file per search/cities.
		const where: any = {
			dateStart: { gte: startDate },
			canonicalEventId: null,
		};

		if (dateTo) {
			where.dateStart.lte = new Date(dateTo);
		}

		// WR-01: search e il ramo comuneId/cities generano ciascuno il proprio
		// gruppo OR — fonderli in un solo array where.OR (come faceva prima)
		// trasforma AND(search-OR, restrizione-OR) in un'unica disgiunzione
		// piatta, e il termine di ricerca smette di filtrare. Ogni gruppo vive
		// nel proprio { OR: [...] } dentro where.AND, cosi' Prisma li combina
		// con AND come previsto.
		const andGroups: Prisma.EventWhereInput[] = [];

		if (search) {
			andGroups.push({
				OR: [
					{ title: { contains: search, mode: "insensitive" } },
					{ description: { contains: search, mode: "insensitive" } },
					{ locationName: { contains: search, mode: "insensitive" } },
				],
			});
		}

		// Fase 11 (D-12): il filtro legge la colonna canonica, mai quella
		// grezza. Un nome canonico non compare mai nella colonna raw, quindi
		// filtrare su where.category restituirebbe sempre zero righe. Additivo
		// alla restrizione canonicalEventId:null sopra (D-13), non la sostituisce.
		if (category && category !== "all") {
			where.canonicalCategory = { equals: category, mode: "insensitive" };
		}

		// Identita' esatta del comune (D-01): un evento agganciato a comuneId ma
		// con un locationName diverso deve comunque comparire, e un evento senza
		// comuneId (tutti quelli di in-lombardia, che non nomina mai il comune)
		// ma con locationName corrispondente non deve sparire. L'OR e' l'unica
		// forma che soddisfa entrambe le meta' — un match esatto perderebbe gli
		// 862 eventi su 2652 senza comuneId.
		if (comuneId || istatCode) {
			const comuneBranch = comuneId
				? { comuneId }
				: { comune: { istatCode } };
			const locationBranch = location
				? [{ locationName: { contains: location, mode: "insensitive" as const } }]
				: [];
			andGroups.push({ OR: [comuneBranch, ...locationBranch] });
		} else if (location) {
			// Filtro città: usa contains case-insensitive per più flessibilità
			where.locationName = { contains: location, mode: "insensitive" };
		} else if (cities.length > 0) {
			// Fallback: se location matcha città suggerite, usa OR per tutte
			andGroups.push({
				OR: cities.map((city) => ({
					locationName: { contains: city, mode: "insensitive" },
				})),
			});
		}

		if (andGroups.length > 0) {
			where.AND = andGroups;
		}

		// GESTIONE FILTRO RAGGIO
		let events: any[];
		let total: number;
		let mapEvents: any[];

		if (lat && lng && radius) {
			// Con filtro raggio: fetch TUTTI gli eventi, filtra in memoria, poi pagina
			const userLat = parseFloat(lat);
			const userLng = parseFloat(lng);
			const radiusKm = parseFloat(radius);

			// Fetch tutti gli eventi che matchano i criteri base (senza paginazione)
			const allEvents = await prisma.event.findMany({
				where,
				orderBy: { dateStart: "asc" },
			});

			// Filtra per raggio sul punto RISOLTO, lo stesso che legge la mappa
			// (D-09/D-14): un evento agganciato al solo centroide del comune ha
			// latitude/longitude di sorgente nulle, e filtrando su quelle sparirebbe
			// dai risultati pur avendo un punto perfettamente valido.
			// I confronti sono su null e non sulla verita' del valore: 0 e' una
			// coordinata valida e un test falsy la scarterebbe in silenzio.
			const filteredEvents = allEvents.filter((event) => {
				const lat = event.resolvedLatitude ?? event.latitude;
				const lng = event.resolvedLongitude ?? event.longitude;
				if (lat === null || lng === null) return false;
				const distance = calculateDistanceKm(
					userLat,
					userLng,
					parseFloat(lat.toString()),
					parseFloat(lng.toString())
				);
				return distance <= radiusKm;
			});

			// DEDUP-04: compone una volta sola l'intero set filtrato (non solo la
			// pagina) perche' la stessa lista alimenta sia la pagina corrente sia i
			// dati della mappa: una sola query aggiuntiva serve entrambi gli usi,
			// invece delle due chiamate separate del ramo senza raggio (dove pagina
			// e mappa arrivano gia' da due query DB distinte).
			const composedFilteredEvents = await withComposedFields(filteredEvents);

			// Applica paginazione sui risultati filtrati e composti
			events = composedFilteredEvents.slice(offset, offset + limit);
			total = filteredEvents.length;

			// For map: use all filtered events (composed) with lightweight fields.
			// resolvedLatitude/resolvedLongitude sono il punto che la mappa usa
			// davvero (D-09/D-14, Fase 6): senza questi campi gli eventi agganciati
			// al solo centroide del comune non avrebbero nessun punto da leggere.
			mapEvents = composedFilteredEvents.map((e) => ({
				id: e.id,
				latitude: e.latitude ? parseFloat(e.latitude.toString()) : null,
				longitude: e.longitude ? parseFloat(e.longitude.toString()) : null,
				resolvedLatitude: e.resolvedLatitude
					? parseFloat(e.resolvedLatitude.toString())
					: null,
				resolvedLongitude: e.resolvedLongitude
					? parseFloat(e.resolvedLongitude.toString())
					: null,
				coordinateSource: e.coordinateSource,
				title: e.title,
				dateStart: e.dateStart,
				locationName: e.locationName,
				category: e.canonicalCategory,
				imageUrl: e.imageUrl,
				source: e.source,
				sourceId: e.sourceId,
			}));
		} else {
			// Senza filtro raggio: query normale con paginazione DB
			const pageEvents = await prisma.event.findMany({
				where,
				orderBy: { dateStart: "asc" },
				take: limit,
				skip: offset,
			});
			// DEDUP-04: compone solo la pagina corrente, una query aggiuntiva sui
			// soli membri dei gruppi di questa pagina (niente N+1).
			events = await withComposedFields(pageEvents);

			total = await prisma.event.count({ where });

			// Fetch dati per la mappa (tutti gli eventi che matchano, non
			// paginati). DEDUP-04: servono i campi componibili (title/imageUrl/
			// locationName/category) per non mostrare nel popup un valore diverso
			// dalla scheda dello stesso evento fuso — description non serve alla
			// mappa e resta fuori. La select ristretta di prima e' sostituita da
			// righe complete: comporre solo i campi necessari via una select
			// parziale avrebbe richiesto una seconda forma ad-hoc di
			// composeEvent; riusare le righe intere e la stessa funzione
			// factorizzata e' piu' semplice e non introduce divergenze, e il
			// costo in byte e' accettabile al volume attuale (~2.700 eventi).
			// resolvedLatitude/resolvedLongitude sono il punto che la mappa usa
			// davvero (D-09/D-14, Fase 6): senza questi campi gli eventi agganciati
			// al solo centroide del comune non avrebbero nessun punto da leggere.
			const mapEventsRaw = await prisma.event.findMany({
				where,
				orderBy: { dateStart: "asc" },
			});
			const composedMapEvents = await withComposedFields(mapEventsRaw);

			mapEvents = composedMapEvents.map((e) => ({
				id: e.id,
				latitude: e.latitude ? parseFloat(e.latitude.toString()) : null,
				longitude: e.longitude ? parseFloat(e.longitude.toString()) : null,
				resolvedLatitude: e.resolvedLatitude
					? parseFloat(e.resolvedLatitude.toString())
					: null,
				resolvedLongitude: e.resolvedLongitude
					? parseFloat(e.resolvedLongitude.toString())
					: null,
				coordinateSource: e.coordinateSource,
				title: e.title,
				dateStart: e.dateStart,
				locationName: e.locationName,
				category: e.canonicalCategory,
				imageUrl: e.imageUrl,
				source: e.source,
				sourceId: e.sourceId,
			}));
		}

		// ========== REFRESH ON-DEMAND LOGIC ==========
		// Solo alla prima pagina (offset === 0) per evitare refresh multipli
		console.log(
			`[Refresh] offset=${offset}, total=${total}, cacheResult=`,
			cacheResult
		);

		let refreshTriggered = false;

		if (offset === 0) {
			// CASO 1: Nessun evento trovato → Refresh ASINCRONO (08-05, T-08-18)
			// Era sincrono (await runAllScrapers prima di rispondere). Con il Crawl-delay
			// di in-lombardia.it (D-10) la durata proiettata misurata è di almeno ~53 minuti
			// (limite inferiore) — ben oltre qualunque timeout HTTP/proxy/serverless, quindi
			// il ramo sincrono restituiva già un errore, mai risultati freschi. Reso
			// fire-and-forget con lo stesso pattern già usato dal CASO 2 sotto: risposta
			// vuota immediata, popolamento in background — un errore garantito diventa una
			// risposta vuota immediata, coerente con la promessa cache-first di PROJECT.md.
			if (total === 0 && cacheResult?.shouldTrigger) {
				console.log(
					"[Refresh On-Demand] No events found, triggering background refresh..."
				);

				refreshTriggered = true;

				// Fire-and-forget: non aspettiamo il completamento (stesso pattern del CASO 2)
				createWorkflowExecution(cacheQuery)
					.then(async (executionId) => {
						try {
							const params = {
								dateFrom: cacheQuery.dateFrom,
								dateTo: cacheQuery.dateTo
							};
							const result = await runAllScrapers(params);
							await completeWorkflowExecution(executionId, result.saved);
						} catch (err) {
							await failWorkflowExecution(executionId, String(err));
							console.error('[Refresh On-Demand] Background refresh failed:', err);
						}
					})
					.catch(err => console.error('[Refresh On-Demand] Background refresh failed:', err));
			}
			// CASO 2: Eventi trovati ma cache vecchia (>4h) → Refresh ASINCRONO
			else if (
				total > 0 &&
				cacheResult?.shouldTrigger &&
				!cacheResult?.isRunning
			) {
				console.log(
					"[Refresh On-Demand] Cache stale, triggering background refresh..."
				);

				refreshTriggered = true;

				// Fire-and-forget: non aspettiamo il completamento
				createWorkflowExecution(cacheQuery)
					.then(async (executionId) => {
						try {
							const params = { dateFrom: cacheQuery.dateFrom, dateTo: cacheQuery.dateTo };
							const result = await runAllScrapers(params);
							await completeWorkflowExecution(executionId, result.saved);
						} catch (err) {
							await failWorkflowExecution(executionId, String(err));
							console.error('[Refresh On-Demand] Background refresh failed:', err);
						}
					})
					.catch(err => console.error('[Refresh On-Demand] Background refresh failed:', err));
			}
		}
		// ==============================================

		// Fase 11: la lista paginata mostra la colonna canonica in `category`,
		// non quella grezza composta da withComposedFields() (che compone solo
		// il testo di sorgente, mai canonicalCategory - vedi il commento sopra
		// COMPOSABLE_FIELDS in lib/dedup/compose.ts). Senza questa riga il
		// filtro sulla lista funziona ma la scheda mostrerebbe il valore
		// grezzo (es. "Sagra") invece del nome canonico richiesto.
		return NextResponse.json({
			events: events.map((e) => serializeEvent({ ...e, category: e.canonicalCategory })),
			mapEvents, // ALL matching events (lightweight) for map rendering
			total,
			limit,
			offset,
			cache: {
				hit: cacheResult?.isCached || false,
				fresh: cacheResult?.isFresh || false,
				age_hours: cacheResult?.ageHours ?? null,
				refreshing: refreshTriggered,
				last_event_count: cacheResult?.execution?.eventCount ?? null,
			},
		});
	} catch (error) {
		console.error("[API] Error fetching events:", error);
		return NextResponse.json(
			{ error: "Failed to fetch events" },
			{ status: 500 }
		);
	}
}

// Estrae i nomi di comune contenuti nella stringa `location` interrogando la
// tabella comuni (TERR-06): sostituisce la vecchia lista lombarda hardcoded
// rimossa da questo file. Il contratto resta identico a prima — stringa in
// ingresso, lista di nomi in uscita — cambia solo da dove arrivano i nomi.
async function parseCitiesFromLocation(location: string): Promise<string[]> {
	const trimmed = location.trim();
	// Ritorno anticipato senza interrogare il DB: sotto i 4 caratteri una
	// `contains` costruita male trasformerebbe una ricerca vuota/troppo corta
	// in "tutti i comuni d'Italia" (edge empty).
	if (trimmed.length < 4) return [];

	// position(name IN location) e' l'inverso di una contains: verifica che il
	// nome del comune sia contenuto nella stringa utente, non il contrario.
	// Tagged template -> query parametrizzata dal driver, mai concatenazione
	// di stringhe (la stringa arriva da un parametro di query HTTP, T-06-14).
	// length(name) >= 4 scarta i comuni di 2-3 lettere (Ne, Ro, Vo', Ala, Uta):
	// senza questo filtro qualunque stringa che li contenga come sottostringa
	// produrrebbe un falso positivo. La Fase 9 introduce un autocomplete sui
	// comuni con selezione esplicita dell'utente: a quel punto questo filtro
	// di lunghezza non serve più.
	const rows = await prisma.$queryRaw<{ name: string }[]>`
		SELECT name FROM comuni
		WHERE length(name) >= 4
		  AND position(lower(name) IN lower(${trimmed})) > 0
		ORDER BY length(name) DESC, name ASC
		LIMIT 20
	`;

	return rows.map((row) => row.name);
}
