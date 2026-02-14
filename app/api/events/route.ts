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

// Helper per convertire Decimal in number
function convertEventCoordinates(event: PrismaEvent): Event {
	return {
		...event,
		latitude: event.latitude ? parseFloat(event.latitude.toString()) : null,
		longitude: event.longitude ? parseFloat(event.longitude.toString()) : null,
	};
}

const LOMBARDY_CITIES = [
	"Milano",
	"Bergamo",
	"Brescia",
	"Como",
	"Cremona",
	"Lecco",
	"Lodi",
	"Mantova",
	"Monza",
	"Pavia",
	"Sondrio",
	"Varese",
];

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
		const cities = parseCitiesFromLocation(location);

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

			// Filtra per raggio
			const filteredEvents = allEvents.filter((event) => {
				if (!event.latitude || !event.longitude) return false;
				const distance = calculateDistance(
					userLat,
					userLng,
					parseFloat(event.latitude.toString()),
					parseFloat(event.longitude.toString())
				);
				return distance <= radiusKm;
			});

			// Applica paginazione sui risultati filtrati
			events = filteredEvents.slice(offset, offset + limit);
			total = filteredEvents.length;

			// For map: use all filtered events with lightweight fields
			mapEvents = filteredEvents.map((e) => ({
				id: e.id,
				latitude: e.latitude ? parseFloat(e.latitude.toString()) : null,
				longitude: e.longitude ? parseFloat(e.longitude.toString()) : null,
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

			// Fetch lightweight event data for map (all matching events, no pagination)
			const mapEventsRaw = await prisma.event.findMany({
				where,
				orderBy: { dateStart: "asc" },
				select: {
					id: true,
					latitude: true,
					longitude: true,
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
			// CASO 1: Nessun evento trovato → Refresh SINCRONO
			if (total === 0 && cacheResult?.shouldTrigger) {
				console.log(
					"[Refresh On-Demand] No events found, triggering synchronous refresh..."
				);

				let executionId: string | null = null;

				try {
					executionId = await createWorkflowExecution(cacheQuery);

					// Run scrapers
					const params = {
						dateFrom: cacheQuery.dateFrom,
						dateTo: cacheQuery.dateTo
					};

					const result = await runAllScrapers(params);
					await completeWorkflowExecution(executionId, result.saved);

					refreshTriggered = true;
					console.log('[Refresh On-Demand] Scraper refresh completed, re-fetching events...');

					// Re-fetch eventi dopo il refresh
					if (lat && lng && radius) {
						const userLat = parseFloat(lat);
						const userLng = parseFloat(lng);
						const radiusKm = parseFloat(radius);
						const allEvents = await prisma.event.findMany({
							where,
							orderBy: { dateStart: "asc" },
						});
						const filteredEvents = allEvents.filter((event) => {
							if (!event.latitude || !event.longitude) return false;
							const distance = calculateDistance(
								userLat,
								userLng,
								parseFloat(event.latitude.toString()),
								parseFloat(event.longitude.toString())
							);
							return distance <= radiusKm;
						});
						events = filteredEvents.slice(0, limit);
						total = filteredEvents.length;

						// Also update mapEvents after scrape
						mapEvents = filteredEvents.map((e) => ({
							id: e.id,
							latitude: e.latitude ? parseFloat(e.latitude.toString()) : null,
							longitude: e.longitude ? parseFloat(e.longitude.toString()) : null,
							title: e.title,
							dateStart: e.dateStart,
							locationName: e.locationName,
							category: e.category,
							imageUrl: e.imageUrl,
							source: e.source,
							sourceId: e.sourceId,
						}));
					} else {
						events = await prisma.event.findMany({
							where,
							orderBy: { dateStart: "asc" },
							take: limit,
						});
						total = await prisma.event.count({ where });

						// Also fetch mapEvents after scrape
						const mapEventsRaw = await prisma.event.findMany({
							where,
							orderBy: { dateStart: "asc" },
							select: {
								id: true,
								latitude: true,
								longitude: true,
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
						}));
					}
				} catch (refreshError) {
					if (executionId) await failWorkflowExecution(executionId, String(refreshError));
					console.error(
						"[Refresh On-Demand] Error during refresh:",
						refreshError
					);
					// Continua con risultati vuoti
				}
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
			events: events.map(convertEventCoordinates),
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

function parseCitiesFromLocation(location: string): string[] {
	return LOMBARDY_CITIES.filter((city) =>
		location.toLowerCase().includes(city.toLowerCase())
	);
}

function calculateDistance(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number
): number {
	const R = 6371; // Raggio Terra in km
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) * Math.sin(dLat / 2) +
		Math.cos(toRad(lat1)) *
			Math.cos(toRad(lat2)) *
			Math.sin(dLon / 2) *
			Math.sin(dLon / 2);
	const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	return R * c;
}

function toRad(degrees: number): number {
	return degrees * (Math.PI / 180);
}
