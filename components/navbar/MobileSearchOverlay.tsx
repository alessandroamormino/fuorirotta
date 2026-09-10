"use client";
// gestori onClick/onChange, AnimatePresence/motion di framer-motion e lo
// stato locale di chiusura: tutti dipendenti dal runtime del browser (D-12).

/**
 * D-13 — adozione di Dialog: riuscita, per una strada diversa da quella ovvia.
 *
 * `Dialog.Content` (il wrapper stilizzato) NON e' utilizzabile qui: porta classi
 * fisse da dialogo centrato (`max-w-lg`, `p-6`, `top-1/2 left-1/2 -translate-*`)
 * pensate per essere annullate dal `className` del call site, ma `cn()` in
 * lib/utils.ts e' un join di stringhe senza tailwind-merge (Fase 7, D-09) e
 * l'ordine delle regole nel CSS compilato non segue l'ordine delle classi
 * nell'attributo: `.top-1/2` e `.p-6` sono generate dopo `.inset-0` e `.p-0` e
 * vincono comunque. Verificato empiricamente compilando con
 * @tailwindcss/postcss. Il risultato sarebbe un riquadro centrato da ~512px con
 * padding invece di un overlay/foglio a schermo intero: regressione visiva
 * reale (D-15).
 *
 * La via d'uscita e' `Dialog.ContentUnstyled` + `asChild`: Radix innesta il
 * proprio comportamento sul `motion.div` esistente, che resta l'unico a portare
 * classi — il conflitto di specificita' semplicemente non si presenta. Da qui
 * arrivano focus trap, chiusura con Escape, ripristino del focus al trigger e
 * `aria-modal`, cioe' il contenuto vero di D-13, senza spostare un pixel e
 * senza reimplementare a mano nulla di cio' che RESEARCH.md "Don't Hand-Roll"
 * vieta.
 *
 * D-19 (piano 07): la geometria di arrivo del `motion.div` passa da schermo
 * pieno a foglio ancorato al fondo (`max-h-[90dvh]`), ma il meccanismo Radix
 * resta lo stesso — vedi la correzione del 2026-09-06 in 12-CONTEXT.md: questo
 * e' gia' un `Dialog.Root`, non va sostituito con `inert`.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, ChevronDown, X } from "lucide-react";
import { it } from "date-fns/locale";
import { format, isSameDay } from "date-fns";
import type { Dispatch, SetStateAction } from "react";
import DateRangeField from "@/components/ui/DateRangeField";
import DestinationField from "@/components/navbar/DestinationField";
import MobileRadiusStep from "@/components/navbar/MobileRadiusStep";
import * as Dialog from "@/components/ui/Dialog";
import type { SearchFilters } from "@/lib/types";
import type { SuggestedDestination } from "@/lib/destinations";
import { MOTION_BASE } from "@/lib/motion";

interface OverlaySearch {
	input: string;
	setInput: (value: string) => void;
	submitMobile: () => void;
	clearMobile: () => void;
}

interface OverlayRadius {
	custom: number;
	setCustom: (value: number) => void;
	applyCustomMobile: () => void;
	isNearby: boolean;
}

interface OverlayPanels {
	mobileDestExpanded: boolean;
	setMobileDestExpanded: (value: boolean) => void;
	mobileWhenOpen: boolean;
	setMobileWhenOpen: (value: boolean) => void;
	mobileNearbyOpen: boolean;
	setMobileNearbyOpen: (value: boolean) => void;
}

interface OverlayDestinations {
	visible: SuggestedDestination[];
	canToggle: boolean;
	iconFor: (iconType: string) => string;
	selectComune: (comune: { id: number; istatCode: string; name: string }) => void;
	selectSuggested: (dest: SuggestedDestination) => void;
}

interface MobileSearchOverlayProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	filters: SearchFilters;
	setFilters: Dispatch<SetStateAction<SearchFilters>>;
	search: OverlaySearch;
	radius: OverlayRadius;
	panels: OverlayPanels;
	destinations: OverlayDestinations;
}

// Foglio di ricerca ancorato al fondo (D-19, piano 07) — prima un overlay
// fullscreen (D-09 di Fase 9), poi riscritto come bottom sheet dal prototipo
// adottato. Le due asimmetrie mobile/desktop preesistenti (D-16) restano
// intatte: il pannello destinazioni filtra dal vivo qui sotto e "Azzera" non
// chiama onSearch, a differenza delle rispettive controparti desktop.
export default function MobileSearchOverlay({
	open,
	onOpenChange,
	filters,
	setFilters,
	search,
	radius,
	panels,
	destinations,
}: MobileSearchOverlayProps) {
	const {
		mobileDestExpanded,
		setMobileDestExpanded,
		mobileWhenOpen,
		setMobileWhenOpen,
		mobileNearbyOpen,
		setMobileNearbyOpen,
	} = panels;

	// Stesso ragionamento del pannello desktop (CR-03): il campo non e' vuoto
	// anche quando porta un'etichetta che l'utente non ha digitato (comune gia'
	// scelto, o "Nelle vicinanze (N km)"), in quel caso il pannello deve
	// tornare alle destinazioni suggerite, non offrire "Cerca citta': <etichetta>".
	const isFiltering =
		Boolean(search.input.trim()) &&
		!radius.isNearby &&
		!filters.comuneId &&
		!filters.comuneIstatCode;

	// D-19 (corretta il 2026-08-20, dopo la regressione di 7852a38): il
	// nodo dove DestinationField teletrasporta (createPortal) la sua
	// lista di risultati DB, e quante righe ha trovato — qui, non nel
	// campo stesso, perche' l'intestazione e il fallback "Cerca citta'"
	// restano di competenza del pannello, non dell'input.
	const [resultsContainer, setResultsContainer] =
		useState<HTMLDivElement | null>(null);
	const [resultsCount, setResultsCount] = useState(0);

	// Chiusura unica per X/scrim/Escape: azzera visibilita' e passo interno,
	// cosi' riaprire il foglio riparte sempre dalla vista "Dove" espansa.
	const closeOverlay = () => {
		onOpenChange(false);
		setMobileDestExpanded(false);
		setMobileWhenOpen(false);
	};

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			{/* forceMount: senza, Radix smonta il contenuto all'istante della
			    chiusura e l'animazione di uscita di AnimatePresence non verrebbe
			    mai vista. Con forceMount la presenza la governa AnimatePresence,
			    Radix governa solo il comportamento. */}
			<Dialog.Portal forceMount>
				<AnimatePresence>
					{open && (
						<>
							{/* Scrim (D-19): il foglio non copre piu' tutto lo schermo,
							    quindi serve un velo che l'overlay fullscreen di ieri non
							    aveva bisogno. Riuso di Dialog.Overlay, non uno ad hoc. */}
							<Dialog.Overlay />
							<Dialog.ContentUnstyled
								asChild
								// Il focus iniziale resta all'input Dove, che porta gia'
								// autoFocus: e' il comportamento registrato in baseline e
								// va preservato. Il focus e' comunque dentro il foglio,
								// quindi il trap di Radix funziona lo stesso.
								onOpenAutoFocus={(e) => e.preventDefault()}
							>
								<motion.div
									key="mobile-sheet"
									initial={{ y: "100%" }}
									animate={{ y: 0 }}
									exit={{ y: "100%" }}
									// Punto di partenza dichiarato da 12-UI-SPEC.md — piu'
									// rigida della molla dell'overlay fullscreen perche' la
									// distanza di viaggio e' minore. NON valori finali: da
									// ritarare dal vivo a 60fps, tab in primo piano, nel
									// checkpoint del Task 3 (b511229 → 8209118 → 31a335a).
									transition={{ type: "spring", damping: 32, stiffness: 380 }}
									data-mobile-sheet="true"
									className="fixed bottom-0 left-0 right-0 z-[200] flex max-h-[90dvh] flex-col rounded-t-lg bg-surface sm:hidden"
									style={{ boxShadow: "var(--elev-raised)" }}
								>
									{/* Testata fissa: impugnatura, titolo, chiusura. */}
									<div className="flex-shrink-0 border-b border-border-soft">
										<div
											className="mx-auto mt-2 h-[5px] w-9 rounded-pill bg-border"
											aria-hidden="true"
										/>
										<div className="flex items-center justify-between gap-3 px-5 pb-3 pt-1">
											<Dialog.Title className="font-display text-lg font-semibold text-foreground">
												Dove e quando
											</Dialog.Title>
											<motion.button
												whileTap={{ scale: 0.9 }}
												onClick={closeOverlay}
												aria-label="Chiudi"
												className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-pill hover:bg-border-soft"
											>
												<X className="w-5 h-5 text-foreground-secondary" />
											</motion.button>
										</div>
									</div>

					{/* ── VISTA DOVE (collassata quando calendario aperto) ── */}
					<AnimatePresence initial={false}>
						{!mobileWhenOpen && (
							<motion.div
								key="dove-expanded"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								transition={{ duration: MOTION_BASE }}
								className="flex-1 overflow-y-auto px-4 pb-4 pt-4"
							>
								{/* BOX DOVE espanso */}
								<div className="bg-surface rounded-2xl shadow-sm p-5 mb-3">
									<AnimatePresence mode="wait" initial={false}>
										{!mobileNearbyOpen ? (
											<motion.div
												key="dove-normal"
												initial={{ opacity: 0, x: -16 }}
												animate={{ opacity: 1, x: 0 }}
												exit={{ opacity: 0, x: -16 }}
												transition={{ duration: MOTION_BASE }}
											>
												<h2 className="text-2xl font-bold text-foreground mb-4">
													Dove?
												</h2>
												{/* Corollario 1.4.11 di D-21: --border sta a 1.51:1/
												    2.10:1, sotto la soglia 3:1 — il campo non puo'
												    essere identificato dal solo bordo. Label
												    persistente sopra di esso, come .field > label del
												    prototipo, oltre al bordo e allo sfondo bg-surface
												    distinto da bg-surface del foglio. */}
												<label className="block text-sm font-semibold text-foreground mb-2">
													Destinazione
												</label>
												<div className="flex items-center gap-3 border border-border rounded-xl px-4 py-3 mb-5">
													<Search className="w-4 h-4 text-muted-foreground-faint flex-shrink-0" />
													<DestinationField
														autoFocus
														placeholder="Cerca destinazioni"
														value={search.input}
														onValueChange={search.setInput}
														onSelect={(comune) => {
															destinations.selectComune(comune);
															setMobileWhenOpen(true);
														}}
														className="flex-1 text-sm outline-none bg-transparent placeholder-muted-foreground-faint text-foreground-secondary"
														// D-19 (corretta il 2026-08-20): la lista arriva nel
														// contenitore "Risultati" qui sotto via
														// createPortal, non in un popover proprio — una
														// sola superficie di suggerimenti, alimentata
														// dall'autocomplete su database.
														resultsContainer={resultsContainer}
														onResultsChange={setResultsCount}
													/>
													{search.input && (
														<button
															type="button"
															aria-label="Svuota il campo destinazione"
															onClick={() => search.setInput("")}
															className="flex-shrink-0 w-6 h-6 rounded-full hover:bg-muted-strong flex items-center justify-center transition-colors"
														>
															<X className="w-3.5 h-3.5 text-muted-foreground" />
														</button>
													)}
												</div>

												<p className="text-xs font-semibold text-muted-foreground-subtle mb-3">
													{isFiltering ? "Risultati" : "Destinazioni suggerite"}
												</p>

												{isFiltering ? (
													/* D-19 (corretta il 2026-08-20, dopo la regressione
													   di 7852a38): stesso contenitore di prima, ma la
													   sorgente e' l'autocomplete su database
													   (/api/comuni/search), non un filtro locale sui 13
													   preset — quello era esattamente la regressione,
													   spegneva l'autocomplete su tutta la superficie
													   mobile (UI-02). DestinationField (sopra) porta qui
													   i risultati via createPortal. */
													<div className="overflow-y-auto max-h-[45vh] flex flex-col gap-1">
														<div ref={setResultsContainer} />
														{resultsCount === 0 && (
															/* Nessun risultato → "Cerca città: xxx" */
															<motion.button
																whileTap={{ scale: 0.98 }}
																onClick={() => {
																	setFilters({
																		...filters,
																		location: search.input,
																	});
																	setMobileWhenOpen(true);
																}}
																className="flex items-center gap-3 p-2 rounded-xl hover:bg-muted transition-all text-left"
															>
																<div className="w-10 h-10 bg-muted-strong rounded-lg flex items-center justify-center text-xl flex-shrink-0">
																	<Search className="w-4 h-4 text-muted-foreground-subtle" />
																</div>
																<div className="flex-1 min-w-0">
																	<div className="font-medium text-foreground text-sm">
																		Cerca città:{" "}
																		<span className="text-primary">
																			{search.input}
																		</span>
																	</div>
																	<div className="text-xs text-muted-foreground-subtle">
																		Cerca eventi in questa zona
																	</div>
																</div>
															</motion.button>
														)}
													</div>
												) : (
													/* Lista con altezza max + scroll — "Quando" rimane
													   sempre visibile. */
													<div className="overflow-y-auto max-h-[45vh] grid grid-cols-1 gap-1">
														{destinations.visible.map((dest) => (
															<motion.button
																key={dest.name}
																whileTap={{ scale: 0.98 }}
																onClick={() => {
																	if (dest.isNearby) {
																		setMobileNearbyOpen(true);
																	} else {
																		destinations.selectSuggested(dest);
																		setMobileWhenOpen(true);
																	}
																}}
																className="flex items-center gap-3 p-2 rounded-xl hover:bg-muted transition-all text-left"
															>
																<div className="w-10 h-10 bg-muted-strong rounded-lg flex items-center justify-center text-xl flex-shrink-0">
																	{destinations.iconFor(dest.icon)}
																</div>
																<div className="flex-1 min-w-0">
																	<div className="font-medium text-foreground text-sm truncate">
																		{dest.name}
																	</div>
																	<div className="text-xs text-muted-foreground-subtle truncate">
																		{dest.subtitle}
																	</div>
																</div>
															</motion.button>
														))}
													</div>
												)}

												{/* Mostra tutte / meno — solo se non si sta cercando */}
												{destinations.canToggle && !mobileDestExpanded && (
													<motion.button
														whileTap={{ scale: 0.97 }}
														onClick={() => setMobileDestExpanded(true)}
														className="mt-3 w-full flex items-center justify-center gap-1 py-2 text-sm font-semibold text-muted-foreground-subtle hover:text-foreground-strong transition-colors"
													>
														<ChevronDown className="w-4 h-4" />
														Mostra più destinazioni
													</motion.button>
												)}
												{destinations.canToggle && mobileDestExpanded && (
													<motion.button
														whileTap={{ scale: 0.97 }}
														onClick={() => setMobileDestExpanded(false)}
														className="mt-3 w-full flex items-center justify-center gap-1 py-2 text-sm font-semibold text-muted-foreground-subtle hover:text-foreground-strong transition-colors"
													>
														<ChevronDown className="w-4 h-4 rotate-180" />
														Mostra meno
													</motion.button>
												)}
											</motion.div>
										) : (
											<MobileRadiusStep
												key="dove-nearby"
												value={radius.custom}
												onValueChange={radius.setCustom}
												onBack={() => setMobileNearbyOpen(false)}
												onConfirm={radius.applyCustomMobile}
											/>
										)}
									</AnimatePresence>
								</div>

								{/* BOX QUANDO collassato */}
								<button
									onClick={() => setMobileWhenOpen(true)}
									className="w-full bg-surface rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between text-left mb-3"
								>
									<span className="text-sm text-muted-foreground-faint font-medium">
										Quando
									</span>
									<span className="text-sm font-semibold text-foreground">
										{/* Bugfix 2026-09-10 (defect 2): dateFrom === dateTo per un
										    giorno singolo (DateRangeField li imposta sempre insieme
										    ora) — senza !isSameDay qui la pillola mostrerebbe
										    "10 set – 10 set" invece di "10 set". */}
										{filters.dateFrom && filters.dateTo
											? isSameDay(filters.dateFrom, filters.dateTo)
												? format(filters.dateFrom, "d MMM", { locale: it })
												: `${format(filters.dateFrom, "d MMM", { locale: it })} – ${format(filters.dateTo, "d MMM", { locale: it })}`
											: "Aggiungi date"}
									</span>
								</button>
							</motion.div>
						)}
					</AnimatePresence>

					{/* ── VISTA CALENDARIO (quando aperto) ── */}
					<AnimatePresence initial={false}>
						{mobileWhenOpen && (
							<motion.div
								key="quando-expanded"
								initial={{ opacity: 0, x: 40 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: 40 }}
								transition={{ type: "spring", damping: 28, stiffness: 320 }}
								className="flex-1 flex flex-col overflow-hidden"
							>
								{/* Dove collassato (pill) */}
								<div className="px-4 pt-3 pb-2">
									<button
										onClick={() => setMobileWhenOpen(false)}
										className="w-full bg-surface rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between text-left"
									>
										<span className="text-sm text-muted-foreground-faint font-medium">
											Dove
										</span>
										<span className="text-sm font-semibold text-foreground truncate max-w-[200px]">
											{filters.location || "Sono flessibile"}
										</span>
									</button>
								</div>

								{/* Box calendario: header fisso + mesi scrollabili. D-19
								    (checkpoint Task 3): DateRangeField riusato per primo —
								    zero markup nuovo — la scelta fra questo e due campi
								    data nativi si chiude a schermo, non qui. */}
								<DateRangeField
									variant="mobile"
									dateFrom={filters.dateFrom}
									dateTo={filters.dateTo}
									onChange={(range) =>
										setFilters((f) => ({ ...f, ...range }))
									}
								/>
							</motion.div>
						)}
					</AnimatePresence>

									{/* Piede fisso (D-19): in flusso dentro la colonna del
									    foglio, non piu' `fixed` come nell'overlay fullscreen —
									    il foglio stesso e' gia' ancorato al fondo. D-16: "Azzera"
									    chiama search.clearMobile, che azzera solo lo stato locale
									    e i pannelli — NON chiama onSearch. La lista eventi sotto
									    resta ferma finche' non si preme di nuovo Cerca, a
									    differenza del "Cancella" desktop. Asimmetria preesistente
									    conservata di proposito. */}
									<div
										className="flex flex-shrink-0 items-center justify-between gap-4 border-t border-border-soft bg-surface px-5 py-4"
										style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
									>
										<motion.button
											whileTap={{ scale: 0.96 }}
											onClick={search.clearMobile}
											className="text-sm font-semibold text-foreground-secondary underline underline-offset-2"
										>
											Azzera
										</motion.button>
										<motion.button
											whileHover={{ scale: 1.02 }}
											whileTap={{ scale: 0.97 }}
											onClick={search.submitMobile}
											className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold rounded-pill transition-colors shadow-lg"
										>
											<Search className="w-4 h-4" />
											Cerca
										</motion.button>
									</div>
								</motion.div>
							</Dialog.ContentUnstyled>
						</>
					)}
				</AnimatePresence>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
