"use client";

import { useState, useEffect } from "react";
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
					console.log("Geolocation not enabled:", error);
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

		if (cached) {
			// Restore cached events
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

			if (!response.ok) {
				console.error("API Error:", response.status, response.statusText);
				const errorData = await response.text();
				console.error("Error details:", errorData);
				return;
			}

			const data = await response.json();

			// Handle API errors or missing data
			if (data.error || !data.events) {
				console.error("API returned error or no events:", data);
				return;
			}

			const newEvents = data.events || [];
			const newMapEvents = data.mapEvents || newEvents; // fallback to events if mapEvents not available
			const newTotal = data.total || 0;

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
			console.error("Error fetching events:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleSearch = (filters: SearchFilters) => {
		setSearchFilters(filters);
	};

	return (
		<div className="min-h-screen bg-gradient-to-br from-[#edf6f9] via-white to-[#83c5be]/10">
			{/* Navbar */}
			<Navbar onSearch={handleSearch} />

			{/* Main Content - Split View */}
			<main className="fixed top-28 left-0 right-0 bottom-0 overflow-hidden">
				<div className="container mx-auto px-4 py-4 h-full flex gap-6">
					{/* Events List - Left Side - Flex Container */}
					<div className="flex-1 min-w-0 flex flex-col">
						{/* Cards Area - No Scroll, Fixed Height */}
						<div className="flex-1 overflow-hidden pb-4">
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
										className="grid grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-x-2 gap-y-2 sm:gap-x-3 sm:gap-y-2 md:gap-x-4 md:gap-y-3 lg:gap-x-4 lg:gap-y-3"
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

						{/* Pagination Controls - Fixed at Bottom */}
						{!loading && events.length > 0 && (
							<div className="flex-shrink-0 py-2 sm:py-4">
								<div className="flex flex-col items-center gap-2 sm:gap-4">
									<p className="text-gray-600 text-xs sm:text-sm font-medium">
										{total} {total === 1 ? 'evento' : 'eventi'}
									</p>
									{(() => {
										const totalPages = Math.ceil(total / LIMIT);
										if (totalPages <= 1) return null;

										const pages: (number | string)[] = [];
										const maxVisible = 5;

										if (totalPages <= maxVisible + 2) {
											// Show all pages if total is small
											for (let i = 1; i <= totalPages; i++) {
												pages.push(i);
											}
										} else {
											// Show with ellipsis
											pages.push(1);

											if (currentPage > 3) {
												pages.push('...');
											}

											let start = Math.max(2, currentPage - 1);
											let end = Math.min(totalPages - 1, currentPage + 1);

											if (currentPage <= 3) {
												end = Math.min(4, totalPages - 1);
											}
											if (currentPage >= totalPages - 2) {
												start = Math.max(2, totalPages - 3);
											}

											for (let i = start; i <= end; i++) {
												pages.push(i);
											}

											if (currentPage < totalPages - 2) {
												pages.push('...');
											}

											pages.push(totalPages);
										}

										return (
											<div className="flex items-center gap-1 sm:gap-2">
												<button
													onClick={() => fetchEvents(currentPage - 1)}
													disabled={currentPage === 1}
													className="p-1.5 sm:p-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
												>
													<ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
												</button>

												{pages.map((page, idx) => {
													if (page === '...') {
														return (
															<span key={`ellipsis-${idx}`} className="px-1 sm:px-2 text-gray-400 text-xs sm:text-sm">
																...
															</span>
														);
													}

													const pageNum = page as number;
													return (
														<button
															key={pageNum}
															onClick={() => fetchEvents(pageNum)}
															className={
																pageNum === currentPage
																	? "px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg bg-[#006d77] text-white font-medium text-xs sm:text-sm"
																	: "px-2 py-1.5 sm:px-3 sm:py-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-medium text-xs sm:text-sm"
															}
														>
															{pageNum}
														</button>
													);
												})}

												<button
													onClick={() => fetchEvents(currentPage + 1)}
													disabled={currentPage === totalPages}
													className="p-1.5 sm:p-2 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
												>
													<ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
												</button>
											</div>
										);
									})()}
								</div>
							</div>
						)}

						{/* Floating Map Button (Mobile/Tablet) - Bottom Right */}
						{events.length > 0 && (
							<button
								onClick={() => setIsMapExpanded(true)}
								className="xl:hidden fixed bottom-4 right-4 w-14 h-14 bg-[#006d77] text-white rounded-full shadow-lg active:shadow-md transition-shadow flex items-center justify-center z-50"
							>
								<Map className="w-6 h-6" />
							</button>
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
						className="fixed inset-0 z-[100] bg-black/50"
						onClick={() => setIsMapExpanded(false)}
					>
						<div
							className="absolute inset-4 bg-white rounded-2xl overflow-hidden shadow-2xl"
							onClick={(e) => e.stopPropagation()}
						>
							{/* Header */}
							<div className="absolute top-0 left-0 right-0 z-10 bg-white/95 backdrop-blur-lg border-b border-gray-200 px-6 py-4 flex items-center justify-between">
								<h3 className="text-lg font-bold text-gray-900">
									Mappa eventi - {mapEvents.length} eventi
								</h3>
								<button
									onClick={() => setIsMapExpanded(false)}
									className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors"
								>
									<X className="w-6 h-6 text-gray-600" />
								</button>
							</div>

							{/* Map Content */}
							<div className="absolute inset-0 pt-16">
								<EventsMap
									events={mapEvents}
									initialGeoJSON={clusterGeoJSON}
									mapId="map-fullscreen"
									userLocation={userLocation}
								/>
							</div>
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
