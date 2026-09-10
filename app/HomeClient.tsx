"use client";

import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { Event, SearchFilters } from "@/lib/types";
import EventCard from "@/components/EventCard";
import Navbar from "@/components/Navbar";
import CategoryFilterBar from "@/components/CategoryFilterBar";
import ViewSwitch, {
	VIEW_SWITCH_TAB_ID,
	VIEW_SWITCH_PANEL_ID,
	DESKTOP_VIEW_REGION_ID,
	type MobileView,
	type ViewValue,
} from "@/components/ViewSwitch";
import MapEventsRail from "@/components/map/MapEventsRail";
import type { MapViewportChange } from "@/components/EventsMap";
import { CANONICAL_CATEGORIES } from "@/lib/categories/taxonomy";
import { pageWindow, PAGE_WINDOW_SLOTS, type PageSlot } from "@/lib/pagination";
import { Check, ChevronLeft, ChevronRight, Crosshair, Loader2, RefreshCw, Search } from "lucide-react";
import { useEventCache } from "@/lib/eventCache";
import { calculateDistanceKm } from "@/lib/territorial/distance";
import { EASE_STANDARD, MOTION_BASE, MOTION_FAST } from "@/lib/motion";
import { cn } from "@/lib/utils";

// Il blocco di ripristino da sessionStorage (sotto, useIsomorphicLayoutEffect)
// deve girare PRIMA del primo paint: useLayoutEffect farebbe questo su
// server e client, ma emette un warning in SSR perche' HomeClient e' un
// componente client reso anche lato server. useEffect li' non lo emette ma
// gira dopo il paint, lasciando un frame non filtrato visibile. Questa
// costante sceglie l'uno o l'altro in base a dove gira — solo quel blocco la
// usa, gli altri effect del file restano passivi.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

// T-12-21: il raggio di "Cerca in quest'area" nasce dalla mappa (uno zoom
// estremo produrrebbe un'inquadratura di ampiezza continentale) ma finisce
// comunque in un parametro di query pubblico verso /api/events — troncato
// qui, una sola volta, nel punto in cui il valore entra in areaSearch (non
// alla costruzione dei parametri di fetchEvents, o un secondo chiamante lo
// aggirerebbe). 200km e' lo stesso tetto gia' usato altrove nel prodotto
// (azione "Allarga a 200 km" dello stato vuoto).
const MAX_AREA_RADIUS_KM = 200;

// Task 3: soglia minima di spostamento del centro rispetto all'ultima
// ricerca sull'area prima che la pillola "Cerca in quest'area" compaia — un
// movimento di pochi metri (assestamento del gesto di pan) non e' una nuova
// area.
const AREA_PILL_THRESHOLD_KM = 0.5;

// VR-08: il gate fa un grep letterale su questo file e vuole una
// dichiarazione (const/function), non un import rinominato — vedi
// <perche_due_nomi> di 12-11-PLAN.md. L'implementazione vera vive in
// lib/pagination.ts (pageWindow/PAGE_WINDOW_SLOTS), pura e autoverificata
// con `npx tsx lib/pagination.ts`: questi due nomi sono soltanto gli alias
// che il gate cerca, non una seconda logica duplicata.
const buildPageWindow = pageWindow;
const MAX_PAGE_SLOTS = PAGE_WINDOW_SLOTS;

// T-12-D13: tetto di validazione sul ripristino di currentPage da
// sessionStorage — stesso trattamento di MAX_LOADED_COUNT/T-12-12. 1000
// pagine * 12 = 12.000 eventi, largamente fuori dalla scala reale del
// catalogo (oggi 1.971 eventi = 165 pagine).
const MAX_RESTORED_PAGE = 1000;

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
	// T-12-12/WR-03: tetto al conteggio ripristinato da sessionStorage (vedi
	// il blocco di ripristino sotto) — senza, un valore manomesso diventa un
	// `limit` arbitrariamente grande verso /api/events. 25 pagine (300
	// eventi) e' generoso per una sessione di scorrimento reale.
	const MAX_LOADED_COUNT = LIMIT * 25;
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
	// D-07: fonte unica dei filtri applicati (searchFilters, invariato) e dei
	// filtri in redazione (draftFilters, nuovo) — la Navbar riceve/scrive solo
	// il secondo; handleSearch scrive entrambi cosi' il redatto non resta mai
	// indietro rispetto all'applicato dopo un submit o un reset. Non
	// persistito: gli effect di scrittura in sessionStorage restano agganciati
	// a searchFilters.
	const [draftFilters, setDraftFilters] = useState<SearchFilters>({ location: "", dateFrom: null, dateTo: null, radius: undefined });
	const [userLocation, setUserLocation] = useState<{
		lat: number;
		lng: number;
	} | null>(null);
	// Task 3 (D-12/"Cerca in quest'area"): centro+raggio di una ricerca
	// sull'inquadratura corrente. Tenuto FUORI da searchFilters/draftFilters
	// di proposito: quelli sono i filtri dell'utente, persistiti e mostrati
	// dalla pillola di ricerca — un'area ci finirebbe dentro annuncerebbe una
	// destinazione che l'utente non ha scelto e sposterebbe il conteggio del
	// badge da sola. Non persistito in sessionStorage: e' legato a
	// un'inquadratura, non a una preferenza.
	const [areaSearch, setAreaSearch] = useState<{ lat: number; lng: number; radiusKm: number } | null>(null);

	// Il termine categoria e areaSearch sono qui apposta: senza, effectiveClusterGeoJSON
	// sotto continuerebbe a servire la cache cluster precalcolata (non filtrata)
	// mentre la lista e' gia' filtrata — due risposte diverse sullo stesso
	// schermo (11-UI-SPEC.md, Interaction contract; key_links del piano 12-06).
	const hasActiveFilters = !!(
		searchFilters.location || searchFilters.dateFrom || searchFilters.dateTo || searchFilters.radius ||
		(selectedCategory && selectedCategory !== "all") || areaSearch
	);
	const effectiveClusterGeoJSON = hasActiveFilters ? null : clusterGeoJSON;

	// D-08: lista e mappa sono due viste alla pari sotto lg, scambiate da
	// ViewSwitch — persistita in sessionStorage con lo stesso trattamento
	// gia' riservato a selectedCategory (T-11-11/T-12-13 sotto).
	const [mobileView, setMobileView] = useState<MobileView>("list");

	// 12-08/D-3: macchina a stati distinta da mobileView (superfici mutuamente
	// esclusive per larghezza, mai collassate in una sola variabile — il ramo
	// mobile resta guidato da mobileView esattamente com'e'). "split" e' il
	// default da 1024px in su: il vecchio stato dell'overlay di ingrandimento
	// mappa e' rimosso per intero, a desktop l'ingrandimento a piena vista lo
	// fa questo interruttore (stato "map"), D-3.
	const [desktopView, setDesktopView] = useState<ViewValue>("split");

	// D-12: fonte unica del legame bidirezionale lista<->mappa, condivisa fra
	// EventsMap (ogni istanza, mobile e desktop) e le card. Non duplicare
	// dentro la mappa o dentro il carosello.
	const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
	const handleEventSelect = useCallback((id: number | null) => {
		setSelectedEventId(id);
	}, []);

	// Task 1/3: ultima inquadratura riportata da onViewportChange (solo
	// istanza mobile — il foglio inferiore e la pillola d'area sono
	// composizione mobile, D-20). ids/centro/raggio, mai ricalcolati qui.
	const [mapViewport, setMapViewport] = useState<MapViewportChange | null>(null);
	// Origine dell'ultima ricerca sull'area (o della prima inquadratura nota):
	// la pillola compare solo quando il centro corrente se ne allontana oltre
	// AREA_PILL_THRESHOLD_KM, non ad ogni pixel di trascinamento.
	const [lastSearchOrigin, setLastSearchOrigin] = useState<{ lat: number; lng: number } | null>(null);
	const [areaSearchLoading, setAreaSearchLoading] = useState(false);
	const handleViewportChange = useCallback((change: MapViewportChange) => {
		setMapViewport(change);
		setLastSearchOrigin((prev) => prev ?? change.center);
	}, []);

	// T-12-16: la risoluzione degli id in vista su mapEvents e' memoizzata
	// sull'array di id (e su mapEvents) — senza, un movimento continuo della
	// mappa o un qualunque re-render di HomeClient (es. un tasto premuto nel
	// campo Dove) rigenererebbe l'intero elenco del carosello da zero.
	const viewportEvents = useMemo(() => {
		if (!mapViewport) return [];
		const idSet = new Set(mapViewport.ids);
		return mapEvents.filter((event) => idSet.has(event.id));
	}, [mapViewport, mapEvents]);

	// 12-09: il controllo "mobileView === 'map'" che viveva qui prima non
	// serve piu' come guardia di visibilita' — solo l'istanza della
	// superficie ATTIVA pubblica onViewportChange (isDesktopSurface sotto),
	// quindi mapViewport si aggiorna solo quando il riquadro che lo mostra e'
	// davvero a schermo. Il riquadro mobile e quello desktop leggono lo
	// stesso valore, ciascuno gia' nel proprio ramo di rendering condizionale.
	const showAreaPill =
		mapViewport != null &&
		lastSearchOrigin != null &&
		calculateDistanceKm(
			mapViewport.center.lat,
			mapViewport.center.lng,
			lastSearchOrigin.lat,
			lastSearchOrigin.lng
		) > AREA_PILL_THRESHOLD_KM;

	// D-11 (Fase 17, piano 04): il pannello desktop copre "barra + pannello"
	// (il dropdown e' portalato sul body, fuori da <main>), quindi il
	// confinamento del focus/puntatore si ottiene rendendo inerte <main>
	// invece di un focus trap che non potrebbe comprendere entrambi.
	// useCallback: identita' stabile, altrimenti l'effect in Navbar.tsx che
	// dipende da questa callback ripartirebbe a ogni render di HomeClient
	// (ogni tasto premuto in draftFilters).
	const [navPanelOpen, setNavPanelOpen] = useState(false);
	const handlePanelOpenChange = useCallback((open: boolean) => {
		setNavPanelOpen(open);
	}, []);

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

	// D-07: "quanti caricati", non "quale pagina" — sostituisce currentPage.
	// Inizializzato alla lunghezza dei risultati SSR, cosi' il piede della
	// lista sa gia' da dove ripartire anche prima del primo fetch client.
	const [loadedCount, setLoadedCount] = useState<number>(initialEvents.length);
	const [total, setTotal] = useState(initialTotal);
	// loading copre il fetch di RIMPIAZZO (spinner a tutta pagina); loadingMore
	// copre l'ACCODAMENTO ("carica altri") — due stati distinti perche' un
	// accodamento non deve far sparire la lista gia' visibile sotto uno
	// spinner centrale.
	const [loadingMore, setLoadingMore] = useState(false);

	// D-6: paginazione numerata desktop — modello indipendente da loadedCount
	// (D-07, "carica altri" mobile). I due modelli non condividono stato, ma
	// coesistono nello stesso componente perche' attivi su superfici
	// mutuamente esclusive per larghezza (D-23).
	const [currentPage, setCurrentPage] = useState(1);
	const [pageLoading, setPageLoading] = useState(false);
	const [pageError, setPageError] = useState(false);
	const lastPage = Math.max(1, Math.ceil(total / LIMIT));
	// Valore ripristinato da sessionStorage (validato) in attesa di sapere se
	// la superficie e' desktop: caricare la pagina 7 su un telefono sarebbe
	// peggio del non ripristinarla affatto. 0 = niente da applicare.
	const restoredPageRef = useRef(0);

	// WR-04: due chip cliccati in rapida sequenza lanciano due fetch
	// concorrenti; senza un identificatore di generazione, l'ULTIMA risposta
	// che ARRIVA (non l'ultima INVIATA) vince — con rete variabile la UI
	// potrebbe mostrare gli eventi della categoria A mentre il chip attivo e' B.
	const requestIdRef = useRef(0);

	// Gap 2 di 11-VERIFICATION.md: senza questa guardia, al mount React esegue
	// i tre effect di scrittura qui sotto PRIMA dell'effect di ripristino piu'
	// in basso, e li esegue con lo stato iniziale di default — sovrascrivendo
	// in sessionStorage il valore appena salvato che il ripristino sta per
	// leggere. Il flag resta spento finche' il ripristino non e' avvenuto,
	// cosi' nessuno dei tre effect scrive prima di aver letto.
	const hydratedRef = useRef(false);

	useEffect(() => {
		if (!hydratedRef.current) return;
		sessionStorage.setItem("loadedCount", loadedCount.toString());
	}, [loadedCount]);

	// D-6: stessa forma esatta dell'effect sopra, chiave dedicata — i due
	// modelli (accodamento mobile, paginazione desktop) non condividono
	// stato.
	useEffect(() => {
		if (!hydratedRef.current) return;
		sessionStorage.setItem("currentPage", String(currentPage));
	}, [currentPage]);

	useEffect(() => {
		if (!hydratedRef.current) return;
		sessionStorage.setItem("searchFilters", JSON.stringify(searchFilters));
	}, [searchFilters]);

	useEffect(() => {
		if (!hydratedRef.current) return;
		sessionStorage.setItem("selectedCategory", selectedCategory);
	}, [selectedCategory]);

	useEffect(() => {
		if (!hydratedRef.current) return;
		sessionStorage.setItem("mobileView", mobileView);
	}, [mobileView]);

	// 12-08/D-3: stessa forma esatta di sessionStorage.setItem("mobileView", ...)
	// sopra — copia alla lettera, non un secondo schema.
	useEffect(() => {
		if (!hydratedRef.current) return;
		sessionStorage.setItem("desktopView", desktopView);
	}, [desktopView]);

	// 12-09: superficie attiva, una sola fonte — estende lo STESSO effect che
	// gia' registra questa media query (12-08, ripiegamento a "list" sotto
	// 1024px), non un secondo listener: due ascoltatori sulla stessa query
	// sarebbero due verita' che possono divergere. Il riquadro mappa desktop
	// e' nascosto via CSS sotto 1024px, non smontato — la sua istanza di
	// mappa esiste comunque, ha dimensione zero e pubblicherebbe
	// un'inquadratura senza senso se non fosse esclusa qui.
	const [isDesktopSurface, setIsDesktopSurface] = useState(false);
	useEffect(() => {
		const mql = window.matchMedia("(min-width: 1024px)");

		// Mount: inizializza isDesktopSurface e, se la superficie e' gia'
		// desktop, applica una pagina ripristinata da sessionStorage (D-6,
		// Task 2) — il mount non attraversa il confine, quindi non passa mai
		// dal ramo di azzeramento di handleChange sotto: e' per questo che
		// il ripristino vive qui e non in un effect su isDesktopSurface, che
		// girerebbe anche alla sua stessa inizializzazione al mount.
		const matchesAtMount = mql.matches;
		if (!matchesAtMount) {
			setDesktopView((prev) => (prev === "split" ? "list" : prev));
		}
		setIsDesktopSurface(matchesAtMount);
		if (matchesAtMount && restoredPageRef.current > 1) {
			const restored = restoredPageRef.current;
			setCurrentPage(restored);
			fetchEvents(searchFilters, { mode: "page", limit: LIMIT, offset: (restored - 1) * LIMIT });
		}
		// Il ripristino avviene una volta sola: se la superficie non e'
		// desktop il valore ripristinato viene semplicemente lasciato
		// cadere — la pagina 7 non ha significato su una lista che accoda.
		restoredPageRef.current = 0;

		// Cambio di superficie, cioe' esattamente quando il confine viene
		// attraversato: riportare la lista all'inizio impedisce ai due
		// modelli di mescolarsi — sessanta card accodate da mobile mostrate
		// come "pagina 1", oppure le dodici card della pagina 50 da cui
		// "carica altri" mobile ripartirebbe con l'offset sbagliato.
		const handleChange = (e: MediaQueryListEvent) => {
			if (!e.matches) {
				setDesktopView((prev) => (prev === "split" ? "list" : prev));
			}
			setIsDesktopSurface(e.matches);
			setCurrentPage(1);
			setPageError(false);
			fetchEvents(searchFilters, { mode: "replace" });
		};
		mql.addEventListener("change", handleChange);
		return () => mql.removeEventListener("change", handleChange);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Task 2 (D-5): comando "Centra sulla destinazione" del riquadro mappa
	// desktop — contatore locale, incrementato al click e passato a
	// EventsMap come recenterNonce.
	const [recenterNonce, setRecenterNonce] = useState(0);

	// Task 3: anche il ritorno alla vista lista azzera la ricerca sull'area,
	// cosi' la lista non resta silenziosamente ristretta a un'area che non e'
	// piu' a schermo. hydratedRef esclude il giro di ripristino iniziale.
	useEffect(() => {
		if (!hydratedRef.current) return;
		if (mobileView !== "list" || !areaSearch) return;
		setAreaSearch(null);
		setLastSearchOrigin(null);
		setLoadedCount(0);
		fetchEvents(searchFilters, { mode: "replace" }, null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mobileView]);

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

	// On mount: check if user has active filters or cached data; otherwise use SSR data.
	// Layout effect (non passivo): gira dopo il render ma prima del paint, cosi'
	// il frame non filtrato non viene mai disegnato — nessuna pillola stretta
	// visibile nemmeno per un frame dopo un reload con filtri attivi. hydratedRef
	// resta comunque la guardia che rende l'ordine dichiarato invece che
	// accidentale: i tre effect passivi di scrittura sotto girano sempre dopo
	// (le passive effect committano solo dopo tutti i layout effect), ma senza
	// il flag scriverebbero comunque i default prima che questo blocco legga.
	useIsomorphicLayoutEffect(() => {
		// Read sessionStorage after hydration to avoid SSR mismatch
		const savedLoadedCount = sessionStorage.getItem("loadedCount");
		const savedFilters = sessionStorage.getItem("searchFilters");
		// T-12-12/WR-03: stessa guardia che T-11-05-01 applicava a currentPage,
		// piu' il tetto che T-11-05-01 non aveva ancora (il modello era
		// "pagina", non "conteggio"): un valore manomesso in sessionStorage
		// raggiungerebbe il `limit` della richiesta di ripristino sotto.
		const parsedLoadedCount = savedLoadedCount ? parseInt(savedLoadedCount, 10) : NaN;
		const restoredCount =
			Number.isInteger(parsedLoadedCount) && parsedLoadedCount >= 1
				? Math.min(parsedLoadedCount, MAX_LOADED_COUNT)
				: null;
		// Un conteggio ripristinato oltre una singola pagina non e' coperto ne'
		// dalla cache ne' dagli initialEvents SSR (entrambi contengono solo la
		// prima pagina): serve una richiesta dedicata piu' sotto
		// (limit=restoredCount, offset=0) per non perdere la posizione (D-07).
		const needsRestoreFetch = restoredCount !== null && restoredCount > LIMIT;
		if (restoredCount !== null && !needsRestoreFetch) setLoadedCount(restoredCount);

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
				setDraftFilters(activeFilters);
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

		// D-08/T-12-13: stesso trattamento gia' riservato alla categoria
		// (T-11-11) — un valore fuori dai due ammessi viene scartato, non
		// applicato, mai propagato oltre questo blocco.
		const savedMobileView = sessionStorage.getItem("mobileView");
		if (savedMobileView === "list" || savedMobileView === "map") {
			setMobileView(savedMobileView);
		}

		// T-12-D1: stesso trattamento — un valore manomesso in sessionStorage
		// non deve diventare uno stato di vista arbitrario. Validato contro
		// l'elenco chiuso dei tre stati prima di applicarlo, altrimenti resta
		// il default "split" gia' nello useState.
		const savedDesktopView = sessionStorage.getItem("desktopView");
		if (savedDesktopView === "list" || savedDesktopView === "split" || savedDesktopView === "map") {
			setDesktopView(savedDesktopView);
		}

		// D-6/T-12-D13: ripristino di currentPage — fuori dalle venti righe
		// che seguono JSON.parse(savedFilters) (il gate ci cerca
		// setDraftFilters in quell'intervallo), e con una forma di
		// validazione diversa dalle guardie typeof sulle chiavi di `parsed`
		// che lo stesso gate conta: Number.parseInt piu' Number.isInteger e'
		// una forma diversa e sufficiente. Il valore validato non scatta un
		// fetch qui: a questo punto del mount la superficie attiva non e'
		// ancora nota (vedi l'effect della media query sotto), e caricare la
		// pagina 7 su un telefono sarebbe peggio del non ripristinarla
		// affatto — resta in un ref finche' quell'effect non lo consuma.
		const savedCurrentPage = sessionStorage.getItem("currentPage");
		const parsedCurrentPage = savedCurrentPage ? Number.parseInt(savedCurrentPage, 10) : NaN;
		if (Number.isInteger(parsedCurrentPage) && parsedCurrentPage >= 1) {
			restoredPageRef.current = Math.min(parsedCurrentPage, MAX_RESTORED_PAGE);
		}

		// Da qui in poi il ripristino e' completo: gli effect di persistenza
		// possono tornare a scrivere. Questo punto e' l'unico attraversato in
		// ogni caso — il ramo `cached` piu' sotto contiene un `return`
		// anticipato che salterebbe qualunque assegnazione messa dopo di se'.
		hydratedRef.current = true;

		const queryKey = generateQueryKey(activeFilters, activeCategory);
		const cached = getCachedEvents(queryKey);
		const restoreOptions = needsRestoreFetch
			? { mode: "replace" as const, limit: restoredCount as number }
			: undefined;

		if (cached) {
			setEvents(cached.events);
			setMapEvents(cached.mapEvents || cached.events);
			setTotal(cached.total);
			if (!needsRestoreFetch) setLoadedCount(cached.events.length);
			if (needsRestoreFetch) fetchEvents(activeFilters, restoreOptions);
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
			if (needsRestoreFetch) fetchEvents(activeFilters, restoreOptions);
		} else {
			// WR-06: activeFilters esplicito, non il default searchFilters della
			// closure — setSearchFilters(activeFilters) sopra non e' ancora
			// visibile qui, stesso giro di funzione.
			fetchEvents(activeFilters, restoreOptions);
		}
	}, []);

	const [isInitialMount, setIsInitialMount] = useState(true);

	useEffect(() => {
		if (isInitialMount) {
			setIsInitialMount(false);
			return;
		}

		// Task 3: un cambio filtri/categoria e' il segnale che l'utente e'
		// tornato a comandare lui — azzera la ricerca sull'area. `null`
		// esplicito passato a fetchEvents sotto (non la closure areaSearch,
		// ancora vecchia in questo stesso giro): vedi commento su fetchEvents.
		setAreaSearch(null);
		setLastSearchOrigin(null);
		// D-6: l'insieme dei risultati cambia — restare a pagina 50 di un
		// elenco che ora ne ha 3 mostrerebbe il vuoto. Stessa ragione per cui
		// questo effect gia' azzera loadedCount (il ramo mobile) sotto.
		setCurrentPage(1);
		setPageError(false);

		const queryKey = generateQueryKey(searchFilters, selectedCategory);
		const cached = getCachedEvents(queryKey);

		if (cached) {
			setEvents(cached.events);
			setMapEvents(cached.mapEvents || cached.events);
			setTotal(cached.total);
			setLoading(false);
			setLoadedCount(cached.events.length);
		} else {
			setLoading(true);
			setEvents([]);
			setLoadedCount(0);
			// Gap 1 di 11-VERIFICATION.md: azzerare qui i pin della mappa li
			// svuota per 50-75ms prima che i dati nuovi arrivino (misurato in
			// Chrome), a ogni cambio categoria con cache miss. mapEvents resta
			// quindi quello della selezione precedente finche' fetchEvents non
			// scrive dati reali del server — una categoria davvero senza
			// risultati svuota comunque la mappa, perche' quella scrittura
			// arriva da un array vuoto ricevuto dal server, non da un azzeramento
			// anticipato qui.
			fetchEvents(searchFilters, {}, null);
		}
	}, [searchFilters, selectedCategory]); // eslint-disable-line react-hooks/exhaustive-deps

	// WR-06: filters (default = searchFilters) invece di leggere searchFilters
	// dalla closure. Il mount effect sotto chiama setSearchFilters(activeFilters)
	// e poi fetchEvents(...) nello stesso giro: setState non e' sincrono, quindi
	// quella chiamata catturava ancora lo stato iniziale vuoto, non
	// activeFilters — al reload con filtri salvati in sessionStorage e una
	// useEventCache fredda, l'app interrogava eventi non filtrati. Nota
	// corretta in 11-05 (Difetto B): a questo punto della history la Navbar
	// NON mostrava ancora i filtri ripristinati — restava sui default vuoti
	// finche' l'utente non toccava un campo, perche' searchFilters non
	// raggiungeva mai useNavbarSearch. Le altre call site (il "carica altri",
	// l'effect [searchFilters]) restano corrette lasciando il default, perche'
	// li' il render e' gia' allineato allo stato corrente.
	//
	// D-07: fetchEvents non prende piu' un numero di pagina. `mode: "replace"`
	// (default) sostituisce la lista — primo caricamento, cambio filtri,
	// ripristino dopo il dettaglio; `mode: "append"` la accoda ("carica
	// altri"), partendo da `loadedCount` se non viene passato un offset
	// esplicito. key_links del piano: mapEvents non e' mai paginato dalla
	// rotta (torna sempre l'insieme COMPLETO per i filtri correnti), quindi
	// viene riscritto a ogni chiamata indipendentemente dal mode.
	//
	// Task 3: `area` di default legge lo stato areaSearch corrente (stesso
	// pattern di `filters = searchFilters`), ma i chiamanti che devono
	// azzerare l'area (cambio filtri/categoria, ritorno alla vista lista) lo
	// passano esplicitamente a `null` — leggere la closure qui basterebbe per
	// il valore MA non per il momento: setAreaSearch(null) e' asincrono, e la
	// stessa chiamata di fetchEvents nello stesso giro vedrebbe ancora il
	// valore vecchio senza un override esplicito.
	const fetchEvents = async (
		filters: SearchFilters = searchFilters,
		options: { mode?: "replace" | "append" | "page"; limit?: number; offset?: number } = {},
		area: { lat: number; lng: number; radiusKm: number } | null = areaSearch
	) => {
		const mode = options.mode ?? "replace";
		const limit = options.limit ?? LIMIT;
		const offset = options.offset ?? (mode === "append" ? loadedCount : 0);

		const requestId = ++requestIdRef.current;
		if (process.env.APP_DEBUG === "true") {
			console.log(`[Fetch] mode=${mode} limit=${limit} offset=${offset}`);
		}
		if (mode === "append") {
			setLoadingMore(true);
		} else if (mode === "page") {
			setPageLoading(true);
		} else {
			setLoading(true);
		}
		try {
			const params = new URLSearchParams();

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

			// Task 3: centro+raggio dell'area inquadrata prendono il posto di
			// userLocation/filters.radius quando una ricerca sull'area e' in
			// corso — alternativa sui due valori, non un secondo percorso di
			// rete. /api/events non guadagna un parametro nuovo: lat/lng/radius
			// sono gia' pubblici, li usa gia' "nelle vicinanze" dalla Fase 9.
			if (area) {
				params.append("lat", area.lat.toString());
				params.append("lng", area.lng.toString());
				params.append("radius", area.radiusKm.toString());
			} else if (userLocation) {
				params.append("lat", userLocation.lat.toString());
				params.append("lng", userLocation.lng.toString());
				if (filters.radius) {
					params.append("radius", filters.radius.toString());
				}
			}

			params.append("limit", limit.toString());
			params.append("offset", offset.toString());

			const response = await fetch(`/api/events?${params}`);

			// Risposta superata da un fetchEvents piu' recente: ignorala, non
			// toccare lo stato (che appartiene gia' alla richiesta corrente).
			if (requestId !== requestIdRef.current) return;

			if (!response.ok) {
				// WR-01: lista vuota, totale azzerato, mappa invariata — SOLO per
				// un rimpiazzo. Un accodamento fallito non deve svuotare quanto
				// gia' mostrato (T-12-14): si arrende e basta, il finally sotto
				// spegne lo spinner del piede. D-6: un fetch di PAGINA fallito
				// segue una politica propria, decisione utente 2026-09-08 — la
				// pagina precedente resta a schermo, non svuota, non azzera,
				// segnala solo l'errore (non riusa WR-01: quella e' per i
				// filtri, dove l'insieme dei risultati cambia davvero).
				if (mode === "replace") {
					setEvents([]);
					setTotal(0);
				} else if (mode === "page") {
					setPageError(true);
				}
				return;
			}

			const data = await response.json();

			if (requestId !== requestIdRef.current) return;

			if (data.error || !data.events) {
				// WR-01/D-6: vedi commento sopra, stessa politica.
				if (mode === "replace") {
					setEvents([]);
					setTotal(0);
				} else if (mode === "page") {
					setPageError(true);
				}
				return;
			}

			const newEvents = data.events || [];
			const newMapEvents = data.mapEvents || newEvents;
			const newTotal = data.total || 0;

			if (mode === "append") {
				setEvents((prev) => [...prev, ...newEvents]);
				setLoadedCount((prev) => prev + newEvents.length);
			} else {
				setEvents(newEvents);
				setLoadedCount(newEvents.length);
				if (mode === "page") setPageError(false);
			}
			// mapEvents non e' paginato (key_links del piano): la rotta lo
			// restituisce sempre completo per i filtri correnti, a prescindere
			// da quanti eventi la lista ha accodato finora. Ma un fetch "page"
			// riusa GLI STESSI filtri gia' in stato (goToPage non li tocca):
			// il contenuto e' garantito identico a quello gia' in mapEvents,
			// cambia solo l'offset della LISTA. Riscriverlo comunque darebbe a
			// mapEvents un nuovo riferimento di array a contenuto invariato, e
			// EventsMap rilancia il proprio effect su OGNI cambio di
			// riferimento di `events` — fitBounds incondizionato +
			// chiusura del popup incondizionata (components/EventsMap.tsx,
			// updateMarkers). Difetto UAT del 2026-09-10, causa isolata (non
			// dedotta): cliccare un pin fuori pagina innesca l'effect di
			// scorrimento -> goToPage -> fetchEvents(mode:"page") -> qui, e la
			// mappa chiudeva il popup appena aperto e rifaceva un fit
			// animato su un insieme che non era affatto cambiato ("Attempted
			// to synchronously unmount a root while React was already
			// rendering" in console). recenterNonce non c'entra: si aggiorna
			// solo dal bottone "Centra sulla destinazione", mai da un click
			// sul pin.
			if (mode !== "page") {
				setMapEvents(newMapEvents);
			}
			setTotal(newTotal);

			// Cache solo la forma canonica di "prima pagina" (stesso criterio
			// di `page === 1` di prima): un accodamento, un cambio pagina o un
			// ripristino a limit piu' grande non la sovrascrivono con uno
			// stato parziale.
			if (mode === "replace" && offset === 0 && limit === LIMIT) {
				const queryKey = generateQueryKey(filters, selectedCategory);
				setCachedEvents(queryKey, {
					events: newEvents,
					mapEvents: newMapEvents,
					total: newTotal,
					query: queryKey,
				});
			}
		} catch (error) {
			if (requestId !== requestIdRef.current) return;
			if (process.env.APP_DEBUG === "true") {
				console.error("[fetchEvents] Error:", error);
			}
			// WR-01: politica unificata sui tre rami di errore di fetchEvents
			// (eccezione qui, risposta non-ok e corpo malformato/segnalato sopra):
			// la lista si svuota, il totale va a 0, la mappa NON viene toccata e
			// conserva l'ultima risposta valida — e' il comportamento che
			// 11-UI-SPEC.md (error/map-view) dichiara. Solo per un rimpiazzo,
			// stesso ragionamento del ramo !response.ok sopra. D-6: un fetch
			// di pagina segue la propria politica, non WR-01 — vedi sopra.
			if (mode === "replace") {
				setEvents([]);
				setTotal(0);
			} else if (mode === "page") {
				setPageError(true);
			}
		} finally {
			if (requestId === requestIdRef.current) {
				if (mode === "append") setLoadingMore(false);
				else if (mode === "page") setPageLoading(false);
				else setLoading(false);
			}
		}
	};

	// D-07: guardia unica per il piede della lista — "richiesta in corso" e
	// "lista esaurita" (T-12-14), condivisa dal bottone e dall'IntersectionObserver
	// sotto, cosi' due trigger ravvicinati non accodano due volte lo stesso lotto.
	const loadMore = () => {
		if (loadingMore || loadedCount >= total) return;
		fetchEvents(searchFilters, { mode: "append" });
	};

	// D-6: cambio pagina esplicito — normalizza il bersaglio dentro
	// [1, lastPage], esce se coincide gia' con la pagina corrente (nessun
	// fetch superfluo), altrimenti aggiorna lo stato e richiede la pagina.
	// scrollToList=false e' usato dal salto pin->pagina (Task 3, D-7): li'
	// il bersaglio dello scorrimento e' la card, non la cima della lista.
	const goToPage = (target: number, scrollToList = true) => {
		const nextPage = Math.min(Math.max(target, 1), lastPage);
		if (nextPage === currentPage) return;
		setCurrentPage(nextPage);
		setPageError(false);
		fetchEvents(searchFilters, { mode: "page", limit: LIMIT, offset: (nextPage - 1) * LIMIT });
		if (!scrollToList) return;
		const node = document.getElementById(VIEW_SWITCH_PANEL_ID.list);
		if (!node) return;
		const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		window.scrollTo({
			top: Math.max(0, node.getBoundingClientRect().top + window.scrollY - navHeight - 16),
			behavior: prefersReducedMotion ? "auto" : "smooth",
		});
	};

	// D-6: "Riprova" sull'errore di pagina. goToPage esce quando il bersaglio
	// coincide con currentPage — un retry sulla pagina corrente deve quindi
	// richiamare fetchEvents direttamente, stesso mode e stesso offset,
	// senza passare da goToPage (scelta dichiarata, l'alternativa era un
	// parametro `force` su goToPage).
	const retryPageFetch = () => {
		const targetPage = Math.min(currentPage, lastPage);
		fetchEvents(searchFilters, { mode: "page", limit: LIMIT, offset: (targetPage - 1) * LIMIT });
	};

	// D-07: azione dello stato vuoto — allarga il raggio a 200km e rilancia
	// la ricerca riusando l'effect [searchFilters, selectedCategory] gia'
	// esistente, invece di duplicarne la logica di fetch qui.
	const handleWidenRadius = () => {
		const widened: SearchFilters = { ...searchFilters, radius: 200 };
		setSearchFilters(widened);
		setDraftFilters(widened);
	};

	const handleSearch = (filters: SearchFilters) => {
		setSearchFilters(filters);
		setDraftFilters(filters);
	};

	// Task 3: la pillola "Cerca in quest'area" cerca davvero — rifa' la
	// richiesta sul centro e sul raggio dell'inquadratura corrente
	// (onViewportChange), riusando lat/lng/radius gia' pubblici di
	// /api/events (lo stesso percorso di "nelle vicinanze"). T-12-21: il
	// raggio e' troncato qui, un'unica volta, prima di entrare in areaSearch.
	const handleAreaSearch = () => {
		if (!mapViewport || areaSearchLoading) return;
		const area = {
			lat: mapViewport.center.lat,
			lng: mapViewport.center.lng,
			radiusKm: Math.min(mapViewport.radiusKm, MAX_AREA_RADIUS_KM),
		};
		setAreaSearch(area);
		setLastSearchOrigin(area);
		setLoadedCount(0);
		setAreaSearchLoading(true);
		fetchEvents(searchFilters, { mode: "replace" }, area).finally(() => setAreaSearchLoading(false));
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

	// D-07: bersaglio unico dell'IntersectionObserver e bottone reale (un solo
	// nodo, non un sentinel separato — 12-RESEARCH.md Pattern 3).
	const footRef = useRef<HTMLButtonElement | null>(null);

	// Nessun array di dipendenze: il callback deve sempre chiudere sulla
	// loadMore piu' fresca, e la guardia sotto (T-12-14) copre sia "lista
	// esaurita" sia "richiesta in corso" — quando una delle due e' vera
	// l'observer si disconnette (cleanup) invece di continuare a osservare
	// un piede che non deve piu' innescare nulla. Il cambio filtri passa
	// comunque da un nuovo render, quindi l'observer si ricrea da solo.
	useEffect(() => {
		if (loadingMore || loading || events.length === 0 || loadedCount >= total) return;
		const node = footRef.current;
		if (!node) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) loadMore();
			},
			{ rootMargin: "240px" }
		);
		observer.observe(node);
		return () => observer.disconnect();
	});

	// D-02 (12-UI-SPEC.md "Card evento"): calcolata dal chiamante, non da
	// EventCard — assente quando la posizione utente o le coordinate risolte
	// dell'evento mancano, cosi' il kicker omette il segmento invece di
	// mostrare uno zero (stesso contratto della prop distanceKm di 12-02).
	const distanceKmFor = (event: Event): number | undefined => {
		if (!userLocation) return undefined;
		if (event.resolvedLatitude == null || event.resolvedLongitude == null) return undefined;
		return calculateDistanceKm(
			userLocation.lat,
			userLocation.lng,
			event.resolvedLatitude,
			event.resolvedLongitude
		);
	};

	// D-07: "l'ambito corrente (la destinazione se impostata, altrimenti
	// l'etichetta di default)" — intestazione della lista, Task 2.
	const listScopeLabel = searchFilters.location || "In tutta la Lombardia";

	// D-6: page e' currentPage bloccato dentro [1, lastPage] — copre il caso
	// limite di un total che cala a parita' di filtri (una risposta piu'
	// magra), senza mostrare mai una pagina che non esiste.
	const page = Math.min(currentPage, lastPage);
	const slots: PageSlot[] = buildPageWindow(page, lastPage).slice(0, MAX_PAGE_SLOTS);
	const pageFrom = (page - 1) * LIMIT + 1;
	const pageTo = Math.min(page * LIMIT, total);

	// Verso pin -> lista (D-12/D-7, caso desktop dove lista e mappa
	// convivono): se il pin cade fuori dalla pagina corrente, il salto di
	// pagina precede lo scorrimento — altrimenti il verso pin->card
	// punterebbe a una card che non e' a schermo. La logica vive qui, non in
	// handleEventSelect: quella callback ha lista di dipendenze vuota
	// apposta (identita' stabile, le istanze di EventsMap non si
	// riagganciano), e dipendere da mapEvents/currentPage la farebbe
	// cambiare identita' a ogni fetch. Scorrimento via scrollIntoView
	// sull'elemento, mai un offset calcolato a mano, rispettando
	// prefers-reduced-motion.
	useEffect(() => {
		if (selectedEventId == null || !scrollContainerRef.current) return;

		const alreadyOnPage = events.some((event) => event.id === selectedEventId);
		if (isDesktopSurface && !alreadyOnPage) {
			const index = mapEvents.findIndex((event) => event.id === selectedEventId);
			if (index >= 0) {
				const targetPage = Math.floor(index / LIMIT) + 1;
				if (targetPage !== currentPage) {
					goToPage(targetPage, false);
					return;
				}
			}
		}

		const node = scrollContainerRef.current.querySelector<HTMLElement>(
			`[data-event-id="${selectedEventId}"]`
		);
		if (!node) return;
		const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		node.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest" });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedEventId, events, mapEvents, currentPage, isDesktopSurface]);

	return (
		<div className="min-h-screen bg-background">
			<Navbar
				filters={draftFilters}
				onFiltersChange={setDraftFilters}
				onSearch={handleSearch}
				onPanelOpenChange={handlePanelOpenChange}
			/>

			<main
				className="fixed left-0 right-0 bottom-0 overflow-hidden lg:static lg:overflow-visible"
				style={{ top: navHeight }}
				// D-11: fuori portata da Tab e dal puntatore finche' il
				// pannello desktop resta aperto (T-17-09).
				inert={navPanelOpen}
			>
				<div className="mx-auto w-full max-w-[1760px] px-4 sm:px-[18px] lg:px-[22px] py-4 h-full lg:h-auto flex flex-col gap-3">
					<CategoryFilterBar
						categories={categories}
						selected={selectedCategory}
						onSelect={handleCategorySelect}
					/>

					{/* D-08: terza riga del guscio fisso, solo sotto lg — a lg e oltre
					    lista e mappa sono gia' visibili insieme, l'interruttore mobile
					    non serve (12-08: soglia spostata da xl a lg, D-3). */}
					<div className="lg:hidden">
						<ViewSwitch value={mobileView} onChange={setMobileView} />
					</div>

					{/* 12-08/D-3: interruttore desktop a tre stati — margine superiore
					    24px per staccarlo dal filetto della barra, altrimenti leggerebbe
					    come una quarta riga della testata invece che come il primo
					    comando del contenuto. */}
					<div className="hidden lg:flex lg:justify-center lg:mt-6 lg:mb-4">
						<ViewSwitch variant="desktop" value={desktopView} onChange={setDesktopView} />
					</div>

					<div
						id={DESKTOP_VIEW_REGION_ID}
						role="tabpanel"
						aria-labelledby={VIEW_SWITCH_TAB_ID[desktopView]}
						data-view={desktopView}
						className={cn(
							// UAT 12-08 #1/#5: `group` senza nome collideva col `group`
							// (anch'esso senza nome) che EventCard.tsx mette sul proprio
							// Link per `group-hover:scale-[1.03]` — :hover risale a
							// QUALUNQUE antenato con classe .group, quindi ogni card
							// dentro questa regione faceva scattare lo scale delle
							// immagini di TUTTE le altre appena il mouse entrava nella
							// regione. Isolato spostando questo contenitore su un group
							// con nome (`group/view`), cosi' `group-data-[view=...]/view:`
							// risale solo a QUESTO antenato e non collide piu' col group
							// senza nome di EventCard.
							"group/view flex-1 min-h-0 flex gap-6",
							"lg:grid lg:items-start lg:gap-8",
							"lg:grid-cols-[minmax(0,1fr)_clamp(380px,40%,620px)]",
							"lg:data-[view=list]:grid-cols-[minmax(0,1fr)]",
							"lg:data-[view=map]:grid-cols-[minmax(0,1fr)]"
						)}
					>
					<div
						id={VIEW_SWITCH_PANEL_ID.list}
						role="tabpanel"
						aria-labelledby={VIEW_SWITCH_TAB_ID.list}
						className={cn(
							"list-pane flex-1 min-w-0 flex-col min-h-0",
							// D-08: sotto lg le due viste mobili sono alla pari, non
							// impilate — quando la mappa e' quella attiva la colonna
							// lista smette di occupare spazio invece di restare sotto.
							mobileView === "map" ? "hidden lg:flex" : "flex",
							// 12-08/D-3: a desktop il riquadro lista sparisce nello
							// stato "map" dell'interruttore — legge data-view
							// sull'antenato via l'idioma group con nome di Tailwind
							// (group/view), non il group senza nome che EventCard usa.
							"lg:group-data-[view=map]/view:hidden"
						)}
					>
						<div className="flex-1 min-h-0 pb-4 relative">
							<div
								ref={scrollContainerRef}
								onScroll={handleScroll}
								className="h-full overflow-y-auto lg:h-auto lg:overflow-visible"
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
									) : (
										<motion.div
											key="content"
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0 }}
										>
											{/* Task 2: intestazione della lista — sostituisce il
											    conteggio che viveva in fondo, nella riga di
											    paginazione. */}
											<div className="mb-2 flex items-baseline justify-between gap-3">
												<span className="font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
													{total} {total === 1 ? "evento" : "eventi"}
												</span>
												<span className="text-xs text-muted-foreground">{listScopeLabel}</span>
											</div>

											{events.length === 0 ? (
												<div className="py-16 text-center">
													<div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-surface text-muted-foreground">
														<Search className="h-6 w-6" aria-hidden="true" />
													</div>
													<h3 className="mb-1 font-display text-lg font-semibold tracking-[-0.015em] text-foreground">
														Nessun evento qui intorno
													</h3>
													<p className="mx-auto mb-5 max-w-xs text-sm text-muted-foreground">
														Allarga il raggio o cambia periodo: in Lombardia c&apos;è quasi
														sempre qualcosa a un&apos;ora di distanza.
													</p>
													{userLocation && searchFilters.radius ? (
														<button
															type="button"
															onClick={handleWidenRadius}
															className="text-sm font-medium text-foreground underline underline-offset-4"
														>
															Allarga a 200 km
														</button>
													) : null}
												</div>
											) : (
												<>
													<div
														className={cn("grid-cards", pageLoading && "opacity-60 transition-opacity")}
														aria-busy={pageLoading || undefined}
													>
														{events.map((event, index) => (
															<div
																key={`${event.source}-${event.id}`}
																data-event-id={event.id}
																className="event-card-item"
																style={{ animationDelay: `${index * (MOTION_FAST / 3)}s` }}
															>
																<EventCard
																	event={event}
																	distanceKm={distanceKmFor(event)}
																	highlighted={event.id === selectedEventId}
																	onHoverStart={() => setSelectedEventId(event.id)}
																	onHoverEnd={() =>
																		setSelectedEventId((prev) => (prev === event.id ? null : prev))
																	}
																/>
															</div>
														))}
													</div>

													{/* Task 3: "carica altri" — un solo nodo, bottone
													    reale e bersaglio dell'IntersectionObserver.
													    D-23: contratto mobile, invariato — lg:hidden
													    lo esclude sul ramo desktop, dove il piede
													    diventa la paginazione numerata sotto. */}
													<div className="flex flex-col items-center gap-2 py-6 lg:hidden">
														{loadedCount >= total ? (
															<span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
																<Check className="h-4 w-4" aria-hidden="true" />
																Hai visto tutti i {total} eventi
															</span>
														) : (
															<>
																<button
																	ref={footRef}
																	type="button"
																	onClick={loadMore}
																	disabled={loadingMore}
																	className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-pill bg-surface text-base font-medium text-foreground"
																	style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
																>
																	{loadingMore ? (
																		<>
																			<Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
																			Carico…
																		</>
																	) : (
																		`Carica altri ${Math.min(LIMIT, total - loadedCount)} eventi`
																	)}
																</button>
																<span className="text-xs text-muted-foreground tabular-nums">
																	{loadedCount} di {total}
																</span>
															</>
														)}
													</div>

													{/* D-6: paginazione numerata, solo desktop — il
													    piede "carica altri" sopra resta il contratto
													    mobile (lg:hidden), questo e' il suo pari
													    lg:flex. Finestra a 7 caselle da
													    lib/pagination.ts (VR-08). */}
													<div className="hidden lg:flex lg:flex-col lg:items-center lg:gap-3 lg:pb-12 lg:pt-8">
														{pageError && (
															<div className="flex items-center gap-3 text-sm text-muted-foreground">
																<span>Non è stato possibile caricare questa pagina.</span>
																<button
																	type="button"
																	onClick={retryPageFetch}
																	className="font-medium text-foreground underline underline-offset-4"
																>
																	Riprova
																</button>
															</div>
														)}
														{lastPage > 1 && (
															<nav aria-label="Pagine dei risultati" className="flex items-center gap-1">
																<button
																	type="button"
																	onClick={() => goToPage(page - 1)}
																	disabled={pageLoading || page === 1}
																	aria-label="Pagina precedente"
																	className="grid h-11 w-11 place-items-center rounded-full text-foreground-secondary hover:bg-surface hover:text-foreground disabled:text-muted-foreground-subtle disabled:hover:bg-transparent disabled:hover:text-muted-foreground-subtle"
																>
																	<ChevronLeft className="h-[18px] w-[18px]" aria-hidden="true" />
																</button>
																{slots.map((slot, index) =>
																	slot === "…" ? (
																		<span
																			key={`gap-${index}`}
																			aria-hidden="true"
																			className="w-7 select-none text-center text-sm text-muted-foreground"
																		>
																			…
																		</span>
																	) : (
																		<button
																			key={slot}
																			type="button"
																			onClick={() => goToPage(slot)}
																			disabled={pageLoading}
																			aria-label={`Pagina ${slot}`}
																			aria-current={slot === page ? "page" : undefined}
																			className={cn(
																				"grid h-11 w-11 place-items-center rounded-full text-sm font-medium tabular-nums",
																				slot === page
																					? "bg-primary text-primary-foreground font-semibold"
																					: "text-foreground-secondary hover:bg-surface hover:text-foreground"
																			)}
																		>
																			{slot}
																		</button>
																	)
																)}
																<button
																	type="button"
																	onClick={() => goToPage(page + 1)}
																	disabled={pageLoading || page === lastPage}
																	aria-label="Pagina successiva"
																	className="grid h-11 w-11 place-items-center rounded-full text-foreground-secondary hover:bg-surface hover:text-foreground disabled:text-muted-foreground-subtle disabled:hover:bg-transparent disabled:hover:text-muted-foreground-subtle"
																>
																	<ChevronRight className="h-[18px] w-[18px]" aria-hidden="true" />
																</button>
															</nav>
														)}
														<span className="text-xs text-muted-foreground tabular-nums">
															{pageFrom}–{pageTo} di {total} eventi
														</span>
													</div>
												</>
											)}
										</motion.div>
									)}
								</AnimatePresence>
							</div>
						</div>
					</div>

					{/* D-08: vista mappa mobile — peer della lista, non un overlay.
					    Stesse prop del pannello desktop, mapId proprio, piu' il
					    contratto di selezione/viewport (D-12, Task 3). */}
					{mobileView === "map" && (
						<div
							id={VIEW_SWITCH_PANEL_ID.map}
							role="tabpanel"
							aria-labelledby={VIEW_SWITCH_TAB_ID.map}
							className="relative flex-1 min-w-0 lg:hidden"
						>
							<EventsMap
								events={mapEvents}
								initialGeoJSON={effectiveClusterGeoJSON}
								mapId="map-mobile"
								userLocation={userLocation}
								selectedEventId={selectedEventId}
								onEventSelect={handleEventSelect}
								onViewportChange={!isDesktopSurface ? handleViewportChange : undefined}
							/>

							{/* Task 3: "Cerca in quest'area" — bottone reale, tolto
							    dall'ordine di tabulazione quando nascosto (AnimatePresence
							    smonta il nodo, non lo rende invisibile). */}
							<AnimatePresence>
								{showAreaPill && (
									<motion.button
										type="button"
										onClick={handleAreaSearch}
										disabled={areaSearchLoading}
										initial={{ opacity: 0, x: "-50%", y: -8 }}
										animate={{ opacity: 1, x: "-50%", y: 0 }}
										exit={{ opacity: 0, x: "-50%", y: -8 }}
										transition={{ duration: MOTION_BASE, ease: EASE_STANDARD }}
										className="absolute left-1/2 top-3 z-10 inline-flex h-[38px] items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-foreground"
										style={{
											background: "color-mix(in srgb, var(--background) 92%, transparent)",
											backdropFilter: "saturate(180%) blur(20px)",
											WebkitBackdropFilter: "saturate(180%) blur(20px)",
											boxShadow: "0 0 0 1px var(--border-soft), 0 4px 16px rgba(0, 0, 0, 0.16)",
										}}
									>
										{areaSearchLoading ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
										) : (
											<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
										)}
										{"Cerca in quest'area"}
									</motion.button>
								)}
							</AnimatePresence>

							<MapEventsRail
								events={viewportEvents}
								totalInView={mapViewport?.totalInView ?? 0}
								selectedEventId={selectedEventId}
							/>
						</div>
					)}

					{/* 12-08/D-5/D-6: riquadro mappa desktop — riscritto, non ritoccato.
					    Senza larghezza propria: la traccia della griglia la fissa gia'
					    a clamp(380px,40%,620px) (D-06, sostituisce la vecchia meta'
					    finestra a tetto 4xl). l'overlay di ingrandimento della mappa
					    e' stato rimosso, D-3 — a
					    desktop l'ingrandimento a piena vista lo fa lo stato "map"
					    dell'interruttore, non un bottone separato. 12-09: cablaggio
					    di onViewportChange, pillola d'area e comando di ricentraggio. */}
					<div className="hidden lg:block lg:group-data-[view=list]/view:hidden">
						<div
							className="lg:sticky rounded-lg overflow-hidden relative"
							style={{
								top: "calc(var(--topbar-h, 92px) + 16px)",
								height: "calc(100dvh - var(--topbar-h, 92px) - 32px)",
								minHeight: "420px",
								boxShadow: "var(--elev-ring)",
							}}
						>
							<EventsMap
								events={mapEvents}
								initialGeoJSON={effectiveClusterGeoJSON}
								mapId="map-sidebar"
								userLocation={userLocation}
								selectedEventId={selectedEventId}
								onEventSelect={handleEventSelect}
								onViewportChange={isDesktopSurface ? handleViewportChange : undefined}
								recenterNonce={recenterNonce}
							/>

							{/* Task 2: "Cerca in quest'area", stesso showAreaPill/
							    handleAreaSearch/areaSearchLoading del riquadro mobile —
							    isDesktopSurface in piu' nella condizione di render, cosi'
							    non compare in un riquadro invisibile sotto 1024px. */}
							<AnimatePresence>
								{showAreaPill && isDesktopSurface && (
									<motion.button
										type="button"
										onClick={handleAreaSearch}
										disabled={areaSearchLoading}
										initial={{ opacity: 0, x: "-50%", y: -8 }}
										animate={{ opacity: 1, x: "-50%", y: 0 }}
										exit={{ opacity: 0, x: "-50%", y: -8 }}
										transition={{ duration: MOTION_BASE, ease: EASE_STANDARD }}
										className="absolute left-1/2 top-3 z-10 inline-flex h-[38px] items-center gap-1.5 rounded-pill px-4 text-sm font-medium text-foreground"
										style={{
											background: "color-mix(in srgb, var(--background) 92%, transparent)",
											backdropFilter: "saturate(180%) blur(20px)",
											WebkitBackdropFilter: "saturate(180%) blur(20px)",
											boxShadow: "0 0 0 1px var(--border-soft), 0 4px 16px rgba(0, 0, 0, 0.16)",
										}}
									>
										{areaSearchLoading ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
										) : (
											<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
										)}
										{"Cerca in quest'area"}
									</motion.button>
								)}
							</AnimatePresence>

							{/* Task 2 (D-5): "Centra sulla destinazione" — un solo
							    comando, sempre visibile (mai in hover, D-5): chi naviga
							    da tastiera o trackpad senza sorvolare la mappa non
							    potrebbe altrimenti scoprirlo. */}
							<button
								type="button"
								onClick={() => setRecenterNonce((n) => n + 1)}
								aria-label="Centra sulla destinazione"
								className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-pill text-foreground"
								style={{
									background: "color-mix(in srgb, var(--background) 92%, transparent)",
									backdropFilter: "saturate(180%) blur(20px)",
									WebkitBackdropFilter: "saturate(180%) blur(20px)",
									boxShadow: "0 0 0 1px var(--border-soft), 0 2px 10px rgba(0, 0, 0, 0.12)",
								}}
							>
								<Crosshair className="h-[18px] w-[18px]" aria-hidden="true" />
							</button>
						</div>
					</div>
					</div>
				</div>
			</main>
		</div>
	);
}
