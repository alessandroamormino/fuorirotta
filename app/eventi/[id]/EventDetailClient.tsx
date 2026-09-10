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
import MiniEventCard, { type MiniEventCardData } from "@/components/map/MiniEventCard";
import { eventStatus, formatEventRange } from "@/lib/eventStatus";
import { calculateDistanceKm } from "@/lib/territorial/distance";
import { MOTION_FAST, EASE_STANDARD } from "@/lib/motion";
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
 * Forma di una riga di `mapEvents` (app/api/events/route.ts) rilevante per
 * "Nelle vicinanze" (Task 3, 12-10): i campi di `MiniEventCardData` piu' le
 * coordinate risolte, che servono solo al calcolo della distanza lato client
 * e non alla mini-card.
 */
interface NearbyApiEvent extends MiniEventCardData {
	resolvedLatitude: number | null;
	resolvedLongitude: number | null;
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
	// D-8 (12-10): predicato a 1024px, popolato dall'effect piu' sotto — regge
	// prima dell'hydratazione col ripiego "falso" (ramo mobile), coerente con
	// l'SSR dove window non esiste.
	const [isDesktopSurface, setIsDesktopSurface] = useState(false);
	// "Nelle vicinanze" (Task 3, 12-10): fino a 3 eventi reali, mai l'evento
	// corrente. Ripiego vuoto — sotto 1 elemento la sezione non renderizza
	// affatto (decisione utente 2026-09-08), nessuna copy di stato vuoto.
	const [nearbyEvents, setNearbyEvents] = useState<MiniEventCardData[]>([]);
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

	// D-8 (12-10): stesso predicato a 1024px che 12-09 usa in app/HomeClient.tsx
	// — stessa stringa di media query, una sola verita' condivisa col CSS, mai
	// una larghezza letta a mano. Dichiarato qui e non estratto in un hook
	// condiviso: due call site non giustificano l'estrazione, che si fa quando
	// compare il terzo. Decide quale delle due istanze di EventsMap (colonna
	// laterale o blocco "Dove si trova") monta davvero: mai entrambe.
	useEffect(() => {
		const mq = window.matchMedia("(min-width: 1024px)");
		setIsDesktopSurface(mq.matches);
		const handleChange = (e: MediaQueryListEvent) => setIsDesktopSurface(e.matches);
		mq.addEventListener("change", handleChange);
		return () => mq.removeEventListener("change", handleChange);
	}, []);

	// "Nelle vicinanze" (Task 3, 12-10): solo desktop (la sezione non esiste
	// sulla superficie mobile, nessuna richiesta di rete sprecata) e solo con
	// coordinate risolte — confronto su null, non sulla verita' del valore
	// (0 e' una coordinata valida). Il raggio 25 e' un letterale di questo
	// chiamante, non il tetto MAX_AREA_RADIUS_KM di app/HomeClient.tsx, che
	// presidia un valore che nasce da un gesto utente sulla mappa e non ha
	// giurisdizione qui.
	useEffect(() => {
		if (!event || !isDesktopSurface) return;
		if (event.resolvedLatitude == null || event.resolvedLongitude == null) return;

		const currentId = event.id;
		const originLat = event.resolvedLatitude;
		const originLng = event.resolvedLongitude;
		const controller = new AbortController();

		(async () => {
			try {
				const res = await fetch(
					`/api/events?lat=${originLat}&lng=${originLng}&radius=25&limit=1`,
					{ signal: controller.signal }
				);
				if (!res.ok) return;
				const data: { mapEvents: NearbyApiEvent[] } = await res.json();
				// Array.prototype.sort e' stabile per specifica, e l'ordine
				// d'ingresso e' quello dell'API (dateStart crescente): a distanza
				// uguale vince quindi la data, stesso principio con cui D-18
				// ordina gli eventi a coordinate coincidenti — nessun criterio di
				// spareggio scritto a mano.
				const nearby = (data.mapEvents ?? [])
					.filter(
						(e) =>
							e.id !== currentId && e.resolvedLatitude != null && e.resolvedLongitude != null
					)
					.map((e) => ({
						event: e,
						distance: calculateDistanceKm(
							originLat,
							originLng,
							e.resolvedLatitude as number,
							e.resolvedLongitude as number
						),
					}))
					.sort((a, b) => a.distance - b.distance)
					.slice(0, 3)
					.map(({ event: e }) => e);
				setNearbyEvents(nearby);
			} catch {
				// Sezione accessoria: un errore di rete non e' da mostrare, stesso
				// trattamento silenzioso dell'effect di geolocalizzazione sopra.
			}
		})();

		return () => controller.abort();
	}, [event, isDesktopSurface]);

	const handleSearch = (filters: SearchFilters) => {
		const searchParams = new URLSearchParams();
		if (filters.location) searchParams.append("location", filters.location);
		if (filters.dateFrom)
			searchParams.append("dateFrom", filters.dateFrom.toISOString());
		if (filters.dateTo) searchParams.append("dateTo", filters.dateTo.toISOString());

		router.push(`/?${searchParams.toString()}`);
	};

	// I tre rami mobile restano quelli di oggi (Android diretto, iOS foglio,
	// desktop nuova scheda) — invariati. A desktop (Task 3, 12-10) "Naviga"
	// apre invece il modale "Apri con": senza questo ramo la geometria
	// centrata sarebbe irraggiungibile da un utente reale, perche' il ramo
	// esistente aprirebbe d'ufficio una scheda su un solo fornitore.
	const handleNavigation = (lat: number | null, lng: number | null) => {
		if (lat == null || lng == null) return;

		if (isDesktopSurface) {
			setNavSheetOpen(true);
			return;
		}

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

	// D-8 (12-10): il wrapper passa da `hidden sm:block` a `hidden sm:contents`
	// — un elemento sticky non esce mai dal proprio blocco contenitore, e un
	// wrapper alto quanto la barra la lascerebbe scorrere via al primo pixel.
	// Sotto 640px resta nascosto; sopra sparisce dall'albero delle scatole e
	// <nav> diventa figlio diretto del guscio min-h-screen.
	const desktopNavbar = (
		<div className="hidden sm:contents">
			<Navbar
				filters={draftFilters}
				onFiltersChange={setDraftFilters}
				onSearch={handleSearch}
				onPanelOpenChange={handlePanelOpenChange}
				// Estensione di scopo (decisione utente 2026-09-08): da 1024px in
				// su la zona di ricerca si riveste da pillola "Torna ai risultati"
				// — vedi components/Navbar.tsx per il seam completo.
				searchBackHref="/"
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
	// T-12-D9: unico punto di controllo per un URL che nasce da contenuto
	// scrapato e finisce in un href — alimenta sia la riga "Fonte" della lista
	// raggruppata sia l'azione secondaria della colonna laterale desktop.
	const sourceHref =
		event.sourceUrl && /^https?:\/\//i.test(event.sourceUrl) ? event.sourceUrl : null;

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
				// lg:static + lg:overflow-visible (D-8): un elemento static ignora
				// top/left/right/bottom per definizione, quindi la sola aggiunta
				// neutralizza gli offset fixed senza toccare il ramo mobile — il
				// dettaglio a 1024px e oltre scorre come pagina, stesso trattamento
				// che 12-08 ha dato al guscio della home.
				className="fixed inset-x-0 bottom-0 top-16 overflow-y-auto scrollbar-thin sm:top-28 lg:static lg:overflow-visible"
				inert={navPanelOpen}
			>
				<div
					className={cn(
						"container mx-auto px-4 max-w-7xl",
						hasCoords ? "pb-24 md:pb-24 lg:pb-12" : "pb-8 md:pb-16"
					)}
				>
					{/* Briciole di navigazione (D-8), desktop-only: sotto 1024px la
					    freccia di MobileDetailBar e' gia' l'affordance di ritorno, e
					    due percorsi sovrapposti sarebbero uno di troppo. Colore
					    text-muted-foreground (5,07:1, AA) — mai il grigio in deroga
					    D-21, che vieta esattamente questo uso su un'informazione
					    necessaria. */}
					<nav
						aria-label="Percorso"
						className="hidden items-center gap-2 pb-4 pt-6 text-sm text-muted-foreground lg:flex"
					>
						<NextLink href="/" className="hover:text-foreground hover:underline">
							Eventi
						</NextLink>
						{event.category && (
							<>
								<span aria-hidden="true">›</span>
								<span>{event.category}</span>
							</>
						)}
						{/* Terzo livello: comune dalla relazione Prisma (T-12-04), con
						    ripiego su locationName. Se entrambi sono vuoti, niente terzo
						    livello e niente separatore orfano. */}
						{(event.comune?.name || event.locationName) && (
							<>
								<span aria-hidden="true">›</span>
								<span aria-current="page" className="text-foreground-secondary">
									{decodeHtmlEntities(event.comune?.name || event.locationName || "")}
								</span>
							</>
						)}
					</nav>

					{/* Griglia desktop (D-8): tetto PROPRIO a 1200px, diverso dal
					    max-w-7xl del contenitore di lettura (1280px) e dal tetto
					    1760px della lista — tre decisioni diverse, non consolidate. */}
					<div className="lg:mx-auto lg:grid lg:max-w-[1200px] lg:items-start lg:gap-12 lg:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]">
						<article className="min-w-0">
							{/* Hero: inquadratura piena (criterio 12) — nessun ritaglio, solo
							    l'asse verticale e' vincolato. Il matting su --surface per le
							    foto verticali e' intenzionale. A 1024px e oltre l'hero vive
							    dentro la colonna di testo (D-8): -mx-4/lg:mx-0 annulla il
							    gutter px-4 del contenitore SOLO sotto 1024px. */}
							{event.imageUrl ? (
								<div
									className={cn(
										"grid w-full place-items-center border-b border-border-soft bg-surface",
										"-mx-4 lg:mx-0 lg:mb-8 lg:overflow-hidden lg:rounded-lg lg:border-b-0 lg:shadow-[var(--elev-ring)]",
										!heroLoaded && "aspect-[3/2]"
									)}
								>
									{/* Tetto verticale in classe, non in style inline: uno style
									    inline non e' scopabile per media query. Stesso principio
									    (object-fit: contain, vincolo sul solo asse verticale,
									    criterio di successo 12), valore diverso per superficie —
									    non una seconda regola. Tetto desktop abbassato a 50dvh
									    (da 62dvh) su richiesta dell'utente in UAT 12-11 del
									    2026-09-10: "immagine leggermente piu' piccola per farci
									    stare piu' roba" — la pagina di dettaglio resta a scorrimento
									    di pagina, non un riquadro interno (invariato). Mobile
									    intatto a 46dvh. */}
									<img
										src={event.imageUrl}
										alt={decodeHtmlEntities(event.title)}
										loading="eager"
										decoding="async"
										onLoad={() => setHeroLoaded(true)}
										className="block w-full h-auto object-contain max-h-[46dvh] lg:max-h-[50dvh]"
									/>
								</div>
							) : (
								<div className="border-b border-border-soft -mx-4 lg:mx-0 lg:mb-8 lg:overflow-hidden lg:rounded-lg lg:border-b-0 lg:shadow-[var(--elev-ring)]">
									<CategoryPlaceholder category={event.category ?? "Altro"} className="rounded-none" />
								</div>
							)}

							{/* pt-5 tolto al contenitore esterno (D-8): a desktop il testo
							    parte a filo dell'hero, sotto 1024px il ritmo verticale resta
							    identico a prima. */}
							<div className="pt-5 lg:pt-0">
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

									{sourceHref && (
										<InfoRow
											icon={<LinkIcon className="h-[17px] w-[17px]" strokeWidth={1.8} />}
											label="Fonte"
											value={
												<>
													<a
														href={sourceHref}
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
							</div>

							{/* Dove si trova: mappa mobile/tablet — a 1024px e oltre la
							    STESSA istanza vive nella colonna laterale (isDesktopSurface),
							    mai entrambe: due contesti Mapbox per un solo pin sarebbero
							    uno spreco di rete e WebGL. lg:hidden e' un secondo strato di
							    guardia CSS per il primo paint, prima che l'effect idrati. */}
							{hasCoords && !isDesktopSurface && (
								<>
									<h2
										className="mb-2 font-display text-lg font-semibold leading-tight text-foreground"
										style={{ letterSpacing: "var(--tracking-display)" }}
									>
										Dove si trova
									</h2>
									<div
										className="lg:hidden mb-3 h-[220px] overflow-hidden rounded-lg bg-surface"
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
						</article>

						{/* Colonna laterale (D-8): sticky su --topbar-h (pubblicata da
						    components/Navbar.tsx, piano 12-08), statica sotto 1024px. Il
						    ripiego 92px nel calc() e' quello del mock: se la variabile non
						    fosse ancora scritta la colonna cade su una misura sensata. */}
						<aside className="hidden lg:block lg:sticky" style={{ top: "calc(var(--topbar-h, 92px) + 24px)" }}>
							{/* T-12-10-checkpoint: "Vedi sulla fonte" rimossa dalla colonna
							    (giudicata ridondante con la riga "Fonte" della lista
							    raggruppata, decisione utente). L'unica azione rimasta,
							    "Naviga", esiste solo con coordinate — quindi il box non
							    ha piu' motivo di comparire senza hasCoords: senza,
							    sourceHref da solo apriva un riquadro vuoto (evento 61501,
							    Como, nessuna coordinata risolta). */}
							{hasCoords && (
								<div className="mb-5 overflow-hidden rounded-lg bg-surface">
									{isDesktopSurface && (
										<div className="h-[240px]">
											<EventsMap events={[event]} disablePopups={true} />
										</div>
									)}
									<div className="flex flex-col gap-3 p-4">
										{/* Azione primaria: "Naviga", stessa pelle della barra
										    fissa mobile — stesso comando, due collocazioni. */}
										<button
											type="button"
											onClick={() => handleNavigation(event.latitude, event.longitude)}
											className="flex h-12 w-full items-center justify-center gap-2 rounded-pill bg-primary font-semibold text-primary-foreground"
										>
											<Navigation className="h-[18px] w-[18px]" />
											Naviga
										</button>
									</div>
								</div>
							)}
							{/* "Nelle vicinanze" (Task 3, 12-10): sotto 1 evento la sezione
							    non renderizza affatto — nessuna copy di stato vuoto, nessun
							    riquadro morto (decisione utente 2026-09-08). Titolo invariato
							    al plurale anche con un solo elemento. */}
							{nearbyEvents.length >= 1 && (
								<div className="overflow-hidden rounded-lg bg-surface p-4">
									<h2 className="mb-3 font-display text-base font-semibold text-foreground">
										Nelle vicinanze
									</h2>
									<div className="flex flex-col gap-1">
										{nearbyEvents.map((nearby) => (
											<MiniEventCard key={nearby.id} event={nearby} className="hover:bg-background" />
										))}
									</div>
								</div>
							)}
						</aside>
					</div>
				</div>
			</main>

			{/* Barra d'azione fissa: una sola azione primaria per questa
			    schermata — il link alla fonte vive gia' nella lista sopra.
			    lg:hidden (D-8): a 1024px e oltre "Naviga" vive solo nella
			    colonna laterale sticky, e questo blocco non ha piu' motivo di
			    coprire la larghezza intera dello schermo. */}
			{hasCoords && (
				<div
					className="fixed inset-x-0 bottom-0 z-30 border-t border-border-soft px-4 pt-3 lg:hidden"
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
									{/* Due geometrie sullo stesso componente (D-8): sotto 1024px
									    il foglio ancorato al fondo di sempre (molla su y); da
									    1024px in su un piccolo modale centrato che anima la SOLA
									    opacita' — qualunque trasformazione animata farebbe scrivere
									    a framer un transform inline che cancella -translate-x-1/2/
									    -translate-y-1/2, e il riquadro finirebbe con l'angolo al
									    centro dello schermo invece del proprio centro. */}
									<motion.div
										initial={isDesktopSurface ? { opacity: 0 } : { y: "100%" }}
										animate={isDesktopSurface ? { opacity: 1 } : { y: 0 }}
										exit={isDesktopSurface ? { opacity: 0 } : { y: "100%" }}
										transition={
											isDesktopSurface
												? { duration: MOTION_FAST, ease: EASE_STANDARD }
												: { type: "spring", damping: 32, stiffness: 380 }
										}
										className={cn(
											"z-[200] bg-surface p-5",
											isDesktopSurface
												? "fixed left-1/2 top-1/2 w-[min(360px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg"
												: "fixed inset-x-0 bottom-0 rounded-t-lg"
										)}
										style={
											isDesktopSurface
												? { boxShadow: "0 0 0 1px var(--border-soft), var(--elev-raised)" }
												: {
														boxShadow: "var(--elev-raised)",
														paddingBottom: "max(env(safe-area-inset-bottom), 20px)",
													}
										}
									>
										{/* Maniglia di trascinamento: affordance del foglio, senza
										    senso su un modale centrato. */}
										{!isDesktopSurface && (
											<div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-border" />
										)}
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
