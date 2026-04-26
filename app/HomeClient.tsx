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
			category: category || 'all'
		});
	};

	const [events, setEvents] = useState<Event[]>(initialEvents);
	const [mapEvents, setMapEvents] = useState<Event[]>(initialEvents);
	const [loading, setLoading] = useState(false);
	const [selectedCategory] = useState<string>("all");
	const [clusterGeoJSON, setClusterGeoJSON] = useState<any>(null);

	const [searchFilters, setSearchFilters] = useState<SearchFilters>({ location: "", dateFrom: null, dateTo: null, radius: undefined });
	const [userLocation, setUserLocation] = useState<{
		lat: number;
		lng: number;
	} | null>(null);
	const hasActiveFilters = !!(
		searchFilters.location || searchFilters.dateFrom || searchFilters.dateTo || searchFilters.radius
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
				activeFilters = {
					location: parsed.location || "",
					dateFrom: parsed.dateFrom ? new Date(parsed.dateFrom) : null,
					dateTo: parsed.dateTo ? new Date(parsed.dateTo) : null,
					radius: parsed.radius,
				};
				setSearchFilters(activeFilters);
			} catch { /* ignore */ }
		}

		const queryKey = generateQueryKey(activeFilters, selectedCategory);
		const cached = getCachedEvents(queryKey);

		if (cached) {
			setEvents(cached.events);
			setMapEvents(cached.mapEvents || cached.events);
			setTotal(cached.total);
			if (page > 1) fetchEvents(page);
			return;
		}

		const hasFilters =
			activeFilters.location || activeFilters.dateFrom || activeFilters.dateTo || activeFilters.radius;

		if (!hasFilters && initialEvents.length > 0) {
			// Use SSR data and seed the cache
			setCachedEvents(queryKey, {
				events: initialEvents,
				mapEvents: initialEvents,
				total: initialTotal,
				query: queryKey,
			});
			if (page > 1) fetchEvents(page);
		} else {
			fetchEvents(page);
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

	const fetchEvents = async (page: number) => {
		if (process.env.APP_DEBUG === "true") {
			console.log(`[Fetch] Page ${page}`);
		}
		setLoading(true);
		setCurrentPage(page);
		try {
			const params = new URLSearchParams();
			params.append("page", page.toString());

			const isNearbySearch = searchFilters.location?.startsWith("Nelle vicinanze");
			if (searchFilters.location && !isNearbySearch) {
				params.append("location", searchFilters.location);
			}

			if (selectedCategory && selectedCategory !== "all")
				params.append("category", selectedCategory);

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
				params.append("dateTo", formatLocalDate(searchFilters.dateFrom));
			}

			if (userLocation) {
				params.append("lat", userLocation.lat.toString());
				params.append("lng", userLocation.lng.toString());
				if (searchFilters.radius) {
					params.append("radius", searchFilters.radius.toString());
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
				const queryKey = generateQueryKey(searchFilters, selectedCategory);
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
		<div className="min-h-screen bg-[#83c5be]/5">
			<Navbar onSearch={handleSearch} onOpenMap={() => setIsMapExpanded(true)} />

			<main
				className="fixed left-0 right-0 bottom-0 overflow-hidden"
				style={{ top: navHeight }}
			>
				<div className="container mx-auto px-4 py-4 h-full flex gap-6">
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
									<p className="text-gray-600 text-xs sm:text-sm font-medium">
										{events.length + ' / ' + LIMIT}
									</p>
								</div>
							</div>
						)}
					</div>

					<div className="hidden xl:block w-[50%] max-w-4xl flex-shrink-0">
						<div className="h-full rounded-2xl overflow-hidden shadow-2xl border-2 border-[#83c5be]/30 relative group">
							<EventsMap
								events={mapEvents}
								initialGeoJSON={effectiveClusterGeoJSON}
								mapId="map-sidebar"
								userLocation={userLocation}
							/>
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
								className="absolute inset-4 bg-white rounded-2xl overflow-hidden shadow-2xl"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="absolute top-0 left-0 right-0 z-10 bg-white/95 backdrop-blur-lg border-b border-gray-200 px-6 py-4 flex items-center justify-between">
									<h3 className="text-lg font-bold text-gray-900">
										Mappa eventi — {effectiveClusterGeoJSON ? effectiveClusterGeoJSON.features.length : mapEvents.length} eventi
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
								<div className="bg-white/90 backdrop-blur-md rounded-2xl px-4 py-2 shadow pointer-events-auto">
									<span className="text-sm font-semibold text-gray-900">
										{mapEvents.length} {mapEvents.length === 1 ? "evento" : "eventi"}
									</span>
								</div>
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
