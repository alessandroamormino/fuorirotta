"use client";
// useState locale per il nodo DOM del contenitore risultati "Dove" (D-19) e
// per il suo contatore, piu' gli onClick dei campi e le animazioni
// framer-motion (motion.div/motion.button); chiama inoltre l'hook condiviso
// useNavbarSearch, che possiede lo stato dei filtri (D-12).

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X } from "lucide-react";
import { it } from "date-fns/locale";
import { format, isSameDay } from "date-fns";
import Link from "next/link";
import Image from "next/image";
import DestinationField from "@/components/navbar/DestinationField";
import MobileSearchOverlay from "@/components/navbar/MobileSearchOverlay";
import SearchbarTrigger from "@/components/navbar/SearchbarTrigger";
import DesktopSearchDropdown from "@/components/navbar/DesktopSearchDropdown";
import * as Popover from "@/components/ui/Popover";
import ThemeToggle from "@/components/ui/ThemeToggle";
import type { SearchFilters } from "@/lib/types";
import { useNavbarSearch } from "@/lib/hooks/useNavbarSearch";
import { MOTION_FAST } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface NavbarProps {
	// D-07: Navbar e' un componente controllato — riceve i filtri come valore
	// e li restituisce via callback, senza possederne una copia.
	filters: SearchFilters;
	onFiltersChange: (filters: SearchFilters) => void;
	onSearch: (filters: SearchFilters) => void;
	// D-11 (Fase 17, piano 04): segnala al genitore quando il pannello
	// DESKTOP (non l'overlay mobile, che ha gia' il proprio trap Radix)
	// passa da aperto a chiuso o viceversa, cosi' il genitore puo' rendere
	// inerte il resto della pagina finche' resta aperto (T-17-09).
	onPanelOpenChange?: (open: boolean) => void;
	// Estensione di scopo desktop (12-10, decisione utente 2026-09-08): sulla
	// pagina di dettaglio evento, da 1024px in su, la zona di ricerca si
	// riveste da un link-pillola "Torna ai risultati" invece della barra
	// interattiva — la macchina a stati della Fase 17 resta montata invariata
	// sotto 1024px e non viene mai ridisegnata, solo nascosta da 1024px in su
	// quando questa prop e' passata. Assente (home): comportamento invariato.
	searchBackHref?: string;
}

export default function Navbar({
	filters: controlledFilters,
	onFiltersChange,
	onSearch,
	onPanelOpenChange,
	searchBackHref,
}: NavbarProps) {
	const { filters, setFilters, search, radius, panels, destinations } =
		useNavbarSearch({ filters: controlledFilters, onFiltersChange, onSearch });
	const { activeField, setActiveField, setMobileDestExpanded, setMobileWhenOpen } =
		panels;
	const hasActiveFilters = search.hasActiveFilters;

	// UAT 2026-09-10 (uniformare i colori navbar/toggle): stesso pattern di
	// ViewSwitch.tsx per il campo attivo Dove/Date (--background in chiaro,
	// --border in scuro — --background scuro e' nero puro, invisibile come
	// "pillola sollevata" su --surface scuro altrettanto vicino al nero).
	// Letto dal DOM, non da `dark:` di Tailwind (risolverebbe su
	// prefers-color-scheme, non sulla classe .dark che l'utente sceglie a
	// mano) — stesso pattern di ThemeToggle.tsx/ViewSwitch.tsx.
	const [isDark, setIsDark] = useState(false);
	useEffect(() => {
		// Stesso pattern letto dal DOM di ViewSwitch.tsx/ThemeToggle.tsx, dove
		// la stessa regola NON scatta. Perche' scatti qui e non li' non e'
		// stato verificato: non dedurlo dal sorgente, misuralo, se un giorno
		// serve saperlo davvero.
		// Perche' un effect e non uno stato iniziale pigro: il server non ha
		// document, e leggere il tema durante il render romperebbe
		// l'idratazione. Questo e' il motivo accertato della soppressione.
		// Nessuna cascata reale: isDark non e' letto da nessun altro effect
		// di questo file, solo da JSX (activeFieldBgClass).
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setIsDark(document.documentElement.classList.contains("dark"));
		const handleThemeChange = (event: Event) => {
			const detail = (event as CustomEvent<{ isDark: boolean }>).detail;
			setIsDark(!!detail?.isDark);
		};
		window.addEventListener("theme-change", handleThemeChange);
		return () => window.removeEventListener("theme-change", handleThemeChange);
	}, []);
	const activeFieldBgClass = isDark ? "bg-border" : "bg-background";

	// Il dropdown desktop e' aperto per ogni activeField tranne il caso
	// mobile_search (che apre invece l'overlay fullscreen sopra) e null.
	const dropdownOpen = activeField !== null && activeField !== "mobile_search";

	// Stato A della macchina a stati (17-UI-SPEC.md): la barra desktop e'
	// collassata in pillola solo quando nessun filtro e' attivo E il pannello
	// e' chiuso — un solo predicato derivato da due booleani gia' esistenti,
	// non un nuovo stato che potrebbe oscillare per conto proprio (T-17-07).
	const desktopCollapsed = !hasActiveFilters && !dropdownOpen;

	// Larghezza del contenitore accoppiata a desktopCollapsed: piena quando
	// espanso, auto e centrata (tetto max-w-md) quando collassato — solo da
	// `sm` in su, perche' sotto `sm` la barra resta a piena larghezza come
	// oggi (il mobile non cambia, 17-UI-SPEC.md "Transizione A ↔ B").
	const searchbarWidthClass = desktopCollapsed
		? "w-full sm:w-auto sm:max-w-md sm:mx-auto"
		: "w-full";

	// D-19 (corretta il 2026-08-20, dopo la regressione di 7852a38): il
	// campo Dove desktop vive in questa barra collassata, il contenitore
	// dei suoi risultati vive nel pannello aperto da DesktopSearchDropdown
	// — due componenti fratelli, non genitore/figlio. Questo stato porta
	// il nodo DOM del contenitore (e il conteggio dei risultati) dall'uno
	// all'altro, cosi' DestinationField puo' teletrasportare (createPortal)
	// la sua lista dentro l'unico contenitore visibile invece di aprire un
	// popover proprio sopra di esso.
	const [whereResultsContainer, setWhereResultsContainer] =
		useState<HTMLDivElement | null>(null);
	const [whereResultsCount, setWhereResultsCount] = useState(0);

	// D-11 (Fase 17, piano 04): confinamento del focus/puntatore e ritorno
	// del focus alla chiusura. Il pannello copre "barra + pannello", non
	// solo il pannello (il campo Dove vive nella barra, il dropdown e'
	// portalato sul body): per questo si rende inerte cio' che sta fuori
	// (onPanelOpenChange -> HomeClient/EventDetailClient) invece di cercare
	// un focus trap che li comprenda entrambi (Popover.Root modal valutata
	// e scartata, vedi 17-04-PLAN.md).
	const whereInputRef = useRef<HTMLInputElement>(null);
	const whenFieldRef = useRef<HTMLDivElement>(null);
	const pillButtonRef = useRef<HTMLButtonElement>(null);
	// activeField torna a null non appena il pannello si chiude: per sapere
	// se restituire il focus a "Dove" o "Quando" bisogna ricordare l'ultimo
	// valore non nullo PRIMA che sparisca.
	const lastActiveFieldRef = useRef<"where" | "when" | null>(null);
	// Distingue "il pannello era aperto e si e' appena chiuso" da "la pagina
	// si e' appena caricata": senza, il primo render ruberebbe il focus alla
	// pillola.
	const wasOpenRef = useRef(false);

	// 12-08/D-2: pubblica l'altezza REALE della barra (le chip categoria vanno
	// a capo e la cambiano) su --topbar-h, cosi' il riquadro mappa/dettaglio
	// desktop puo' calcolare il proprio top/height sticky. offsetHeight, non
	// getBoundingClientRect: la lezione della Fase 17 (31a335a) e' che
	// getBoundingClientRect restituisce rettangoli contaminati dalle transform
	// di framer, mentre offsetHeight le ignora. Stesso pattern del mock
	// (desktop-eventi.html:249-251, syncTopbarHeight).
	const navRef = useRef<HTMLElement>(null);
	useEffect(() => {
		const node = navRef.current;
		if (!node) return;
		const syncTopbarHeight = () => {
			document.documentElement.style.setProperty("--topbar-h", node.offsetHeight + "px");
		};
		syncTopbarHeight();
		const ro = new ResizeObserver(syncTopbarHeight);
		ro.observe(node);
		return () => ro.disconnect();
	}, []);

	// Segnala al genitore lo stato del pannello desktop, con cleanup che
	// segnala `false` allo smontaggio (T-17-09): un pannello che resta
	// "aperto" oltre lo smontaggio lascerebbe la pagina inerte per sempre.
	useEffect(() => {
		onPanelOpenChange?.(dropdownOpen);
		return () => {
			onPanelOpenChange?.(false);
		};
	}, [dropdownOpen, onPanelOpenChange]);

	useEffect(() => {
		if (activeField === "where" || activeField === "when") {
			lastActiveFieldRef.current = activeField;
		}
	}, [activeField]);

	// Focus iniziale sul campo Dove quando il pannello si apre su "where"
	// (pillola cliccata, o click diretto sul campo Dove). Non tocca il
	// focus quando si apre su "Quando": il click lo gestisce gia' da solo,
	// e spostarlo su Dove sarebbe proprio il difetto che D-11 vuole evitare.
	useEffect(() => {
		if (activeField === "where") {
			whereInputRef.current?.focus();
		}
	}, [activeField]);

	// Alla chiusura del pannello (Escape, click fuori, submit, Cancella) il
	// focus torna alla pillola (stato A, D-01) o al campo che era attivo
	// (stato C) — mai al `body` (D-03, D-11).
	useEffect(() => {
		if (dropdownOpen) {
			wasOpenRef.current = true;
			return;
		}
		if (!wasOpenRef.current) return;
		wasOpenRef.current = false;

		if (hasActiveFilters) {
			if (lastActiveFieldRef.current === "when") {
				whenFieldRef.current?.focus();
			} else {
				whereInputRef.current?.focus();
			}
		} else {
			pillButtonRef.current?.focus();
		}
	}, [dropdownOpen, hasActiveFilters]);

	return (
		<>
			<MobileSearchOverlay
				open={activeField === "mobile_search"}
				onOpenChange={(open) => {
					if (!open) setActiveField(null);
				}}
				filters={filters}
				setFilters={setFilters}
				search={search}
				radius={radius}
				panels={panels}
				destinations={destinations}
			/>

			{/* ── NAVBAR ── */}
			<nav
				id="main-navbar"
				ref={navRef}
				className="fixed top-2 left-0 right-0 z-50 px-4 py-4 sm:px-[18px] lg:sticky lg:top-0 lg:z-[60] lg:px-[22px] lg:py-3 topbar-desktop"
			>
				<div className="mx-auto w-full max-w-[1760px]">
					<div className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:gap-4 lg:gap-6 lg:grid lg:grid-cols-[1fr_minmax(0,720px)_1fr] lg:items-center lg:gap-4">
						{/* Logo — in flusso (D-10): non piu' absolute, fratello flex-none
						    della zona di ricerca e del toggle. */}
						<div className="flex-none lg:justify-self-start">
							<Link href="/">
								<motion.div
									className="flex items-center space-x-3 cursor-pointer"
									whileHover={{ scale: 1.05 }}
									whileTap={{ scale: 0.95 }}
								>
									<Image
										src="/images/logo.svg"
										alt="Fuorirotta Logo"
										width={40}
										height={40}
										className="w-8 h-8 sm:w-10 sm:h-10"
										loading="eager"
										priority
									/>
									{/* D-19 (piano 07): il wordmark, prima visibile solo da xl,
									    diventa visibile anche sotto sm (topbar del prototipo) —
									    invariato fra sm e xl. 12-08/D-2: la soglia desktop a cui
									    ricompare non e' piu' xl (1280px) ma il breakpoint
									    arbitrario 900px del mock — sotto, resta il solo logo
									    icona. */}
									<span className="block sm:hidden min-[900px]:block text-2xl font-bold text-primary">
										Fuorirotta
									</span>
								</motion.div>
							</Link>
						</div>

						{/* Search Bar — flex-1 min-w-0 (D-10): cede spazio per prima,
						    non invade quello del logo/toggle a larghezze intermedie.
						    D-19 (piano 07): l'intero contenitore (Popover + morph a
						    molla) e' nascosto sotto sm — la pillola mobile ha ora la
						    propria chrome in un blocco fratello piu' sotto, invece di
						    ereditarla da qui. Sopra sm il markup e il comportamento
						    non cambiano. lg:hidden SOLO quando searchBackHref e'
						    passata (12-10): sotto 1024px questa barra resta la macchina
						    a stati della Fase 17, invariata anche sul dettaglio. */}
						<div
							className={cn(
								"hidden sm:flex sm:flex-1 sm:min-w-0 sm:justify-center",
								searchBackHref && "lg:hidden"
							)}
						>
						<div className="w-full max-w-3xl relative">
							<Popover.Root
								open={dropdownOpen}
								onOpenChange={(open) => {
									if (!open) setActiveField(null);
								}}
							>
								<Popover.Anchor asChild>
									{/* data-navbar-searchbar: marcatore letto da onInteractOutside
									    in DesktopSearchDropdown. La barra non conta come "fuori",
									    cosi' passare da "Dove" a "Quando" cambia campo con un solo
									    click e senza smontare il pannello. `layout` + la stessa
									    transizione a molla del ring dell'anello attivo qui sotto
									    anima il morph pillola/barra (D-04, 17-UI-SPEC.md
									    "Transizione A e B") — non un secondo identificativo di
									    layout condiviso, che animerebbe fra l'anello e la barra
									    invece che la forma.

									    NON rimettere `transition-all` qui (lag misurato il
									    2026-08-28): con `transition-property: all` a 150ms il CSS
									    re-interpola anche `transform` e `width`, cioe' proprio le
									    proprieta' che `layout` riscrive a ogni frame — il browser
									    insegue un bersaglio gia' spostato, e `width` viene animata
									    due volte (CSS + scale di framer). L'anello attivo qui sotto
									    e' fluido proprio perche' ha transition-duration 0s.
									    L'elenco esplicito tiene il fade di hover/tema e lascia
									    transform e width alla sola framer-motion. */}
									<motion.div
										data-navbar-searchbar
										layout
										// damping 45, non 40 come i due activeRing: deviazione
										// deliberata da D-04 approvata dall'utente il 2026-08-28.
										// Con massa 1 lo smorzamento critico e' 2*sqrt(500) ~ 44.7:
										// a 40 la molla e' sotto-smorzata e supera il bersaglio.
										// Sull'anello l'overshoot e' una traslazione orizzontale
										// breve e legge come vivacita'; qui il morph cambia anche
										// l'altezza (52->66px di contenuto, nav 86->100px) e lo
										// stesso rimbalzo diventa un cenno verticale della barra.
										// Stessa famiglia (stesso type, stessa stiffness), solo
										// portata a critica.
										transition={{
											type: "spring",
											stiffness: 500,
											damping: 45,
										}}
										// borderRadius inline, non la classe rounded-full: durante il morph
										// il contenitore e' scalato in modo non uniforme (misurato:
										// 0.583 in X e 0.794 in Y al primo frame), e un raggio
										// dichiarato in CSS viene deformato in calotte ellittiche.
										// framer corregge il raggio frame per frame solo se e' lui a
										// controllarlo come stile inline.
										style={{ borderRadius: 9999 }}
										// UAT 2026-09-10: traccia GRIGIA a riposo (bg-surface piena,
										// non piu' /90) — stessa regola del contenitore di
										// ViewSwitch.tsx ("grigio a riposo, bianco quando attivo").
										// Divergenza dichiarata dal mock: assets/desktop.css da'
										// a .searchbar bg:var(--bg) bianco — qui si uniforma al
										// toggle invece di seguirlo (decisione utente).
										className={`flex items-center bg-surface backdrop-blur-md border border-surface/40 shadow-lg hover:shadow-xl transition-[color,background-color,border-color,box-shadow] px-2 relative ${searchbarWidthClass}`}
									>
										{/* Desktop: pillola (stato A) oppure barra a due campi
										    (stati B/C/D) — un solo cross-fade di opacity fra i due,
										    nessuno slide/scale aggiuntivo (17-UI-SPEC.md). */}
										{/* Cella unica condivisa: pillola e barra si
										    sovrappongono invece di essere due voci flex che si
										    dividono lo spazio. Da fratelli flex entrambi `flex-1`
										    il cross-fade dello spec (17-UI-SPEC.md:85, solo
										    opacity) non era realizzabile — durante i 150ms di
										    sovrapposizione i due si spartivano la larghezza
										    (misurato: pillola 430px + barra 375px in un
										    contenitore da 448), cosi' la barra nasceva stretta e
										    si distendeva, e la pillola restava visibile a fianco
										    invece che sotto. */}
										{/* min-h: pillola e barra hanno altezze intrinseche diverse
										    (52px contro 66px, misurate), e senza un'altezza comune il
										    morph muove anche in verticale — la nav passava da 86 a
										    100px crescendo verso il basso a ogni apertura. Fissata al
										    valore del ramo piu' alto (la barra: etichetta + valore su
										    due righe con py-3), cosi' il morph resta di sola larghezza.
										    Se cambia il padding o la scala tipografica dei campi, questo
										    numero va rimisurato insieme a loro.
										    Deviazione approvata dall'utente il 2026-08-28: la pillola a
										    riposo e' piu' alta di 14px rispetto allo stato A approvato
										    in UAT. */}
										<div className="hidden sm:grid sm:min-h-[66px] flex-1 min-w-0">
										<AnimatePresence initial={false}>
											{desktopCollapsed ? (
												<motion.div
													key="pill"
													// Correzione di scala: il contenitore anima la
													// larghezza con una scaleX, che schiaccerebbe il
													// contenuto per poi distenderlo. Marcare il figlio
													// con `layout` fa applicare a framer la scala
													// inversa a ogni frame. Isolata solo ora: finche' i
													// due rami erano fratelli flex che si dividevano lo
													// spazio, l'artefatto dominante era quello.
													layout
													initial={{ opacity: 0 }}
													animate={{ opacity: 1 }}
													exit={{ opacity: 0 }}
													transition={{ duration: MOTION_FAST }}
													className="[grid-area:1/1] flex items-center justify-center min-w-0"
												>
													{/* Stato A: hasActiveFilters e' falso per definizione
													    (desktopCollapsed lo richiede), quindi questo
													    montaggio rende sempre il ramo "senza filtri". */}
													<SearchbarTrigger
														variant="desktop"
														ref={pillButtonRef}
														className="w-full"
														hasActiveFilters={hasActiveFilters}
														location={filters.location}
														dateFrom={filters.dateFrom}
														dateTo={filters.dateTo}
														onOpen={() => setActiveField("where")}
														onClear={search.clear}
													/>
												</motion.div>
											) : (
												<motion.div
													key="bar"
													// Stessa correzione di scala del ramo "pill".
													layout
													initial={{ opacity: 0 }}
													animate={{ opacity: 1 }}
													exit={{ opacity: 0 }}
													transition={{ duration: MOTION_FAST }}
													className="[grid-area:1/1] flex items-center min-w-0"
												>
													{/* Desktop: Where Field */}
													<div className="hidden sm:block flex-1 relative">
														<div
															onClick={() => setActiveField("where")}
															className="relative z-10 px-4 sm:px-6 py-2 sm:py-3 rounded-full cursor-pointer transition-all hover:bg-surface/50"
														>
															<label className="text-[10px] sm:text-xs font-semibold text-foreground block mb-0.5">
																Dove
															</label>
															<DestinationField
																ref={whereInputRef}
																placeholder="Cerca destinazioni"
																value={search.input}
																onValueChange={search.setInput}
																onSelect={(comune) => {
																	destinations.selectComune(comune);
																	setActiveField("when");
																}}
																className={`w-full text-xs sm:text-sm outline-none bg-transparent placeholder-muted-foreground-faint ${
																	radius.isNearby
																		? "text-foreground cursor-not-allowed font-medium"
																		: "text-foreground-secondary"
																}`}
																onFocus={() => setActiveField("where")}
																readOnly={radius.isNearby}
																// D-19 (corretta il 2026-08-20): la lista arriva nel
																// pannello unificato di DesktopSearchDropdown via
																// createPortal, non in un popover proprio.
																resultsContainer={whereResultsContainer}
																onResultsChange={setWhereResultsCount}
															/>
															{search.input && (
																<button
																	type="button"
																	aria-label="Svuota il campo destinazione"
																	onClick={(e) => {
																		// stopPropagation: il div genitore ha un onClick che
																		// riapre il pannello "Dove", che riaprirebbe subito
																		// cio' che questo bottone ha appena chiuso.
																		e.stopPropagation();
																		search.setInput("");
																	}}
																	className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-muted-strong flex items-center justify-center transition-colors"
																>
																	<X className="w-3.5 h-3.5 text-muted-foreground" />
																</button>
															)}
														</div>
														{activeField === "where" && (
															<motion.div
																layoutId="activeRing"
																className={`absolute inset-x-0 top-2 bottom-2 rounded-full ${activeFieldBgClass} pointer-events-none`}
																style={!isDark ? { boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.04)" } : undefined}
																transition={{
																	type: "spring",
																	stiffness: 500,
																	damping: 40,
																}}
															/>
														)}
													</div>

													<div className="hidden sm:block w-px h-8 bg-surface/30" />

													{/* Desktop: When Field */}
													<div className="hidden sm:block flex-1 relative">
														<div
															ref={whenFieldRef}
															// D-11: -1 lo rende raggiungibile solo via .focus()
															// programmatico (ritorno del focus da Escape), non
															// aggiunge una nuova tappa a Tab — l'ordine di
															// tabulazione esistente non cambia.
															tabIndex={-1}
															onClick={() => setActiveField("when")}
															className="relative z-10 px-4 sm:px-6 py-2 sm:py-3 rounded-full cursor-pointer transition-all hover:bg-surface/50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
														>
															<label className="text-[10px] sm:text-xs font-semibold text-foreground block mb-0.5">
																Date
															</label>
															<div className="text-xs sm:text-sm text-muted-foreground-faint truncate">
																{/* Bugfix 2026-09-10 (defect 2, sito mancato dal cascade
																	di 342583a): dateFrom === dateTo per un giorno
																	singolo, senza !isSameDay qui il campo Date del
																	navbar desktop mostrava "10 set - 10 set" invece
																	di "10 set" — stesso guard di SearchbarTrigger.tsx
																	e MobileSearchOverlay.tsx, mai un secondo
																	formatter. */}
																{filters.dateFrom && filters.dateTo
																	? isSameDay(filters.dateFrom, filters.dateTo)
																		? format(filters.dateFrom, "d MMM", { locale: it })
																		: `${format(filters.dateFrom, "d MMM", { locale: it })} - ${format(filters.dateTo, "d MMM", { locale: it })}`
																	: "Aggiungi date"}
															</div>
														</div>
														{activeField === "when" && (
															<motion.div
																layoutId="activeRing"
																className={`absolute inset-x-0 top-2 bottom-2 rounded-full ${activeFieldBgClass} pointer-events-none`}
																style={!isDark ? { boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.04)" } : undefined}
																transition={{
																	type: "spring",
																	stiffness: 500,
																	damping: 40,
																}}
															/>
														)}
													</div>

													{/* Desktop: Clear & Search */}
													<div className="hidden sm:flex items-center gap-2 pr-2 pl-3">
														{hasActiveFilters && (
															<motion.button
																initial={{ opacity: 0, scale: 0.8 }}
																animate={{ opacity: 1, scale: 1 }}
																exit={{ opacity: 0, scale: 0.8 }}
																whileHover={{ scale: 1.05 }}
																whileTap={{ scale: 0.95 }}
																onClick={search.clear}
																className="px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted-strong rounded-full transition-colors"
															>
																Cancella
															</motion.button>
														)}
														<motion.button
															whileHover={{ scale: 1.05 }}
															whileTap={{ scale: 0.95 }}
															onClick={search.submit}
															className="w-12 h-12 bg-primary hover:bg-primary-hover rounded-full flex items-center justify-center transition-colors"
														>
															<Search className="w-5 h-5 text-primary-foreground" />
														</motion.button>
													</div>
												</motion.div>
											)}
										</AnimatePresence>
										</div>
									</motion.div>
								</Popover.Anchor>

								<DesktopSearchDropdown
									open={dropdownOpen}
									activeField={
										activeField === "where" || activeField === "when"
											? activeField
											: null
									}
									setActiveField={setActiveField}
									searchInput={search.input}
									radius={radius}
									destinations={destinations}
									filters={filters}
									setFilters={setFilters}
									resultsContainerRef={setWhereResultsContainer}
									resultsCount={whereResultsCount}
								/>
							</Popover.Root>
						</div>
						</div>

						{/* Pillola "Torna ai risultati" (12-10, decisione utente
						    2026-09-08): SOLO quando searchBackHref e' passata (pagina di
						    dettaglio), SOLO da 1024px in su — riveste la stessa zona di
						    ricerca con un link, senza toccare il markup della barra
						    interattiva sopra (nascosta da lg:hidden quando questa pillola
						    e' montata). Stesso aria-label del ritorno mobile
						    (MobileDetailBar, "app/eventi/[id]/EventDetailClient.tsx") —
						    le due superfici parlano con un'unica voce. */}
						{searchBackHref && (
							<div className="hidden lg:flex lg:flex-1 lg:min-w-0 lg:justify-center">
								<Link
									href={searchBackHref}
									aria-label="Torna ai risultati"
									className="flex h-[60px] w-full max-w-[420px] items-center gap-3 rounded-full bg-background pl-6 pr-3 shadow-[inset_0_0_0_1px_var(--border)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--border-soft)]"
								>
									<Search className="h-[18px] w-[18px] flex-none text-foreground-secondary" aria-hidden="true" />
									<span className="min-w-0 flex-1 truncate text-base text-foreground-secondary">
										Torna ai risultati
									</span>
									<span className="ml-auto flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground">
										<Search className="h-[17px] w-[17px]" aria-hidden="true" />
									</span>
								</Link>
							</div>
						)}

						{/* Riga 2 mobile: pillola di ricerca a due righe con badge, a
						    piena larghezza (D-19, piano 07). order-3 la manda in fondo
						    fra i fratelli visibili sotto sm (dopo logo e toggle, che
						    restano order 0), e w-full la forza a capo su una riga
						    propria dentro il contenitore flex-wrap. Nascosta a sm+, dove
						    la zona di ricerca desktop sopra prende il suo posto. */}
						<div className="order-3 w-full sm:hidden">
							<SearchbarTrigger
								variant="mobile"
								hasActiveFilters={hasActiveFilters}
								location={filters.location}
								dateFrom={filters.dateFrom}
								dateTo={filters.dateTo}
								radius={filters.radius}
								onOpen={() => {
									setMobileDestExpanded(false);
									setMobileWhenOpen(false);
									setActiveField("mobile_search");
								}}
								onClear={search.clear}
							/>
						</div>

						{/* Toggle tema — un solo montaggio in tutto il prodotto reso a
						    utente (D-09), sempre visibile in tutti e quattro gli stati
						    e su entrambi i breakpoint. Stessa forma visiva del mount
						    flottante rimosso, solo riposizionata (17-UI-SPEC.md). */}
						<ThemeToggle className="flex-none lg:justify-self-end flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-surface border border-border text-foreground shadow-sm hover:border-primary/50 transition-colors" />
					</div>
				</div>
			</nav>
		</>
	);
}
