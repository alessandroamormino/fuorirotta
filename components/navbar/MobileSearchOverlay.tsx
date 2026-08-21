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
 * padding invece di un overlay a schermo intero: regressione visiva reale (D-15).
 *
 * La via d'uscita e' `Dialog.ContentUnstyled` + `asChild`: Radix innesta il
 * proprio comportamento sul `motion.div` esistente, che resta l'unico a portare
 * classi — il conflitto di specificita' semplicemente non si presenta. Da qui
 * arrivano focus trap, chiusura con Escape, ripristino del focus al trigger e
 * `aria-modal`, cioe' il contenuto vero di D-13, senza spostare un pixel e
 * senza reimplementare a mano nulla di cio' che RESEARCH.md "Don't Hand-Roll"
 * vieta.
 *
 * Il contenitore resta il `motion.div fixed inset-0` originale, invariato.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
	Search,
	ChevronDown,
	X,
	LayoutList,
	Map,
} from "lucide-react";
import { it } from "date-fns/locale";
import { format } from "date-fns";
import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import Image from "next/image";
import DateRangeField from "@/components/ui/DateRangeField";
import ThemeToggle from "@/components/ui/ThemeToggle";
import DestinationField from "@/components/navbar/DestinationField";
import MobileRadiusStep from "@/components/navbar/MobileRadiusStep";
import * as Dialog from "@/components/ui/Dialog";
import type { SearchFilters } from "@/lib/types";
import type { SuggestedDestination } from "@/lib/destinations";

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
	onOpenMap?: () => void;
}

// Overlay fullscreen mobile, spostato verbatim da Navbar.tsx (D-09). Le due
// asimmetrie mobile/desktop preesistenti (D-16) restano intatte: il pannello
// destinazioni filtra dal vivo qui sotto e "Cancella tutto" non chiama
// onSearch, a differenza delle rispettive controparti desktop.
export default function MobileSearchOverlay({
	open,
	onOpenChange,
	filters,
	setFilters,
	search,
	radius,
	panels,
	destinations,
	onOpenMap,
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

	// Chiusura unica per logo/X/"Lista": azzera visibilita' e passo interno,
	// cosi' riaprire l'overlay riparte sempre dalla vista "Dove" espansa.
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
						<Dialog.ContentUnstyled
							asChild
							// Il focus iniziale resta all'input Dove, che porta gia'
							// autoFocus: e' il comportamento registrato in baseline e
							// va preservato. Il focus e' comunque dentro l'overlay,
							// quindi il trap di Radix funziona lo stesso.
							onOpenAutoFocus={(e) => e.preventDefault()}
						>
							<motion.div
								key="mobile-overlay"
								initial={{ opacity: 0, y: "-100%" }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, y: "-100%" }}
								transition={{ type: "spring", damping: 30, stiffness: 300 }}
								data-mobile-overlay="true"
								className="fixed inset-0 z-[200] bg-muted flex flex-col sm:hidden"
							>
								<Dialog.Title className="sr-only">Ricerca eventi</Dialog.Title>
					{/* Header */}
					<div
						className="flex items-center px-5 pb-4 bg-muted relative"
						style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
					>
						{/* Logo a sinistra */}
						<div className="flex-1 flex items-center">
							<Link href="/" onClick={closeOverlay}>
								<div className="flex items-center gap-2">
									<Image
										src="/images/logo.svg"
										alt="Fuorirotta"
										width={32}
										height={32}
										className="w-8 h-8"
										loading="eager"
										priority
									/>
									<span className="text-base font-bold text-primary">
										Fuorirotta
									</span>
								</div>
							</Link>
						</div>
						<div className="flex-1 flex justify-end gap-2">
							<motion.button
								whileTap={{ scale: 0.9 }}
								onClick={closeOverlay}
								className="w-11 h-11 rounded-full bg-surface shadow flex items-center justify-center"
								title="Lista"
							>
								<LayoutList className="w-5 h-5 text-muted-foreground" />
							</motion.button>
							<motion.button
								whileTap={{ scale: 0.9 }}
								onClick={() => {
									closeOverlay();
									onOpenMap?.();
								}}
								className="w-11 h-11 rounded-full bg-surface shadow flex items-center justify-center"
								title="Mappa"
							>
								<Map className="w-5 h-5 text-muted-foreground" />
							</motion.button>
							{/* Tema: qui e non flottante. Su mobile non esiste un angolo
							    libero — in alto copriva la searchbar, in basso la
							    paginazione. Dentro questo pannello non copre nulla. */}
							<ThemeToggle className="w-11 h-11 rounded-full bg-surface shadow flex items-center justify-center text-muted-foreground" />
							<motion.button
								whileTap={{ scale: 0.9 }}
								onClick={closeOverlay}
								className="w-11 h-11 rounded-full bg-surface shadow flex items-center justify-center"
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
								transition={{ duration: 0.2 }}
								className="flex-1 overflow-y-auto px-4 pb-32"
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
												transition={{ duration: 0.2 }}
											>
												<h2 className="text-2xl font-bold text-foreground mb-4">
													Dove?
												</h2>
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
										{filters.dateFrom && filters.dateTo
											? `${format(filters.dateFrom, "d MMM", { locale: it })} – ${format(filters.dateTo, "d MMM", { locale: it })}`
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
								<div className="px-4 pt-1 pb-2">
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

								{/* Box calendario: header fisso + mesi scrollabili */}
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

					{/* Footer fisso.
					    D-16: "Cancella tutto" chiama search.clearMobile, che azzera solo
					    lo stato locale e i pannelli — NON chiama onSearch. La lista
					    eventi sotto resta ferma finche' non si preme di nuovo Cerca,
					    a differenza del "Cancella" desktop. Asimmetria preesistente
					    conservata di proposito. */}
					<div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-muted-strong px-5 py-4 flex items-center justify-between gap-4 sm:hidden">
						<motion.button
							whileTap={{ scale: 0.96 }}
							onClick={search.clearMobile}
							className="text-sm font-semibold text-foreground-secondary underline underline-offset-2"
						>
							Cancella tutto
						</motion.button>
						<motion.button
							whileHover={{ scale: 1.02 }}
							whileTap={{ scale: 0.97 }}
							onClick={search.submitMobile}
							className="flex items-center gap-2 px-6 py-3 bg-primary hover:bg-primary-hover text-primary-foreground font-semibold rounded-full transition-colors shadow-lg"
						>
							<Search className="w-4 h-4" />
							Cerca
						</motion.button>
							</div>
							</motion.div>
						</Dialog.ContentUnstyled>
					)}
				</AnimatePresence>
			</Dialog.Portal>
		</Dialog.Root>
	);
}
