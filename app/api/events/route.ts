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

// Helper per convertire Decimal in number

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
		const limit = parseInt(searchParams.get("limit") || "16");
		const offset = parseInt(searchParams.get("offset") || "0");
		const location = searchParams.get("location") || "";

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

		const where: any = {
			dateStart: { gte: startDate },
		};

		if (dateTo) {
			where.dateStart.lte = new Date(dateTo);
		}

		if (search) {
			where.OR = [
				{ title: { contains: search, mode: "insensitive" } },
				{ description: { contains: search, mode: "insensitive" } },
				{ locationName: { contains: search, mode: "insensitive" } },
			];
		}

		if (category && category !== "all") {
			where.category = { equals: category, mode: "insensitive" };
		}

		// Filtro città: usa contains case-insensitive per più flessibilità
		if (location) {
			where.locationName = { contains: location, mode: "insensitive" };
		} else if (cities.length > 0) {
			// Fallback: se location matcha città suggerite, usa OR per tutte
			where.OR = [
				...(where.OR || []),
				...cities.map((city) => ({
					locationName: { contains: city, mode: "insensitive" },
				})),
			];
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

			// Applica paginazione sui risultati filtrati
			events = filteredEvents.slice(offset, offset + limit);
			total = filteredEvents.length;

			// For map: use all filtered events with lightweight fields.
			// resolvedLatitude/resolvedLongitude sono il punto che la mappa usa
			// davvero (D-09/D-14, Fase 6): senza questi campi gli eventi agganciati
			// al solo centroide del comune non avrebbero nessun punto da leggere.
			mapEvents = filteredEvents.map((e) => ({
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
				category: e.category,
				imageUrl: e.imageUrl,
				source: e.source,
				sourceId: e.sourceId,
			}));
		} else {
			// Senza filtro raggio: query normale con paginazione DB
			events = await prisma.event.findMany({
				where,
				orderBy: { dateStart: "asc" },
				take: limit,
				skip: offset,
			});

			total = await prisma.event.count({ where });

			// Fetch lightweight event data for map (all matching events, no pagination).
			// resolvedLatitude/resolvedLongitude sono il punto che la mappa usa
			// davvero (D-09/D-14, Fase 6): senza questi campi gli eventi agganciati
			// al solo centroide del comune non avrebbero nessun punto da leggere.
			const mapEventsRaw = await prisma.event.findMany({
				where,
				orderBy: { dateStart: "asc" },
				select: {
					id: true,
					latitude: true,
					longitude: true,
					resolvedLatitude: true,
					resolvedLongitude: true,
					coordinateSource: true,
					title: true,
					dateStart: true,
					locationName: true,
					category: true,
					imageUrl: true,
					source: true,
					sourceId: true,
				},
			});

			mapEvents = mapEventsRaw.map((e) => ({
				...e,
				latitude: e.latitude ? parseFloat(e.latitude.toString()) : null,
				longitude: e.longitude ? parseFloat(e.longitude.toString()) : null,
				resolvedLatitude: e.resolvedLatitude
					? parseFloat(e.resolvedLatitude.toString())
					: null,
				resolvedLongitude: e.resolvedLongitude
					? parseFloat(e.resolvedLongitude.toString())
					: null,
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

		return NextResponse.json({
			events: events.map(serializeEvent),
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
