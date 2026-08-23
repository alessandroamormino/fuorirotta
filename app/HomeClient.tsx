"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Event, SearchFilters } from "@/lib/types";
import EventCard from "@/components/EventCard";
import Navbar from "@/components/Navbar";
import CategoryFilterBar from "@/components/CategoryFilterBar";
import { CANONICAL_CATEGORIES } from "@/lib/categories/taxonomy";
import { ChevronLeft, ChevronRight, Filter, Loader2, Map, X } from "lucide-react";
import { useEventCache } from "@/lib/eventCache";

const EventsMap = dynamic(() => import("@/components/EventsMap"), {
	ssr: false,
	loading: () => (
		<div className="w-full h-full bg-muted-strong">
			<div className="flex items-center justify-center h-full">
				<Loader2 className="w-8 h-8 text-primary animate-spin" />
			</div>
		</div>
	),
});

interface HomeClientProps {
	initialEvents: Event[];
	initialTotal: number;
}

export default function HomeClient({ initialEvents, initialTotal }: HomeClientProps) {
	const LIMIT = 12;
	const router = useRouter();
	const { getCachedEvents, setCachedEvents } = useEventCache();

	const generateQueryKey = (filters: SearchFilters, category: string) => {
		return JSON.stringify({
			location: filters.location || '',
			dateFrom: filters.dateFrom?.toISOString() || '',
			dateTo: filters.dateTo?.toISOString() || '',
			radius: filters.radius || '',
			comuneId: filters.comuneId ?? '',
			comuneIstatCode: filters.comuneIstatCode || '',
			category: category || 'all'
		});
	};

	const [events, setEvents] = useState<Event[]>(initialEvents);
	const [mapEvents, setMapEvents] = useState<Event[]>(initialEvents);
	const [loading, setLoading] = useState(false);
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [categories, setCategories] = useState<{ name: string; count: number }[]>([]);
	const [clusterGeoJSON, setClusterGeoJSON] = useState<any>(null);

	const [searchFilters, setSearchFilters] = useState<SearchFilters>({ location: "", dateFrom: null, dateTo: null, radius: undefined });
	const [userLocation, setUserLocation] = useState<{
		lat: number;
		lng: number;
	} | null>(null);
	// Il termine categoria e' qui apposta: senza, effectiveClusterGeoJSON sotto
	// continuerebbe a servire la cache cluster precalcolata (non filtrata per
	// categoria) mentre la lista e' gia' filtrata — due risposte diverse sullo
	// stesso schermo (11-UI-SPEC.md, Interaction contract).
	const hasActiveFilters = !!(
		searchFilters.location || searchFilters.dateFrom || searchFilters.dateTo || searchFilters.radius ||
		(selectedCategory && selectedCategory !== "all")
	);
	const effectiveClusterGeoJSON = hasActiveFilters ? null : clusterGeoJSON;

	const [isMapExpanded, setIsMapExpanded] = useState(false);

	const [showTopBlur, setShowTopBlur] = useState(false);
	const [showBottomBlur, setShowBottomBlur] = useState(false);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const [navHeight, setNavHeight] = useState(112);
	useEffect(() => {
		const measure = () => {
			const nav = document.getElementById("main-navbar");
			if (!nav) return;
			const rect = nav.getBoundingClientRect();
			setNavHeight(rect.bottom);
		};
		measure();
		const ro = new ResizeObserver(measure);
		const nav = document.getElementById("main-navbar");
		if (nav) ro.observe(nav);
		return () => ro.disconnect();
	}, []);

	const [currentPage, setCurrentPage] = useState<number>(1);
	const [total, setTotal] = useState(initialTotal);

	useEffect(() => {
		sessionStorage.setItem("currentPage", currentPage.toString());
	}, [currentPage]);

	useEffect(() => {
		sessionStorage.setItem("searchFilters", JSON.stringify(searchFilters));
	}, [searchFilters]);

	useEffect(() => {
		sessionStorage.setItem("selectedCategory", selectedCategory);
	}, [selectedCategory]);

	useEffect(() => {
		if (navigator.geolocation) {
			navigator.geolocation.getCurrentPosition(
				(position) => {
					setUserLocation({
						lat: position.coords.latitude,
						lng: position.coords.longitude,
					});
				},
				(error) => {
					if (process.env.APP_DEBUG === "true") {
						console.log("Geolocation not enabled:", error);
					}
				}
			);
		}
	}, []);

	useEffect(() => {
		fetch('/api/events/clusters')
			.then(res => {
				if (!res.ok) throw new Error('Cluster fetch failed');
				return res.json();
			})
			.then(data => {
				if (data.geojson) {
					setClusterGeoJSON(data.geojson);
				}
			})
			.catch(err => console.warn('[Clusters] Failed to load cached clusters:', err));
	}, []);

	// Faccetta categorie: un solo fetch al mount, mai rieseguito al cambio
	// filtri (i count delle chip sono globali per design, la loro somma e'
	// il totale non filtrato — vedi RESEARCH.md/11-UI-SPEC.md D-09).
	useEffect(() => {
		fetch('/api/categories')
			.then(res => {
				if (!res.ok) throw new Error('Categories fetch failed');
				return res.json();
			})
			.then(data => {
				if (Array.isArray(data)) {
					setCategories(data);
				}
			})
			.catch(err => console.warn('[Categories] Failed to load categories facet:', err));
	}, []);

	// On mount: check if user has active filters or cached data; otherwise use SSR data
	useEffect(() => {
		// Read sessionStorage after hydration to avoid SSR mismatch
		const savedPage = sessionStorage.getItem("currentPage");
		const savedFilters = sessionStorage.getItem("searchFilters");
		const page = savedPage ? parseInt(savedPage, 10) : 1;
		if (page !== 1) setCurrentPage(page);

		let activeFilters = searchFilters;
		if (savedFilters) {
			try {
				const parsed = JSON.parse(savedFilters);
				// sessionStorage e' scrivibile da qualunque script sulla stessa
				// origine: comuneId/comuneIstatCode arrivavano diretti in un
				// parametro URL senza controllo di tipo. Il server valida comuneId
				// (deve essere intero positivo, altrimenti ignorato), ma
				// istatCode no — innocuo oggi perche' Prisma parametrizza, ma
				// una guardia di tipo qui costa una riga.
				activeFilters = {
					location: parsed.location || "",
					dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : null,
					dateTo: parsed.dateTo ? new Date(parsed.dateTo) : null,
					radius: typeof parsed.radius === "number" ? parsed.radius : undefined,
					comuneId: typeof parsed.comuneId === "number" ? parsed.comuneId : undefined,
					comuneIstatCode:
						typeof parsed.comuneIstatCode === "string" ? parsed.comuneIstatCode : undefined,
				};
				setSearchFilters(activeFilters);
			} catch { /* ignore */ }
		}

		// T-11-11: sessionStorage e' scrivibile da qualunque script sulla stessa
		// origine. Un valore ripristinato accettato solo se e' "all" o uno dei 7
		// nomi canonici dichiarati — qualunque altra cosa viene scartata senza
		// essere applicata (mai inviata come query param).
		let activeCategory = selectedCategory;
		const savedCategory = sessionStorage.getItem("selectedCategory");
		if (
			savedCategory &&
			(savedCategory === "all" || (CANONICAL_CATEGORIES as readonly string[]).includes(savedCategory))
		) {
			activeCategory = savedCategory;
			setSelectedCategory(activeCategory);
		}

		const queryKey = generateQueryKey(activeFilters, activeCategory);
		const cached = getCachedEvents(queryKey);

		if (cached) {
			setEvents(cached.events);
			setMapEvents(cached.mapEvents || cached.events);
			setTotal(cached.total);
			if (page > 1) fetchEvents(page, activeFilters);
			return;
		}

		const hasFilters =
			activeFilters.location || activeFilters.dateFrom || activeFilters.dateTo || activeFilters.radius ||
			(activeCategory && activeCategory !== "all");

		if (!hasFilters && initialEvents.length > 0) {
			// Use SSR data and seed the cache
			setCachedEvents(queryKey, {
				events: initialEvents,
				mapEvents: initialEvents,
				total: initialTotal,
				query: queryKey,
			});
			if (page > 1) fetchEvents(page, activeFilters);
		} else {
			// WR-06: activeFilters esplicito, non il default searchFilters della
			// closure — setSearchFilters(activeFilters) sopra non e' ancora
			// visibile qui, stesso giro di funzione.
			fetchEvents(page, activeFilters);
		}
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const [isInitialMount, setIsInitialMount] = useState(true);

	useEffect(() => {
		if (isInitialMount) {
			setIsInitialMount(false);
			return;
		}

		const queryKey = generateQueryKey(searchFilters, selectedCategory);
		const cached = getCachedEvents(queryKey);

		if (cached) {
			setEvents(cached.events);
			setMapEvents(cached.mapEvents || cached.events);
			setTotal(cached.total);
			setLoading(false);
			setCurrentPage(1);
		} else {
			setLoading(true);
			setEvents([]);
			setMapEvents([]);
			fetchEvents(1);
		}
	}, [searchFilters, selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

	// WR-06: filters (default = searchFilters) invece di leggere searchFilters
	// dalla closure. Il mount effect sotto chiama setSearchFilters(activeFilters)
	// e poi fetchEvents(page) nello stesso giro: setState non e' sincrono, quindi
	// quella chiamata catturava ancora lo stato iniziale vuoto, non
	// activeFilters — al reload con filtri salvati in sessionStorage e una
	// useEventCache fredda, l'app interrogava eventi non filtrati mentre la
	// Navbar mostrava gia' i filtri ripristinati. Le altre call site (bottoni
	// di paginazione, l'effect [searchFilters]) restano corrette lasciando il
	// default, perche' li' il render e' gia' allineato allo stato corrente.
	const fetchEvents = async (page: number, filters: SearchFilters = searchFilters) => {
		if (process.env.APP_DEBUG === "true") {
			console.log(`[Fetch] Page ${page}`);
		}
		setLoading(true);
		setCurrentPage(page);
		try {
			const params = new URLSearchParams();
			params.append("page", page.toString());

			const isNearbySearch = filters.location?.startsWith("Nelle vicinanze");
			if (filters.location && !isNearbySearch) {
				params.append("location", filters.location);
			}

			// Identita' esatta del comune selezionato dall'autocomplete (D-01):
			// viaggia insieme al testo libero, non al suo posto.
			if (filters.comuneId) {
				params.append("comuneId", filters.comuneId.toString());
			}
			if (filters.comuneIstatCode) {
				params.append("istatCode", filters.comuneIstatCode);
			}

			if (selectedCategory && selectedCategory !== "all")
				params.append("category", selectedCategory);

			const formatLocalDate = (date: Date) => {
				const year = date.getFullYear();
				const month = String(date.getMonth() + 1).padStart(2, "0");
				const day = String(date.getDate()).padStart(2, "0");
				return `${year}-${month}-${day}`;
			};

			if (filters.dateFrom) {
				params.append("dateFrom", formatLocalDate(filters.dateFrom));
			}

			if (filters.dateTo) {
				params.append("dateTo", formatLocalDate(filters.dateTo));
			} else if (filters.dateFrom) {
				params.append("dateTo", formatLocalDate(filters.dateFrom));
			}

			if (userLocation) {
				params.append("lat", userLocation.lat.toString());
				params.append("lng", userLocation.lng.toString());
				if (filters.radius) {
					params.append("radius", filters.radius.toString());
				}
			}

			const offset = (page - 1) * LIMIT;
			params.append("limit", LIMIT.toString());
			params.append("offset", offset.toString());

			const response = await fetch(`/api/events?${params}`);

			if (!response.ok) {
				setLoading(false);
				return;
			}

			const data = await response.json();

			if (data.error || !data.events) {
				setLoading(false);
				return;
			}

			const newEvents = data.events || [];
			const newMapEvents = data.mapEvents || newEvents;
			const newTotal = data.total || 0;

			setEvents(newEvents);
			setMapEvents(newMapEvents);
			setTotal(newTotal);

			if (page === 1) {
				const queryKey = generateQueryKey(filters, selectedCategory);
				setCachedEvents(queryKey, {
					events: newEvents,
					mapEvents: newMapEvents,
					total: newTotal,
					query: queryKey,
				});
			}
		} catch (error) {
			if (process.env.APP_DEBUG === "true") {
				console.error("[fetchEvents] Error:", error);
			}
			setEvents([]);
			setMapEvents([]);
			setTotal(0);
		} finally {
			setLoading(false);
		}
	};

	const handleSearch = (filters: SearchFilters) => {
		setSearchFilters(filters);
	};

	// Idempotente: riselezionare la chip attiva (incluso "Tutte" mentre "Tutte"
	// e' attiva) non deve scrivere stato ne' innescare un refetch (T-11-12).
	const handleCategorySelect = (value: string) => {
		if (value === selectedCategory) return;
		setSelectedCategory(value);
	};

	const handleScroll = () => {
		if (!scrollContainerRef.current) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
		setShowTopBlur(scrollTop >= 10);
		setShowBottomBlur(scrollHeight - scrollTop - clientHeight >= 10);
	};

	useEffect(() => {
		handleScroll();
	}, [events]);

	return (
		<div className="min-h-screen bg-accent/5">
			<Navbar onSearch={handleSearch} onOpenMap={() => setIsMapExpanded(true)} />

			<main
				className="fixed left-0 right-0 bottom-0 overflow-hidden"
				style={{ top: navHeight }}
			>
				<div className="container mx-auto px-4 py-4 h-full flex flex-col gap-3">
					<CategoryFilterBar
						categories={categories}
						selected={selectedCategory}
						onSelect={handleCategorySelect}
					/>
					<div className="flex-1 min-h-0 flex gap-6">
					<div className="flex-1 min-w-0 flex flex-col min-h-0">
						<div className="flex-1 min-h-0 pb-4 relative">
							<div
								ref={scrollContainerRef}
								onScroll={handleScroll}
								className="h-full overflow-y-auto xl:overflow-hidden"
							>
								<AnimatePresence mode="wait">
									{loading ? (
										<motion.div
											key="loading"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0 }}
											className="flex items-center justify-center py-20"
										>
											<div className="text-center">
												<Loader2 className="w-12 h-12 text-primary animate-spin mx-auto mb-4" />
												<p className="text-muted-foreground">Caricamento eventi...</p>
											</div>
										</motion.div>
									) : events.length === 0 ? (
										<motion.div
											key="empty"
											initial={{ opacity: 0, y: 20 }}
											animate={{ opacity: 1, y: 0 }}
											exit={{ opacity: 0, y: -20 }}
											className="text-center py-20"
										>
											<div className="w-20 h-20 bg-muted-strong rounded-full flex items-center justify-center mx-auto mb-4">
												<Filter className="w-10 h-10 text-muted-foreground-faint" />
											</div>
											<h3 className="text-xl font-bold text-foreground mb-2">
												Nessun evento trovato
											</h3>
											<p className="text-muted-foreground">
												Prova a modificare i filtri di ricerca
											</p>
										</motion.div>
									) : (
										<div
											key="events"
											className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 gap-2 sm:gap-4 md:gap-4 lg:gap-2 xl:gap-4"
										>
											{events.map((event, index) => (
												<div
													key={`${event.source}-${event.id}`}
													className="event-card-item"
													style={{ animationDelay: `${index * 0.05}s` }}
												>
													<EventCard event={event} />
												</div>
											))}
										</div>
									)}
								</AnimatePresence>
							</div>
						</div>

						{!loading && events.length > 0 && (
							<div className="flex-shrink-0 py-2 sm:py-4">
								<div className="flex justify-between items-center gap-2 sm:gap-4">
									<p className="text-muted-foreground text-xs sm:text-sm font-medium">
										{total}
										<span className="hidden lg:inline"> Eventi totali</span>
									</p>
									<div className="bg-surface border border-accent/30 rounded-full flex items-center gap-1 sm:gap-2 px-2 py-2">
										{(() => {
											const totalPages = Math.ceil(total / LIMIT);
											if (totalPages <= 1) return null;

											const buildPages = (edge: number): (number | string)[] => {
												const pages: (number | string)[] = [];
												if (totalPages <= edge * 2 + 3) {
													for (let i = 1; i <= totalPages; i++) pages.push(i);
												} else {
													for (let i = 1; i <= edge; i++) pages.push(i);
													if (currentPage > edge + 1) pages.push('...');
													if (currentPage > edge && currentPage < totalPages - edge + 1) pages.push(currentPage);
													if (currentPage < totalPages - edge) pages.push('...');
													for (let i = totalPages - edge + 1; i <= totalPages; i++) pages.push(i);
												}
												return pages;
											};

											const renderPages = (pages: (number | string)[], size: 'sm' | 'md') =>
												pages.map((page, idx) => {
													if (page === '...') {
														return (
															<span key={`ellipsis-${idx}`} className={size === 'sm' ? "px-1 text-muted-foreground-faint text-xs" : "px-1 text-muted-foreground-faint text-sm"}>
																...
															</span>
														);
													}
													const pageNum = page as number;
													const base = size === 'sm'
														? "w-7 h-7 flex items-center justify-center rounded-full font-medium text-xs"
														: "w-9 h-9 flex items-center justify-center rounded-full font-medium text-sm";
													return (
														<button
															key={pageNum}
															onClick={() => fetchEvents(pageNum)}
															className={pageNum === currentPage ? `${base} bg-primary text-primary-foreground` : `${base} border border-border bg-surface text-foreground-secondary hover:bg-muted`}
														>
															{pageNum}
														</button>
													);
												});

											const prevBtn = (size: 'sm' | 'md') => (
												<button
													onClick={() => fetchEvents(currentPage - 1)}
													disabled={currentPage === 1}
													className={`${size === 'sm' ? 'w-7 h-7' : 'w-9 h-9'} flex items-center justify-center rounded-full border border-border bg-surface text-foreground-secondary hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface`}
												>
													<ChevronLeft className={size === 'sm' ? "w-4 h-4" : "w-5 h-5"} />
												</button>
											);

											const nextBtn = (size: 'sm' | 'md') => (
												<button
													onClick={() => fetchEvents(currentPage + 1)}
													disabled={currentPage === totalPages}
													className={`${size === 'sm' ? 'w-7 h-7' : 'w-9 h-9'} flex items-center justify-center rounded-full border border-border bg-surface text-foreground-secondary hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-surface`}
												>
													<ChevronRight className={size === 'sm' ? "w-4 h-4" : "w-5 h-5"} />
												</button>
											);

											return (
												<>
													<div className="flex sm:hidden items-center gap-1">
														{prevBtn('sm')}
														{renderPages(buildPages(2), 'sm')}
														{nextBtn('sm')}
													</div>
													<div className="hidden sm:flex items-center gap-2">
														{prevBtn('md')}
														{renderPages(buildPages(3), 'md')}
														{nextBtn('md')}
													</div>
												</>
											);
										})()}
									</div>
									<p className="text-muted-foreground text-xs sm:text-sm font-medium">
										{events.length + ' / ' + LIMIT}
									</p>
								</div>
							</div>
						)}
					</div>

					<div className="hidden xl:block w-[50%] max-w-4xl flex-shrink-0">
						<div className="h-full rounded-2xl overflow-hidden shadow-2xl border-2 border-accent/30 relative group">
							<EventsMap
								events={mapEvents}
								initialGeoJSON={effectiveClusterGeoJSON}
								mapId="map-sidebar"
								userLocation={userLocation}
							/>
							<motion.button
								onClick={() => setIsMapExpanded(true)}
								className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 bg-surface text-foreground rounded-full font-semibold flex items-center gap-2 shadow-lg hover:shadow-xl transition-all opacity-0 group-hover:opacity-100 z-[1000]"
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
							>
								<Map className="w-4 h-4" />
								Espandi mappa
							</motion.button>
						</div>
					</div>
					</div>
				</div>
			</main>

			<AnimatePresence>
				{isMapExpanded && (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.15 }}
						className="fixed inset-0 z-[100]"
					>
						<div
							className="hidden xl:block absolute inset-0 bg-black/50"
							onClick={() => setIsMapExpanded(false)}
						>
							<div
								className="absolute inset-4 bg-surface rounded-2xl overflow-hidden shadow-2xl"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="absolute top-0 left-0 right-0 z-10 bg-surface/95 backdrop-blur-lg border-b border-border px-6 py-4 flex items-center justify-between">
									<h3 className="text-lg font-bold text-foreground">
										Mappa eventi — {effectiveClusterGeoJSON ? effectiveClusterGeoJSON.features.length : mapEvents.length} eventi
									</h3>
									<button
										onClick={() => setIsMapExpanded(false)}
										className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-muted-strong transition-colors"
									>
										<X className="w-6 h-6 text-muted-foreground" />
									</button>
								</div>
								<div className="absolute inset-0 pt-16">
									<EventsMap
										events={mapEvents}
										initialGeoJSON={effectiveClusterGeoJSON}
										mapId="map-fullscreen-desktop"
										userLocation={userLocation}
									/>
								</div>
							</div>
						</div>

						<div className="xl:hidden absolute inset-0">
							<EventsMap
								events={mapEvents}
								initialGeoJSON={effectiveClusterGeoJSON}
								mapId="map-fullscreen-mobile"
								userLocation={userLocation}
							/>
							<div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-5 pb-4 pointer-events-none" style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}>
								<div className="bg-surface/90 backdrop-blur-md rounded-2xl px-4 py-2 shadow pointer-events-auto">
									<span className="text-sm font-semibold text-foreground">
										{mapEvents.length} {mapEvents.length === 1 ? "evento" : "eventi"}
									</span>
								</div>
								<button
									onClick={() => setIsMapExpanded(false)}
									className="w-11 h-11 rounded-full bg-surface/90 backdrop-blur-md shadow flex items-center justify-center pointer-events-auto mr-14"
								>
									<X className="w-5 h-5 text-foreground-secondary" />
								</button>
							</div>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
