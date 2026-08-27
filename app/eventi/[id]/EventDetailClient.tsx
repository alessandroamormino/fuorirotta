"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { Event, SearchFilters } from "@/lib/types";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import Navbar from "@/components/Navbar";
import { Calendar, MapPin, ExternalLink, Tag, ArrowLeft, Phone } from "lucide-react";
import { decodeHtmlEntities, htmlToPlainText } from "@/lib/utils";

const EventsMap = dynamic(() => import("@/components/EventsMap"), {
	ssr: false,
	loading: () => (
		<div className="w-full h-full flex items-center justify-center bg-muted rounded-2xl">
			<div className="text-muted-foreground-subtle">Caricamento mappa...</div>
		</div>
	),
});

interface EventDetailClientProps {
	initialEvent?: Event | null;
}

export default function EventDetailClient({ initialEvent }: EventDetailClientProps) {
	const params = useParams();
	const router = useRouter();
	const [event, setEvent] = useState<Event | null>(initialEvent ?? null);
	const [loading, setLoading] = useState(!initialEvent);
	const [showMapModal, setShowMapModal] = useState<{ lat: number; lng: number } | null>(null);
	// D-07: qui la Navbar serve solo ad avviare una nuova ricerca che porta a
	// "/" — draft locale, mai letto altrove in questo file.
	const [draftFilters, setDraftFilters] = useState<SearchFilters>({
		location: "",
		dateFrom: null,
		dateTo: null,
	});
	// D-11 (Fase 17, piano 04): stessa inerzia sul <main> di HomeClient.tsx —
	// solo sul ramo di resa principale, gli altri due non hanno <main>.
	const [navPanelOpen, setNavPanelOpen] = useState(false);
	const handlePanelOpenChange = useCallback((open: boolean) => {
		setNavPanelOpen(open);
	}, []);

	useEffect(() => {
		// Se abbiamo già i dati dal server (SSR), non richiedere
		if (initialEvent || !params.id) return;
		fetchEvent(params.id as string);
	}, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

	const fetchEvent = async (id: string) => {
		setLoading(true);
		try {
			const response = await fetch(`/api/events/${id}`);
			if (response.ok) {
				const data = await response.json();
				setEvent(data);
			} else {
				console.error("Event not found");
				router.push("/");
			}
		} catch (error) {
			console.error("Error fetching event:", error);
			router.push("/");
		} finally {
			setLoading(false);
		}
	};

	const handleSearch = (filters: SearchFilters) => {
		const searchParams = new URLSearchParams();
		if (filters.location) searchParams.append("location", filters.location);
		if (filters.dateFrom)
			searchParams.append("dateFrom", filters.dateFrom.toISOString());
		if (filters.dateTo) searchParams.append("dateTo", filters.dateTo.toISOString());

		router.push(`/?${searchParams.toString()}`);
	};

	const handleNavigation = (lat: number | null, lng: number | null) => {
		if (lat == null || lng == null) return;

		const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
		const isAndroid = /Android/i.test(navigator.userAgent);

		if (isAndroid) {
			window.location.href = `https://maps.google.com/maps?daddr=${lat},${lng}`;
			return;
		}

		if (isIOS) {
			setShowMapModal({ lat, lng });
			return;
		}

		window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
	}

	if (loading) {
		return (
			<div className="min-h-screen bg-muted">
				<Navbar
					filters={draftFilters}
					onFiltersChange={setDraftFilters}
					onSearch={handleSearch}
				/>
				<div className="fixed top-28 left-0 right-0 bottom-0 flex items-center justify-center">
					<div className="text-center">
						<div className="w-16 h-16 border-4 border-accent border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
						<p className="text-muted-foreground">Caricamento evento...</p>
					</div>
				</div>
			</div>
		);
	}

	if (!event) {
		return (
			<div className="min-h-screen bg-muted">
				<Navbar
					filters={draftFilters}
					onFiltersChange={setDraftFilters}
					onSearch={handleSearch}
				/>
				<div className="fixed top-28 left-0 right-0 bottom-0 flex items-center justify-center">
					<div className="text-center">
						<div className="w-20 h-20 bg-muted-strong rounded-full flex items-center justify-center mx-auto mb-4">
							<Calendar className="w-10 h-10 text-muted-foreground-faint" />
						</div>
						<h3 className="text-xl font-bold text-foreground mb-2">
							Evento non trovato
						</h3>
						<p className="text-muted-foreground mb-6">
							L'evento che stai cercando non esiste o è stato rimosso
						</p>
						<button
							onClick={() => router.push("/")}
							className="px-6 py-3 bg-primary text-primary-foreground rounded-full font-semibold hover:shadow-lg transition-shadow"
						>
							Torna agli eventi
						</button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-muted">
			{/* Navbar */}
			<Navbar
				filters={draftFilters}
				onFiltersChange={setDraftFilters}
				onSearch={handleSearch}
				onPanelOpenChange={handlePanelOpenChange}
			/>

			{/* Main Content */}
			<main
				className="fixed top-28 left-0 right-0 bottom-0 overflow-y-auto scrollbar-thin"
				// D-11: fuori portata da Tab e dal puntatore finche' il
				// pannello desktop resta aperto (T-17-09).
				inert={navPanelOpen}
			>
				<div className="container mx-auto px-4 max-w-7xl">
					{/* Back Button */}
					<motion.button
						onClick={() => router.back()}
						initial={{ opacity: 0, x: -20 }}
						animate={{ opacity: 1, x: 0 }}
						className="w-12 h-12 bg-surface rounded-full shadow-lg flex items-center justify-center hover:bg-muted transition-colors border-2 border-accent/30 mb-4 mt-4"
						whileHover={{ scale: 1.05 }}
						whileTap={{ scale: 0.95 }}
					>
						<ArrowLeft className="w-5 h-5 text-primary" />
					</motion.button>
				</div>

				<div className="container mx-auto px-4 pb-8 md:pb-16 max-w-7xl">
					{/* Hero Image */}
					{event.imageUrl ? (
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							className="w-full h-[400px] md:h-[500px] rounded-3xl overflow-hidden mb-8 shadow-2xl border-2 border-accent/30"
						>
							<img
								src={event.imageUrl}
								alt={event.title}
								className="w-full h-full object-cover"
								loading="eager"
								decoding="async"
							/>
						</motion.div>
					) : (
						<motion.div
							initial={{ opacity: 0, y: 20 }}
							animate={{ opacity: 1, y: 0 }}
							className="w-full h-[400px] md:h-[500px] rounded-3xl overflow-hidden mb-8 shadow-2xl border-2 border-accent/30 bg-muted flex items-center justify-center"
						>
							<div className="flex flex-col items-center gap-6">
								<div className="w-32 h-32 rounded-full bg-primary/10 flex items-center justify-center">
									<Calendar className="w-16 h-16 text-primary" />
								</div>
								<span className="text-2xl font-semibold text-primary/60">
									Evento
								</span>
							</div>
						</motion.div>
					)}

					{/* Content Grid */}
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
						{/* Left Column - Main Info */}
						<div className="lg:col-span-2 space-y-6">
							{/* Category Badge */}
							{event.category && (
								<motion.div
									initial={{ opacity: 0, x: -20 }}
									animate={{ opacity: 1, x: 0 }}
									transition={{ delay: 0.1 }}
								>
									<span className="inline-flex items-center gap-2 px-4 py-2 bg-accent-tint text-primary rounded-full text-sm font-semibold border-2 border-accent/30">
										<Tag className="w-4 h-4" />
										{event.category}
									</span>
								</motion.div>
							)}

							{/* Title */}
							<motion.h1
								initial={{ opacity: 0, x: -20 }}
								animate={{ opacity: 1, x: 0 }}
								transition={{ delay: 0.2 }}
								className="text-4xl md:text-5xl font-bold text-foreground leading-tight"
							>
								{decodeHtmlEntities(event.title)}
							</motion.h1>

							{/* Info Cards */}
							<motion.div
								initial={{ opacity: 0, y: 20 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{ delay: 0.3 }}
								className="grid grid-cols-1 md:grid-cols-2 gap-4"
							>
								{/* Date Card */}
								<div className="bg-surface rounded-2xl p-6 shadow-lg border-2 border-accent/20 hover:border-primary/50 transition-all">
									<div className="flex items-start gap-4">
										<div className="w-12 h-12 rounded-full bg-accent-tint flex items-center justify-center flex-shrink-0">
											<Calendar className="w-6 h-6 text-primary" />
										</div>
										<div>
											<h3 className="font-semibold text-foreground mb-1">Data</h3>
											<p className="text-sm text-muted-foreground">
												{format(
													new Date(event.dateStart),
													"EEEE dd MMMM yyyy",
													{ locale: it }
												)}
											</p>
											{event.dateEnd && (
												<p className="text-xs text-muted-foreground-subtle mt-1">
													Fino al{" "}
													{format(new Date(event.dateEnd), "dd MMMM yyyy", {
														locale: it,
													})}
												</p>
											)}
										</div>
									</div>
								</div>

								{/* Location Card */}
								{event.locationName && (
									<div className="bg-surface rounded-2xl p-6 shadow-lg border-2 border-accent/20 hover:border-primary/50 transition-all">
										<div className="flex items-start gap-4">
											<div className="w-12 h-12 rounded-full bg-accent-tint flex items-center justify-center flex-shrink-0">
												<MapPin className="w-6 h-6 text-primary" />
											</div>
											<div>
												<h3 className="font-semibold text-foreground mb-1">
													{decodeHtmlEntities(event.locationName)}
												</h3>
												{event.address && (
													<p className="text-sm text-muted-foreground">
														{event.address}
													</p>
												)}
											</div>
										</div>
									</div>
								)}

								{/* Phone Card */}
								{event.phone && (
									<div className="bg-surface rounded-2xl p-6 shadow-lg border-2 border-accent/20 hover:border-primary/50 transition-all">
										<div className="flex items-start gap-4">
											<div className="w-12 h-12 rounded-full bg-accent-tint flex items-center justify-center flex-shrink-0">
												<Phone className="w-6 h-6 text-primary" />
											</div>
											<div>
												<h3 className="font-semibold text-foreground mb-1">Telefono</h3>
												<a
													href={`tel:${event.phone}`}
													className="text-sm text-primary hover:underline"
												>
													{event.phone}
												</a>
											</div>
										</div>
									</div>
								)}
							</motion.div>

							{/* Description */}
							{event.description && (
								<motion.div
									initial={{ opacity: 0, y: 20 }}
									animate={{ opacity: 1, y: 0 }}
									transition={{ delay: 0.4 }}
									className="bg-surface rounded-2xl p-6 md:p-8 shadow-lg border-2 border-accent/20"
								>
									<h2 className="text-2xl font-bold text-foreground mb-4">
										Descrizione
									</h2>
									{/* Reso come testo, non come HTML: le descrizioni sono testo puro
								    (solosagre e inlombardia strippano i tag alla fonte, opendata
								    restituisce il campo grezzo dell'API). dangerouslySetInnerHTML
								    qui era solo una via d'ingresso XSS da contenuto scrapato — T-07-09. */}
								<div className="text-foreground-secondary leading-relaxed prose prose-sm max-w-none whitespace-pre-line">
										{htmlToPlainText(event.description)}
									</div>
									<p className="text-xs text-muted-foreground-subtle">Fonte: {event.source}</p>
								</motion.div>
							)}
						</div>

						{/* Right Column - Map & Actions */}
						<div className="lg:col-span-1">
							<div className="space-y-6 sticky top-4">
								{/* Map */}
								{event.latitude && event.longitude && (
									<motion.div
										initial={{ opacity: 0, x: 20 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ delay: 0.5 }}
										className="bg-surface rounded-2xl p-4 shadow-lg border-2 border-accent/20"
									>
										<h3 className="text-lg font-bold text-foreground mb-4">
											Dove si trova
										</h3>
										<div className="h-[300px] rounded-xl overflow-hidden border-2 border-accent/30">
											<EventsMap events={[event]} disablePopups={true} />
										</div>
										<button
											className="flex items-center justify-center gap-2 w-full px-6 py-2 mt-4 bg-primary text-primary-foreground font-semibold rounded-xl shadow-lg hover:shadow-xl transition-all"
											onClick={() => handleNavigation(event.latitude, event.longitude)}
										>
											Naviga
											<ExternalLink className="w-5 h-5" />
										</button>
									</motion.div>
								)}

								{/* External Link */}
								{event.sourceUrl && (
									<motion.div
										initial={{ opacity: 0, x: 20 }}
										animate={{ opacity: 1, x: 0 }}
										transition={{ delay: 0.6 }}
									>
										<a
											href={event.sourceUrl ?? undefined}
											target="_blank"
											rel="noopener noreferrer"
											className="flex items-center justify-center gap-2 w-full px-6 py-4 bg-accent-tint text-primary font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all"
										>
											Visita sito ufficiale
											<ExternalLink className="w-5 h-5" />
										</a>
									</motion.div>
								)}
							</div>
						</div>
					</div>
				</div>
			</main>

			{showMapModal && (
				<div
					className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
					onClick={() => setShowMapModal(null)}
				>
					<div
						className="w-full max-w-sm bg-surface rounded-t-2xl p-6 pb-10 shadow-xl"
						onClick={(e) => e.stopPropagation()}
					>
						<p className="text-center text-muted-foreground-subtle text-sm mb-4">Apri con</p>
						<div className="flex flex-col gap-3">
							<a
								href={`comgooglemaps://?daddr=${showMapModal.lat},${showMapModal.lng}&directionsmode=driving`}
								className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-xl"
								onClick={() => setShowMapModal(null)}
							>
								Google Maps
							</a>
							<a
								href={`https://maps.apple.com/?daddr=${showMapModal.lat},${showMapModal.lng}`}
								className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-muted-strong text-foreground-strong font-semibold rounded-xl"
								onClick={() => setShowMapModal(null)}
							>
								Apple Maps
							</a>
							<button
								className="text-muted-foreground-faint text-sm mt-1"
								onClick={() => setShowMapModal(null)}
							>
								Annulla
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
