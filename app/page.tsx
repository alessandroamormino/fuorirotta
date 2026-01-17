"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Event } from "@/lib/types";
import EventCard from "@/components/EventCard";
import Navbar from "@/components/Navbar";
import { useInfiniteScroll } from "@/lib/hooks/useInfiniteScroll";
import { Filter, Loader2, Map, X } from "lucide-react";

const EventsMap = dynamic(() => import("@/components/EventsMap"), {
	ssr: false,
	loading: () => (
		<div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
			<Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
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
	const [events, setEvents] = useState<Event[]>([]);
	// const [categories, setCategories] = useState<Category[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedCategory] = useState<string>("all");
	const [searchFilters, setSearchFilters] = useState<SearchFilters>({
		location: "",
		dateFrom: null,
		dateTo: null,
		radius: undefined,
	});
	const [userLocation, setUserLocation] = useState<{
		lat: number;
		lng: number;
	} | null>(null);
	const [isMapExpanded, setIsMapExpanded] = useState(false);

	// Infinite scroll state
	const [offset, setOffset] = useState(0);
	const [hasMore, setHasMore] = useState(true);
	const [total, setTotal] = useState(0);
	const LIMIT = 100; // Aumentato da 50 a 100 per ridurre le chiamate API

	const observerTarget = useInfiniteScroll(
		() => {
			if (!loading && hasMore) fetchMoreEvents();
		},
		hasMore,
		loading
	);

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

	// Reset and load events when filters change
	useEffect(() => {
		setOffset(0);
		setEvents([]);
		setHasMore(true);
		fetchEvents(0, true);
	}, [searchFilters, selectedCategory]);

	// Load categories
	// useEffect(() => {
	// 	fetchCategories();
	// }, []);

	const fetchEvents = async (
		currentOffset: number,
		isReset: boolean = false
	) => {
		setLoading(true);
		try {
			const params = new URLSearchParams();

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

			params.append("limit", LIMIT.toString());
			params.append("offset", currentOffset.toString());

			const response = await fetch(`/api/events?${params}`);

			if (!response.ok) {
				console.error("API Error:", response.status, response.statusText);
				const errorData = await response.text();
				console.error("Error details:", errorData);
				setHasMore(false);
				return;
			}

			const data = await response.json();

			// Handle API errors or missing data
			if (data.error || !data.events) {
				console.error("API returned error or no events:", data);
				setHasMore(false);
				return;
			}

			if (isReset) {
				setEvents(data.events || []);
			} else {
				// Deduplicate events by ID before appending
				setEvents((prev) => {
					const existingIds = new Set(prev.map((e) => e.id));
					const newEvents = (data.events || []).filter(
						(e: Event) => !existingIds.has(e.id)
					);
					return [...prev, ...newEvents];
				});
			}

			setTotal(data.total || 0);
			setHasMore((data.events?.length || 0) === LIMIT);
			setOffset(currentOffset + LIMIT);
		} catch (error) {
			console.error("Error fetching events:", error);
			setHasMore(false);
		} finally {
			setLoading(false);
		}
	};

	const fetchMoreEvents = () => {
		fetchEvents(offset, false);
	};

	// const fetchCategories = async () => {
	// 	try {
	// 		const response = await fetch("/api/categories");
	// 		const data = await response.json();
	// 		setCategories(data);
	// 	} catch (error) {
	// 		console.error("Error fetching categories:", error);
	// 	}
	// };

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
						{/* Scrollable Cards Area */}
						<div className="flex-1 overflow-y-auto pb-4 pr-2 sm:pr-0 scrollbar-thin scrollbar-thumb-[#83c5be] scrollbar-track-gray-100">
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
									<motion.div
										key="events"
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										exit={{ opacity: 0 }}
										className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-x-3 sm:gap-x-5 gap-y-8"
									>
										{events.map((event, index) => (
											<motion.div
												key={`${event.source}-${event.id}`}
												initial={{ opacity: 0, y: 20 }}
												animate={{ opacity: 1, y: 0 }}
												transition={{ delay: index * 0.05, duration: 0.3 }}
											>
												<EventCard event={event} />
											</motion.div>
										))}
									</motion.div>
								)}
							</AnimatePresence>

							{/* Infinite Scroll Trigger */}
							{!loading && events.length > 0 && (
								<div ref={observerTarget} className="flex justify-center py-12">
									{loading && (
										<div className="flex items-center gap-2 text-[#006d77]">
											<Loader2 className="w-6 h-6 animate-spin" />
											<span className="text-sm font-medium">
												Caricamento altri eventi...
											</span>
										</div>
									)}
									{!hasMore && (
										<div className="text-center">
											<p className="text-gray-600 text-sm font-medium">
												Tutti i {total} eventi sono stati caricati
											</p>
											<p className="text-gray-400 text-xs mt-1">
												Non ci sono altri eventi da visualizzare
											</p>
										</div>
									)}
								</div>
							)}
						</div>

						{/* Show Map Button (Mobile/Tablet) - Always Visible at Bottom */}
						{events.length > 0 && (
							<div className="xl:hidden pt-4 flex-shrink-0">
								<motion.button
									onClick={() => setIsMapExpanded(true)}
									className="w-full px-6 py-3 bg-[#006d77] text-white rounded-full font-semibold flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transition-shadow"
									whileHover={{ scale: 1.02 }}
									whileTap={{ scale: 0.98 }}
								>
									<Map className="w-5 h-5" />
									Mostra mappa
								</motion.button>
							</div>
						)}
					</div>

					{/* Map - Right Side (Fixed) */}
					<div className="hidden xl:block w-[45%] max-w-2xl flex-shrink-0">
						<div className="h-full rounded-2xl overflow-hidden shadow-2xl border-2 border-[#83c5be]/30 relative group">
							<EventsMap
								events={events}
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
						className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
						onClick={() => setIsMapExpanded(false)}
					>
						<motion.div
							initial={{ scale: 0.9, opacity: 0 }}
							animate={{ scale: 1, opacity: 1 }}
							exit={{ scale: 0.9, opacity: 0 }}
							transition={{ type: "spring", damping: 25, stiffness: 300 }}
							className="absolute inset-4 bg-white rounded-2xl overflow-hidden shadow-2xl"
							onClick={(e) => e.stopPropagation()}
						>
							{/* Header */}
							<div className="absolute top-0 left-0 right-0 z-10 bg-white/95 backdrop-blur-lg border-b border-gray-200 px-6 py-4 flex items-center justify-between">
								<h3 className="text-lg font-bold text-gray-900">
									Mappa eventi - {events.length} eventi
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
									events={events}
									mapId="map-fullscreen"
									userLocation={userLocation}
								/>
							</div>
						</motion.div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
