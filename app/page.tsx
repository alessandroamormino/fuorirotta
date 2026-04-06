"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Event } from "@/lib/types";
import EventCard from "@/components/EventCard";
import Navbar from "@/components/Navbar";
import { ChevronLeft, ChevronRight, Filter, Loader2, Map, X } from "lucide-react";
import { useEventCache } from "@/lib/eventCache";

const EventsMap = dynamic(() => import("@/components/EventsMap"), {
	ssr: false,
	loading: () => (
		<div className="w-full h-full bg-gray-100">
			<div className="flex items-center justify-center h-full">
				<Loader2 className="w-8 h-8 text-[#006d77] animate-spin" />
			</div>
		</div>
	),
});

interface SearchFilters {
	location: string;
	dateFrom: Date | null;
	dateTo: Date | null;
	radius?: number;
}

export default function Home() {
	const LIMIT = 12;
	const router = useRouter();
	const { getCachedEvents, setCachedEvents } = useEventCache();

	// Helper to generate cache key from filters
	const generateQueryKey = (filters: SearchFilters, category: string) => {
		return JSON.stringify({
			location: filters.location || '',
			dateFrom: filters.dateFrom?.toISOString() || '',
			dateTo: filters.dateTo?.toISOString() || '',
			radius: filters.radius || '',
			category: category || 'all'
		});
	};

	// Initialize with empty arrays (prevents hydration mismatch)
	const [events, setEvents] = useState<Event[]>([]);
	const [mapEvents, setMapEvents] = useState<Event[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedCategory] = useState<string>("all");
	const [clusterGeoJSON, setClusterGeoJSON] = useState<any>(null);

	// Restore search filters from sessionStorage
	const [searchFilters, setSearchFilters] = useState<SearchFilters>(() => {
		if (typeof window !== "undefined") {
			const saved = sessionStorage.getItem("searchFilters");
			if (saved) {
				try {
					const parsed = JSON.parse(saved);
					return {
						location: parsed.location || "",
						dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : null,
						dateTo: parsed.dateTo ? new Date(parsed.dateTo) : null,
						radius: parsed.radius
					};
				} catch {
					return { location: "", dateFrom: null, dateTo: null, radius: undefined };
				}
			}
		}
		return { location: "", dateFrom: null, dateTo: null, radius: undefined };
	});
	const [userLocation, setUserLocation] = useState<{
		lat: number;
		lng: number;
	} | null>(null);
	const [isMapExpanded, setIsMapExpanded] = useState(false);

	// Scroll tracking for blur effects
	const [showTopBlur, setShowTopBlur] = useState(false);
	const [showBottomBlur, setShowBottomBlur] = useState(false);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	// Navbar height tracking via getBoundingClientRect
	const [navHeight, setNavHeight] = useState(112);
	useEffect(() => {
		const measure = () => {
			const nav = document.getElementById("main-navbar");
			if (!nav) return;
			const rect = nav.getBoundingClientRect();
			setNavHeight(rect.bottom); // bottom = distanza dal top della viewport = top + height
		};
		measure();
		const ro = new ResizeObserver(measure);
		const nav = document.getElementById("main-navbar");
		if (nav) ro.observe(nav);
		return () => ro.disconnect();
	}, []);

	// Pagination state - restore from sessionStorage
	const [currentPage, setCurrentPage] = useState<number>(() => {
		if (typeof window !== "undefined") {
			const saved = sessionStorage.getItem("currentPage");
			return saved ? parseInt(saved, 10) : 1;
		}
		return 1;
	});
	const [total, setTotal] = useState(0);

	// Save currentPage to sessionStorage when it changes
	useEffect(() => {
		sessionStorage.setItem("currentPage", currentPage.toString());
	}, [currentPage]);

	// Save search filters to sessionStorage when they change
	useEffect(() => {
		sessionStorage.setItem("searchFilters", JSON.stringify(searchFilters));
	}, [searchFilters]);

	// Request geolocation on mount
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

	// Fetch pre-cached cluster data on mount for instant map rendering
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

	// Restore cache on mount (after hydration) - runs once
	useEffect(() => {
		const queryKey = generateQueryKey(searchFilters, selectedCategory);
		const cached = getCachedEvents(queryKey);

		if (process.env.APP_DEBUG === "true") {
			console.log(`[Mount] Cache: ${cached ? 'found' : 'not found'}`);
		}

		if (cached) {
			// Restore cached events
			if (process.env.APP_DEBUG === "true") {
				console.log(`[Mount] Cached events: ${cached.events.length}`);
			}
			setEvents(cached.events);
			setMapEvents(cached.mapEvents || cached.events);
			setTotal(cached.total);
			setLoading(false);

			// If user was on a page > 1, fetch that page
			if (currentPage > 1) {
				fetchEvents(currentPage);
			}
		} else {
			// No cache, fetch initial data
			if (process.env.APP_DEBUG === "true") {
				console.log(`[Mount] Fetching page ${currentPage}`);
			}
			fetchEvents(currentPage);
		}
	}, []); // Run once on mount

	// Track initial mount to skip filters effect on first render
	// Using state instead of ref so it resets on each mount (fixes Strict Mode issue)
	const [isInitialMount, setIsInitialMount] = useState(true);

	// Check cache when filters change (but NOT on first mount)
	useEffect(() => {
		// Skip on first mount (handled by mount useEffect above)
		if (isInitialMount) {
			setIsInitialMount(false);
			return;
		}

		const queryKey = generateQueryKey(searchFilters, selectedCategory);
		const cached = getCachedEvents(queryKey);

		if (cached) {
			// Use cached data and reset to page 1
			setEvents(cached.events);
			setMapEvents(cached.mapEvents || cached.events);
			setTotal(cached.total);
			setLoading(false);
			setCurrentPage(1); // Reset page when filters change
		} else {
			// Fetch new data - set loading FIRST to prevent "nessun risultato" flash
			setLoading(true);
			setEvents([]);
			setMapEvents([]);
			fetchEvents(1); // This will set currentPage to 1
		}
	}, [searchFilters, selectedCategory]);

	const fetchEvents = async (page: number) => {
		if (process.env.APP_DEBUG === "true") {
			console.log(`[Fetch] Page ${page}`);
		}
		setLoading(true);
		// Update currentPage immediately
		setCurrentPage(page);
		try {
			const params = new URLSearchParams();

			// Add page parameter to API call
			params.append("page", page.toString());

			// Non passare location se è "Nelle vicinanze" (usa solo raggio)
			const isNearbySearch =
				searchFilters.location?.startsWith("Nelle vicinanze");
			if (searchFilters.location && !isNearbySearch) {
				params.append("location", searchFilters.location);
			}

			if (selectedCategory && selectedCategory !== "all")
				params.append("category", selectedCategory);

			// Gestisci le date per range di un solo giorno
			// Usa formato locale YYYY-MM-DD senza conversione timezone
			const formatLocalDate = (date: Date) => {
				const year = date.getFullYear();
				const month = String(date.getMonth() + 1).padStart(2, "0");
				const day = String(date.getDate()).padStart(2, "0");
				return `${year}-${month}-${day}`;
			};

			if (searchFilters.dateFrom) {
				params.append("dateFrom", formatLocalDate(searchFilters.dateFrom));
			}

			if (searchFilters.dateTo) {
				params.append("dateTo", formatLocalDate(searchFilters.dateTo));
			} else if (searchFilters.dateFrom) {
				// Se non c'è dateTo, usa dateFrom come fine (stesso giorno)
				params.append("dateTo", formatLocalDate(searchFilters.dateFrom));
			}

			// Connessione geolocation + raggio
			if (userLocation) {
				params.append("lat", userLocation.lat.toString());
				params.append("lng", userLocation.lng.toString());

				// Passa radius solo se specificato
				if (searchFilters.radius) {
					params.append("radius", searchFilters.radius.toString());
				}
			}

			const offset = (page - 1) * LIMIT;
			params.append("limit", LIMIT.toString());
			params.append("offset", offset.toString());

			const response = await fetch(`/api/events?${params}`);
			if (process.env.APP_DEBUG === "true") {
				console.log(`[API] Status: ${response.status}`);
			}

			if (!response.ok) {
				if (process.env.APP_DEBUG === "true") {
					console.log(`[API] Error: ${response.status}`);
					console.error("API Error:", response.status, response.statusText);
					const errorData = await response.text();
					console.error("Error details:", errorData);
				}
				setLoading(false);
				return;
			}

			const data = await response.json();
			if (process.env.APP_DEBUG === "true") {
				console.log(`[API] Events: ${data.events?.length || 0}, Total: ${data.total || 0}`);
			}

			// Handle API errors or missing data
			if (data.error || !data.events) {
				if (process.env.APP_DEBUG === "true") {
					console.log(`[API] No events or error`);
					console.error("API returned error or no events:", data);
				}
				setLoading(false);
				return;
			}

			const newEvents = data.events || [];
			const newMapEvents = data.mapEvents || newEvents; // fallback to events if mapEvents not available
			const newTotal = data.total || 0;

			if (process.env.APP_DEBUG === "true") {
				console.log(`[Success] ${newEvents.length} events loaded`);
			}
			setEvents(newEvents);
			setMapEvents(newMapEvents); // Set ALL events for map
			setTotal(newTotal);

			// Store in cache for first page load
			if (page === 1) {
				const queryKey = generateQueryKey(searchFilters, selectedCategory);
				setCachedEvents(queryKey, {
					events: newEvents,
					mapEvents: newMapEvents,
					total: newTotal,
					query: queryKey
				});
			}
		} catch (error) {
			if (process.env.APP_DEBUG === "true") {
				console.log(`[Error] ${error instanceof Error ? error.message : 'Unknown error'}`);
				console.error("[fetchEvents] Error fetching events:", error);
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

	// Handle scroll to show/hide blur effects
	const handleScroll = () => {
		if (!scrollContainerRef.current) return;

		const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
		const isAtTop = scrollTop < 10;
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 10;

		setShowTopBlur(!isAtTop);
		setShowBottomBlur(!isAtBottom);
	};

	// Check scroll position on mount and when events change
	useEffect(() => {
		handleScroll();
	}, [events]);

	return (
		<div className="min-h-screen bg-[#83c5be]/5">
			{/* Navbar */}
			<Navbar onSearch={handleSearch} onOpenMap={() => setIsMapExpanded(true)} />

			{/* Main Content - Split View */}
			<main
				className="fixed left-0 right-0 bottom-0 overflow-hidden"
				style={{ top: navHeight }}
			>
				<div className="container mx-auto px-4 py-4 h-full flex gap-6">
					{/* Events List - Left Side - Flex Container */}
					<div className="flex-1 min-w-0 flex flex-col min-h-0">
						{/* Cards Area - Mobile Scroll with gradient, Desktop no scroll */}
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
												<Loader2 className="w-12 h-12 text-[#006d77] animate-spin mx-auto mb-4" />
												<p className="text-gray-600">Caricamento eventi...</p>
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
											<div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
												<Filter className="w-10 h-10 text-gray-400" />
											</div>
											<h3 className="text-xl font-bold text-gray-900 mb-2">
												Nessun evento trovato
											</h3>
											<p className="text-gray-600">
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

						{/* Pagination Controls - Fixed at Bottom */}
						{!loading && events.length > 0 && (
							<div className="flex-shrink-0 py-2 sm:py-4">
								<div className="flex justify-between items-center gap-2 sm:gap-4">
									<p className="text-gray-600 text-xs sm:text-sm font-medium">
										{total}
										<span className="hidden lg:inline"> Eventi totali</span>
									</p>
									<div className="bg-white border border-[#83c5be]/30 rounded-full flex items-center gap-1 sm:gap-2 px-2 py-2">
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
															<span key={`ellipsis-${idx}`} className={size === 'sm' ? "px-1 text-gray-400 text-xs" : "px-1 text-gray-400 text-sm"}>
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
															className={pageNum === currentPage ? `${base} bg-[#006d77] text-white` : `${base} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50`}
														>
															{pageNum}
														</button>
													);
												});

											const prevBtn = (size: 'sm' | 'md') => (
												<button
													onClick={() => fetchEvents(currentPage - 1)}
													disabled={currentPage === 1}
													className={`${size === 'sm' ? 'w-7 h-7' : 'w-9 h-9'} flex items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white`}
												>
													<ChevronLeft className={size === 'sm' ? "w-4 h-4" : "w-5 h-5"} />
												</button>
											);

											const nextBtn = (size: 'sm' | 'md') => (
												<button
													onClick={() => fetchEvents(currentPage + 1)}
													disabled={currentPage === totalPages}
													className={`${size === 'sm' ? 'w-7 h-7' : 'w-9 h-9'} flex items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white`}
												>
													<ChevronRight className={size === 'sm' ? "w-4 h-4" : "w-5 h-5"} />
												</button>
											);

											return (
												<>
													{/* Mobile: 2 per lato */}
													<div className="flex sm:hidden items-center gap-1">
														{prevBtn('sm')}
														{renderPages(buildPages(2), 'sm')}
														{nextBtn('sm')}
													</div>
													{/* Desktop: 3 per lato */}
													<div className="hidden sm:flex items-center gap-2">
														{prevBtn('md')}
														{renderPages(buildPages(3), 'md')}
														{nextBtn('md')}
													</div>
												</>
											);
										})()}
									</div>
									<p className="text-gray-600 text-xs sm:text-sm font-medium">
										{events.length + ' / ' + LIMIT}
									</p>
								</div>
							</div>
						)}
					</div>

					{/* Map - Right Side (Fixed) */}  
					<div className="hidden xl:block w-[50%] max-w-4xl flex-shrink-0">
						<div className="h-full rounded-2xl overflow-hidden shadow-2xl border-2 border-[#83c5be]/30 relative group">
							<EventsMap
								events={mapEvents}
								initialGeoJSON={clusterGeoJSON}
								mapId="map-sidebar"
								userLocation={userLocation}
							/>

							{/* Expand Map Button */}
							<motion.button
								onClick={() => setIsMapExpanded(true)}
								className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 bg-white text-gray-900 rounded-full font-semibold flex items-center gap-2 shadow-lg hover:shadow-xl transition-all opacity-0 group-hover:opacity-100 z-[1000]"
								whileHover={{ scale: 1.05 }}
								whileTap={{ scale: 0.95 }}
							>
								<Map className="w-4 h-4" />
								Espandi mappa
							</motion.button>
						</div>
					</div>
				</div>
			</main>

			{/* Fullscreen Map Modal */}
			<AnimatePresence>
				{isMapExpanded && (
					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.15 }}
						className="fixed inset-0 z-[100]"
					>
						{/* Desktop: con cornice e overlay scuro */}
						<div
							className="hidden xl:block absolute inset-0 bg-black/50"
							onClick={() => setIsMapExpanded(false)}
						>
							<div
								className="absolute inset-4 bg-white rounded-2xl overflow-hidden shadow-2xl"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="absolute top-0 left-0 right-0 z-10 bg-white/95 backdrop-blur-lg border-b border-gray-200 px-6 py-4 flex items-center justify-between">
									<h3 className="text-lg font-bold text-gray-900">
										Mappa eventi — {mapEvents.length} eventi
									</h3>
									<button
										onClick={() => setIsMapExpanded(false)}
										className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
									>
										<X className="w-6 h-6 text-gray-600" />
									</button>
								</div>
								<div className="absolute inset-0 pt-16">
									<EventsMap
										events={mapEvents}
										initialGeoJSON={clusterGeoJSON}
										mapId="map-fullscreen-desktop"
										userLocation={userLocation}
									/>
								</div>
							</div>
						</div>

						{/* Mobile: tutto schermo */}
						<div className="xl:hidden absolute inset-0">
							<EventsMap
								events={mapEvents}
								initialGeoJSON={clusterGeoJSON}
								mapId="map-fullscreen-mobile"
								userLocation={userLocation}
							/>
							{/* Header sovrapposto */}
							<div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-5 pb-4 pointer-events-none" style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}>
								<div className="bg-white/90 backdrop-blur-md rounded-2xl px-4 py-2 shadow pointer-events-auto">
									<span className="text-sm font-semibold text-gray-900">
										{mapEvents.length} {mapEvents.length === 1 ? "evento" : "eventi"}
									</span>
								</div>
								{/* X a sinistra dei controlli zoom (che sono top-right di mapbox) */}
								<button
									onClick={() => setIsMapExpanded(false)}
									className="w-11 h-11 rounded-full bg-white/90 backdrop-blur-md shadow flex items-center justify-center pointer-events-auto mr-14"
								>
									<X className="w-5 h-5 text-gray-700" />
								</button>
							</div>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
