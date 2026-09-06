"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import NextLink from "next/link";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Event, SearchFilters } from "@/lib/types";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import Navbar from "@/components/Navbar";
import * as Dialog from "@/components/ui/Dialog";
import StatusBadge from "@/components/StatusBadge";
import CategoryPlaceholder from "@/components/CategoryPlaceholder";
import { eventStatus, formatEventRange } from "@/lib/eventStatus";
import { calculateDistanceKm } from "@/lib/territorial/distance";
import {
	Calendar,
	MapPin,
	Phone,
	Compass,
	Link as LinkIcon,
	Navigation,
	ArrowLeft,
	X,
} from "lucide-react";
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
 * Una riga della lista raggruppata (D-14): icona in cerchio, etichetta,
 * valore. Il filetto fra righe usa `last:border-b-0` invece di calcolare
 * "e' l'ultima riga visibile" a mano — le righe sono condizionali (Telefono
 * nullo, Distanza senza permesso, ecc.), quindi la posizione dell'ultimo
 * filetto e' decisa dal DOM, non da un indice.
 */
function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-start gap-3 border-b border-border-soft p-4 last:border-b-0">
			<span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-background text-foreground-secondary">
				{icon}
			</span>
			<div className="min-w-0 text-sm leading-snug">
				<span className="mb-px block text-xs text-muted-foreground">{label}</span>
				<span className="block font-medium text-foreground">{value}</span>
			</div>
		</div>
	);
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
	const [heroLoaded, setHeroLoaded] = useState(false);
	const [barScrolled, setBarScrolled] = useState(false);
	const [navSheetOpen, setNavSheetOpen] = useState(false);
	const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
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

	// Riga Distanza: stesso blocco navigator.geolocation gia' in uso in
	// app/HomeClient.tsx, stesso trattamento silenzioso del rifiuto.
	useEffect(() => {
		if (!navigator.geolocation) return;
		navigator.geolocation.getCurrentPosition(
			(position) => {
				setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude });
			},
			(error) => {
				if (process.env.APP_DEBUG === "true") {
					console.log("Geolocation not enabled:", error);
				}
			}
		);
	}, []);

	const handleSearch = (filters: SearchFilters) => {
		const searchParams = new URLSearchParams();
		if (filters.location) searchParams.append("location", filters.location);
		if (filters.dateFrom)
			searchParams.append("dateFrom", filters.dateFrom.toISOString());
		if (filters.dateTo) searchParams.append("dateTo", filters.dateTo.toISOString());

		router.push(`/?${searchParams.toString()}`);
	};

	// I tre rami restano quelli di oggi (Android diretto, iOS foglio, desktop
	// nuova scheda) — cambia solo il contenitore del foglio iOS (Task 3).
	const handleNavigation = (lat: number | null, lng: number | null) => {
		if (lat == null || lng == null) return;

		const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
		const isAndroid = /Android/i.test(navigator.userAgent);

		if (isAndroid) {
			window.location.href = `https://maps.google.com/maps?daddr=${lat},${lng}`;
			return;
		}

		if (isIOS) {
			setNavSheetOpen(true);
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
							className="inline-flex min-h-12 items-center justify-center rounded-pill bg-surface px-5 font-medium text-foreground"
							style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
						>
							Torna agli eventi
						</NextLink>
					</div>
				</div>
			</div>
		);
	}

	const status = eventStatus(event.dateStart, event.dateEnd);
	const isMultiDay =
		event.dateEnd != null &&
		new Date(event.dateEnd).toDateString() !== new Date(event.dateStart).toDateString();
	const hasCoords = event.latitude != null && event.longitude != null;
	const distanceKm =
		userLocation && event.resolvedLatitude != null && event.resolvedLongitude != null
			? calculateDistanceKm(userLocation.lat, userLocation.lng, event.resolvedLatitude, event.resolvedLongitude)
			: null;

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

				<div
					className={cn(
						"container mx-auto px-4 max-w-7xl pt-5",
						hasCoords ? "pb-24 md:pb-24" : "pb-8 md:pb-16"
					)}
				>
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

					<h1
						ref={h1Ref}
						id="detail-title"
						className="mb-4 text-balance font-display text-xl font-semibold leading-tight text-foreground"
						style={{ letterSpacing: "var(--tracking-display)" }}
					>
						{decodeHtmlEntities(event.title)}
					</h1>

					{/* Lista raggruppata (D-14): un contenitore, righe separate da
					    filetti — sostituisce le quattro card in griglia. Ogni riga
					    tranne "Quando" e' condizionale. */}
					<div className="mb-6 overflow-hidden rounded-lg bg-surface">
						<InfoRow
							icon={<Calendar className="h-[17px] w-[17px]" strokeWidth={1.8} />}
							label="Quando"
							value={
								isMultiDay
									? formatEventRange(event.dateStart, event.dateEnd)
									: format(new Date(event.dateStart), "EEEE dd MMMM yyyy", { locale: it })
							}
						/>

						{event.locationName && (
							<InfoRow
								icon={<MapPin className="h-[17px] w-[17px]" strokeWidth={1.8} />}
								label="Dove"
								value={
									<>
										{decodeHtmlEntities(event.locationName)}
										{event.address && (
											<span className="block font-normal text-muted-foreground">{event.address}</span>
										)}
									</>
								}
							/>
						)}

						{event.phone && (
							<InfoRow
								icon={<Phone className="h-[17px] w-[17px]" strokeWidth={1.8} />}
								label="Telefono"
								value={
									<a href={`tel:${event.phone}`} className="font-medium text-primary hover:underline">
										{event.phone}
									</a>
								}
							/>
						)}

						{distanceKm != null && (
							<InfoRow
								icon={<Compass className="h-[17px] w-[17px]" strokeWidth={1.8} />}
								label="Distanza"
								value={`${Math.round(distanceKm)} km da qui`}
							/>
						)}

						{event.sourceUrl && (
							<InfoRow
								icon={<LinkIcon className="h-[17px] w-[17px]" strokeWidth={1.8} />}
								label="Fonte"
								value={
									<>
										<a
											href={event.sourceUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="font-medium text-primary hover:underline"
										>
											{event.source}
										</a>
										<span className="block font-normal text-muted-foreground">
											Fuorirotta raccoglie l&apos;evento dalla fonte, non lo organizza.
										</span>
									</>
								}
							/>
						)}
					</div>

					{event.description && (
						<>
							<h2
								className="mb-2 font-display text-lg font-semibold leading-tight text-foreground"
								style={{ letterSpacing: "var(--tracking-display)" }}
							>
								Cosa aspettarsi
							</h2>
							{/* Reso come testo, non come markup arbitrario: le descrizioni sono
							    testo puro (solosagre e inlombardia strippano i tag alla fonte,
							    opendata restituisce il campo grezzo dell'API). Il sink HTML
							    rimosso in acd78f0 non rientra qui: era una via d'ingresso XSS
							    da contenuto scrapato — T-07-09. */}
							<p className="mb-6 whitespace-pre-line text-base leading-relaxed text-foreground-secondary">
								{htmlToPlainText(event.description)}
							</p>
						</>
					)}

					{hasCoords && (
						<>
							<h2
								className="mb-2 font-display text-lg font-semibold leading-tight text-foreground"
								style={{ letterSpacing: "var(--tracking-display)" }}
							>
								Dove si trova
							</h2>
							<div
								className="mb-3 h-[220px] overflow-hidden rounded-lg bg-surface"
								style={{ boxShadow: "var(--elev-ring)" }}
							>
								<EventsMap events={[event]} disablePopups={true} />
							</div>
						</>
					)}

					{event.imageUrl && (
						<p className="mb-12 border-t border-border-soft pt-4 text-xs leading-relaxed text-muted-foreground">
							Foto: {event.source}
						</p>
					)}
				</div>
			</main>

			{/* Barra d'azione fissa: una sola azione primaria per questa
			    schermata — il link alla fonte vive gia' nella lista sopra. */}
			{hasCoords && (
				<div
					className="fixed inset-x-0 bottom-0 z-30 border-t border-border-soft px-4 pt-3"
					style={{
						background: "color-mix(in srgb, var(--background) 92%, transparent)",
						backdropFilter: "saturate(180%) blur(20px)",
						WebkitBackdropFilter: "saturate(180%) blur(20px)",
						paddingBottom: "max(env(safe-area-inset-bottom), 12px)",
					}}
				>
					<button
						type="button"
						onClick={() => handleNavigation(event.latitude, event.longitude)}
						className="flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-primary font-semibold text-primary-foreground"
					>
						<Navigation className="h-[18px] w-[18px]" />
						Naviga
					</button>
				</div>
			)}

			{/* Foglio "Apri con" (iOS): Dialog.Root Radix, non un overlay scritto
			    a mano — arrivano gratis focus trap, Escape e ritorno del focus. */}
			<Dialog.Root open={navSheetOpen} onOpenChange={setNavSheetOpen}>
				<Dialog.Portal forceMount>
					<AnimatePresence>
						{navSheetOpen && (
							<>
								<Dialog.Overlay />
								<Dialog.ContentUnstyled asChild>
									<motion.div
										initial={{ y: "100%" }}
										animate={{ y: 0 }}
										exit={{ y: "100%" }}
										transition={{ type: "spring", damping: 32, stiffness: 380 }}
										className="fixed inset-x-0 bottom-0 z-[200] rounded-t-lg bg-surface p-5"
										style={{
											boxShadow: "var(--elev-raised)",
											paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
										}}
									>
										<div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
										<div className="mb-4 flex items-center justify-between">
											<Dialog.Title className="text-sm font-semibold text-muted-foreground">
												Apri con
											</Dialog.Title>
											<Dialog.Close asChild>
												<button
													type="button"
													aria-label="Chiudi"
													className="flex h-11 w-11 items-center justify-center rounded-full text-foreground-secondary"
												>
													<X className="h-5 w-5" />
												</button>
											</Dialog.Close>
										</div>
										<div className="flex flex-col gap-3">
											<Dialog.Close asChild>
												<a
													href={`https://www.google.com/maps/dir/?api=1&destination=${event.latitude},${event.longitude}`}
													target="_blank"
													rel="noopener noreferrer"
													className="flex min-h-12 w-full items-center justify-center rounded-pill bg-surface px-5 font-medium text-foreground"
													style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
												>
													Google Maps
												</a>
											</Dialog.Close>
											<Dialog.Close asChild>
												<a
													href={`https://maps.apple.com/?daddr=${event.latitude},${event.longitude}`}
													target="_blank"
													rel="noopener noreferrer"
													className="flex min-h-12 w-full items-center justify-center rounded-pill bg-surface px-5 font-medium text-foreground"
													style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
												>
													Apple Maps
												</a>
											</Dialog.Close>
										</div>
									</motion.div>
								</Dialog.ContentUnstyled>
							</>
						)}
					</AnimatePresence>
				</Dialog.Portal>
			</Dialog.Root>
		</div>
	);
}
