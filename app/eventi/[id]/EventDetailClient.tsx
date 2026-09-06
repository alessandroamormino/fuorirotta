"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import NextLink from "next/link";
import dynamic from "next/dynamic";
import { Event, SearchFilters } from "@/lib/types";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import Navbar from "@/components/Navbar";
import StatusBadge from "@/components/StatusBadge";
import CategoryPlaceholder from "@/components/CategoryPlaceholder";
import { eventStatus } from "@/lib/eventStatus";
import { Calendar, MapPin, ExternalLink, ArrowLeft, Phone } from "lucide-react";
import { cn, decodeHtmlEntities, htmlToPlainText } from "@/lib/utils";

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

/**
 * Barra superiore mobile (D-14): freccia indietro sempre visibile, titolo
 * che compare solo dopo che l'H1 e' uscito dallo schermo (mai lo stesso
 * testo due volte a schermo). Guardia desktop: montata solo sotto `sm`,
 * la Navbar di ricerca resta il guscio superiore a `sm` e oltre.
 */
function MobileDetailBar({ title, scrolled, onBack }: { title: string; scrolled: boolean; onBack: () => void }) {
	return (
		<header
			className={cn(
				"fixed inset-x-0 top-0 z-40 flex items-center gap-2 border-b px-4 py-2 transition-colors sm:hidden",
				scrolled ? "border-border-soft" : "border-transparent"
			)}
			style={{
				background: "color-mix(in srgb, var(--background) 82%, transparent)",
				backdropFilter: "saturate(180%) blur(20px)",
				WebkitBackdropFilter: "saturate(180%) blur(20px)",
				paddingTop: "max(env(safe-area-inset-top), 8px)",
			}}
		>
			<button
				type="button"
				onClick={onBack}
				aria-label="Torna ai risultati"
				className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-foreground"
			>
				<ArrowLeft className="h-5 w-5" />
			</button>
			<span
				className={cn(
					"min-w-0 flex-1 truncate font-display text-base font-semibold text-foreground transition-opacity",
					scrolled ? "opacity-100" : "opacity-0"
				)}
			>
				{title}
			</span>
		</header>
	);
}

export default function EventDetailClient({ initialEvent }: EventDetailClientProps) {
	const params = useParams();
	const router = useRouter();
	const [event, setEvent] = useState<Event | null>(initialEvent ?? null);
	const [loading, setLoading] = useState(!initialEvent);
	const [showMapModal, setShowMapModal] = useState<{ lat: number; lng: number } | null>(null);
	const [heroLoaded, setHeroLoaded] = useState(false);
	const [barScrolled, setBarScrolled] = useState(false);
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

	const scrollRef = useRef<HTMLElement>(null);
	const h1Ref = useRef<HTMLHeadingElement>(null);

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
				// Nessun rimando automatico: lo stato "Evento non trovato" e'
				// un ramo raggiungibile, non una tappa di passaggio verso "/".
				console.error("Event not found");
			}
		} catch (error) {
			console.error("Error fetching event:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		setHeroLoaded(false);
	}, [event?.id]);

	// Titolo in barra solo dopo che l'H1 e' uscito dalla vista (mai lo
	// stesso testo due volte a schermo) — IntersectionObserver, non un
	// listener di scroll che girerebbe a ogni pixel.
	useEffect(() => {
		if (!event || !h1Ref.current) return;
		const h1 = h1Ref.current;
		const observer = new IntersectionObserver(
			([entry]) => setBarScrolled(!entry.isIntersecting),
			{ root: scrollRef.current, threshold: 0 }
		);
		observer.observe(h1);
		return () => observer.disconnect();
	}, [event]);

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

	const desktopNavbar = (
		<div className="hidden sm:block">
			<Navbar
				filters={draftFilters}
				onFiltersChange={setDraftFilters}
				onSearch={handleSearch}
				onPanelOpenChange={handlePanelOpenChange}
			/>
		</div>
	);

	if (loading) {
		return (
			<div className="min-h-screen bg-muted">
				{desktopNavbar}
				<MobileDetailBar title="" scrolled={false} onBack={() => router.back()} />
				<div className="fixed inset-x-0 bottom-0 top-16 flex items-center justify-center sm:top-28">
					<div className="text-center">
						<div className="w-16 h-16 border-4 border-border border-t-primary rounded-full animate-spin mx-auto mb-4"></div>
						<p className="text-muted-foreground">Caricamento evento...</p>
					</div>
				</div>
			</div>
		);
	}

	if (!event) {
		return (
			<div className="min-h-screen bg-muted">
				{desktopNavbar}
				<MobileDetailBar title="" scrolled={false} onBack={() => router.back()} />
				<div className="fixed inset-x-0 bottom-0 top-16 overflow-y-auto sm:top-28">
					<div className="mx-auto max-w-7xl px-8 py-12 text-center">
						<h1
							className="mb-2 font-display text-lg font-semibold text-foreground"
							style={{ letterSpacing: "var(--tracking-display)" }}
						>
							Evento non trovato
						</h1>
						<p className="mb-5 text-sm text-muted-foreground">
							Il link potrebbe essere scaduto o l&apos;evento è stato rimosso dalla fonte.
						</p>
						<NextLink
							href="/"
							className="inline-flex items-center justify-center rounded-pill bg-primary px-6 py-3 font-semibold text-primary-foreground"
						>
							Torna agli eventi
						</NextLink>
					</div>
				</div>
			</div>
		);
	}

	const status = eventStatus(event.dateStart, event.dateEnd);

	return (
		<div className="min-h-screen bg-muted">
			{desktopNavbar}
			<MobileDetailBar
				title={decodeHtmlEntities(event.title)}
				scrolled={barScrolled}
				onBack={() => router.back()}
			/>

			{/* Main Content */}
			{/* D-11: fuori portata da Tab e dal puntatore finche' il pannello
			    desktop resta aperto (T-17-09). */}
			<main
				ref={scrollRef}
				className="fixed inset-x-0 bottom-0 top-16 overflow-y-auto scrollbar-thin sm:top-28"
				inert={navPanelOpen}
			>
				{/* Hero: inquadratura piena (criterio 12) — nessun ritaglio, solo
				    l'asse verticale e' vincolato. Il matting su --surface per le
				    foto verticali e' intenzionale. */}
				{event.imageUrl ? (
					<div
						className={cn(
							"grid w-full place-items-center border-b border-border-soft bg-surface",
							!heroLoaded && "aspect-[3/2]"
						)}
					>
						<img
							src={event.imageUrl}
							alt={decodeHtmlEntities(event.title)}
							loading="eager"
							decoding="async"
							onLoad={() => setHeroLoaded(true)}
							className="block w-full h-auto object-contain"
							style={{ maxHeight: "46dvh" }}
						/>
					</div>
				) : (
					<div className="border-b border-border-soft">
						<CategoryPlaceholder category={event.category ?? "Altro"} className="rounded-none" />
					</div>
				)}

				<div className="container mx-auto px-4 pb-8 md:pb-16 max-w-7xl pt-5">
					<div className="mb-3 flex flex-wrap items-center gap-2">
						<StatusBadge label={status.label} tone={status.tone} variant="pill" />
						{event.category && (
							<span
								className="rounded-pill bg-surface px-[10px] py-[5px] text-xs text-foreground-secondary"
								style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
							>
								{event.category}
							</span>
						)}
					</div>

					{/* Content Grid */}
					<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
						{/* Left Column - Main Info */}
						<div className="lg:col-span-2 space-y-6">
							{/* Title */}
							<h1
								ref={h1Ref}
								id="detail-title"
								className="text-balance font-display text-xl font-semibold leading-tight text-foreground"
								style={{ letterSpacing: "var(--tracking-display)" }}
							>
								{decodeHtmlEntities(event.title)}
							</h1>

							{/* Info Cards */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
							</div>

							{/* Description */}
							{event.description && (
								<div className="bg-surface rounded-2xl p-6 md:p-8 shadow-lg border-2 border-accent/20">
									<h2 className="text-2xl font-bold text-foreground mb-4">
										Descrizione
									</h2>
									{/* Reso come testo, non come markup arbitrario: le descrizioni
									    sono testo puro (solosagre e inlombardia strippano i tag
									    alla fonte, opendata restituisce il campo grezzo dell'API).
									    Il sink HTML rimosso in acd78f0 non rientra qui: era una via
									    d'ingresso XSS da contenuto scrapato — T-07-09. */}
									<div className="text-foreground-secondary leading-relaxed prose prose-sm max-w-none whitespace-pre-line">
										{htmlToPlainText(event.description)}
									</div>
									<p className="text-xs text-muted-foreground-subtle">Fonte: {event.source}</p>
								</div>
							)}
						</div>

						{/* Right Column - Map & Actions */}
						<div className="lg:col-span-1">
							<div className="space-y-6 sticky top-4">
								{/* Map */}
								{event.latitude && event.longitude && (
									<div className="bg-surface rounded-2xl p-4 shadow-lg border-2 border-accent/20">
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
									</div>
								)}

								{/* External Link */}
								{event.sourceUrl && (
									<a
										href={event.sourceUrl ?? undefined}
										target="_blank"
										rel="noopener noreferrer"
										className="flex items-center justify-center gap-2 w-full px-6 py-4 bg-accent-tint text-primary font-semibold rounded-2xl shadow-lg hover:shadow-xl transition-all"
									>
										Visita sito ufficiale
										<ExternalLink className="w-5 h-5" />
									</a>
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
