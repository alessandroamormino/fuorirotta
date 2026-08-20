"use client";
// gestori onClick/onChange, AnimatePresence/motion di framer-motion e il
// Popover di Radix per il contenitore ancorato (D-12).

/**
 * D-13 — adozione di Popover per il dropdown "Dove"/"Quando" desktop.
 *
 * Stesso conflitto di specificita' gia' documentato in MobileSearchOverlay
 * per Dialog.Content: cn() in lib/utils.ts non fa merge (Fase 7, D-09), e
 * Popover.Content porta le proprie classi fisse (z-[200], max-h-[70vh],
 * min-w-[10rem], rounded-lg, border-border, shadow-xl, p-2) pensate per un
 * popover generico, non per un pannello largo quanto la barra di ricerca.
 * Stessa via d'uscita: Popover.ContentUnstyled (aggiunto a
 * components/ui/Popover.tsx, additivo) + asChild sul motion.div esistente,
 * che resta l'unico a portare classi — nessun conflitto possibile perche'
 * non c'e' nulla con cui confliggere.
 *
 * La posizione passa da absolute manuale (top-full mt-4, dentro un
 * contenitore relative) a sideOffset={16} + align (start per "where", end
 * per "when") sull'ancora fornita dalla shell: stessa distanza dalla barra,
 * stesso allineamento — verificato dal checkpoint del Task 3, non da qui.
 * Con la stessa adozione arrivano anche la chiusura per click esterno,
 * Escape e il ripristino del focus (T-09-13): il listener manuale su
 * `document` e il ref che lo supportava sono rimossi dall'hook condiviso
 * nello stesso commit.
 */

import type { Dispatch, SetStateAction } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search } from "lucide-react";
import DateRangeField from "@/components/ui/DateRangeField";
import DesktopRadiusPanel from "@/components/navbar/DesktopRadiusPanel";
import * as Popover from "@/components/ui/Popover";
import {
	SUGGESTED_DESTINATIONS,
	type SuggestedDestination,
} from "@/lib/destinations";
import type { SearchFilters } from "@/lib/types";

type ActiveField = "where" | "when" | null;

// Sottoinsiemi di cio' che restituisce l'hook condiviso (radius/destinations
// interi passano una struttura piu' ampia di questa, va bene: e' un
// passaggio di variabile, non di literal, l'excess property check di
// TypeScript non si applica).
interface DesktopRadiusBag {
	showSelector: boolean;
	setShowSelector: (value: boolean) => void;
	custom: number;
	setCustom: (value: number) => void;
	applyPreset: (value: number, label: string) => void;
	applyCustomDesktop: () => void;
}

interface DesktopDestinationsBag {
	iconFor: (iconType: string) => string;
	selectSuggested: (dest: SuggestedDestination) => void;
}

interface DesktopSearchDropdownProps {
	open: boolean;
	activeField: ActiveField;
	setActiveField: (field: ActiveField) => void;
	searchInput: string;
	radius: DesktopRadiusBag;
	destinations: DesktopDestinationsBag;
	filters: SearchFilters;
	setFilters: Dispatch<SetStateAction<SearchFilters>>;
	// D-19 (corretta il 2026-08-20): il campo Dove desktop vive nella barra
	// collassata (Navbar.tsx), fuori da questo pannello — il nodo dove
	// DestinationField teletrasporta (createPortal) la sua lista di
	// risultati deve quindi arrivare da li'. resultsCount arriva dallo
	// stesso posto: serve per decidere fra la lista e il fallback "Cerca
	// citta'" senza duplicare lo stato del fetch qui.
	resultsContainerRef: (el: HTMLDivElement | null) => void;
	resultsCount: number;
}

// Dropdown desktop "Dove"/"Quando", spostato verbatim da Navbar.tsx (D-09) e
// riancorato su Popover (D-13, vedi sopra). Non chiama l'hook (D-10): ogni
// valore arriva per props dalla shell, che lo chiama una sola volta.
export default function DesktopSearchDropdown({
	open,
	activeField,
	setActiveField,
	searchInput,
	radius,
	destinations,
	filters,
	setFilters,
	resultsContainerRef,
	resultsCount,
}: DesktopSearchDropdownProps) {
	const isFiltering = searchInput.trim().length > 0;

	const handleSearchFallback = (value: string) =>
		setFilters((f) => ({ ...f, location: value }));
	const handleDateChange = (range: {
		dateFrom?: Date | null;
		dateTo?: Date | null;
	}) => setFilters((f) => ({ ...f, ...range }));
	const handleClearDates = () =>
		setFilters((f) => ({ ...f, dateFrom: null, dateTo: null }));

	const selectOrOpenRadius = (dest: SuggestedDestination) => {
		if (dest.isNearby) {
			radius.setShowSelector(true);
		} else {
			destinations.selectSuggested(dest);
			setActiveField("when");
		}
	};

	// Ancoraggio: floating-ui posiziona SOLO la cornice esterna, larga quanto la
	// barra di ricerca e sempre align="start" — l'equivalente esatto del vecchio
	// `absolute top-full mt-4`. Lo spostamento orizzontale fra "Dove" e "Quando"
	// resta invece in CSS sul motion.div interno, cosi' la prop `layout` di framer
	// puo' animarlo come faceva prima.
	//
	// Perche' non basta align="start"|"end": floating-ui applica una transform sul
	// wrapper del popover, che `layout` non vede. Il risultato era la posizione che
	// saltava di colpo mentre solo la larghezza si animava — e, al montaggio, la
	// comparsa in diagonale dall'angolo, perche' la posizione viene calcolata dopo
	// il paint.
	return (
		<Popover.Portal forceMount>
			<AnimatePresence>
				{open && (
					<Popover.ContentUnstyled
						asChild
						align="start"
						sideOffset={16}
						onOpenAutoFocus={(e) => e.preventDefault()}
						// La barra di ricerca NON e' "fuori": cliccare "Quando" mentre
						// "Dove" e' aperto deve cambiare campo, non chiudere. Senza questo,
						// il dismiss layer di Radix chiude il pannello e si mangia il click,
						// che non raggiunge mai il campo — da cui il secondo click
						// necessario, e lo smontaggio che azzera l'animazione `layout`.
						onInteractOutside={(event) => {
							const anchor = (event.target as HTMLElement | null)?.closest?.(
								"[data-navbar-searchbar]",
							);
							if (anchor) event.preventDefault();
						}}
					>
						<div
							style={{ width: "var(--radix-popover-trigger-width)" }}
							className="relative"
						>
						<motion.div
							layout
							initial={{ opacity: 0, y: -10 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -10 }}
							transition={{
								layout: { type: "spring", damping: 30, stiffness: 400 },
								opacity: { duration: 0.2 },
							}}
							className={`bg-surface/95 backdrop-blur-md rounded-3xl shadow-2xl border border-surface/30 overflow-hidden absolute top-0 ${
								activeField === "where"
									? "left-0 right-0 sm:left-0 sm:right-auto sm:w-[500px]"
									: "left-0 right-0 sm:left-auto sm:right-0 sm:w-[700px]"
							}`}
						>
							<AnimatePresence mode="wait">
								{/* Where Dropdown */}
								{activeField === "where" && !radius.showSelector && (
									<motion.div
										key="where"
										initial={{ opacity: 0, x: -20 }}
										animate={{ opacity: 1, x: 0 }}
										exit={{ opacity: 0, x: -20 }}
										transition={{ duration: 0.2 }}
										className="p-4 sm:p-8"
									>
										{/* D-19 (corretta il 2026-08-20, dopo la regressione di
										    7852a38): il pannello e' unificato — digitando, i preset
										    escono con una transizione e vengono sostituiti, nello
										    stesso contenitore, dai risultati DI /api/comuni/search
										    (non da un filtro locale sui 13 preset, che e'
										    esattamente cio' che 7852a38 aveva fatto per errore e
										    che spegneva l'autocomplete su database, UI-02). Il campo
										    Dove (Navbar.tsx) passa a DestinationField il nodo DOM
										    del contenitore qui sotto (resultsContainerRef): la
										    lista arriva via createPortal invece che in un Popover
										    proprio, cosi' resta una sola superficie di
										    suggerimenti. */}
										<AnimatePresence mode="wait" initial={false}>
											{!isFiltering ? (
												<motion.div
													key="preset"
													initial={{ opacity: 0, x: -20 }}
													animate={{ opacity: 1, x: 0 }}
													exit={{ opacity: 0, x: -20 }}
													transition={{ duration: 0.2 }}
												>
													<h3 className="text-xs sm:text-sm font-semibold text-foreground mb-4 sm:mb-6">
														Destinazioni suggerite
													</h3>
													{/* D-16 (asimmetria preesistente, scoperta in baseline
													    e ancora vera): questa vista rende SEMPRE tutte e
													    13 le voci di SUGGESTED_DESTINATIONS in un
													    contenitore scrollabile, senza il bottone "mostra
													    tutte/meno" che esiste solo sul mobile
													    (DEST_PREVIEW_COUNT/canToggle). Non e' toccata da
													    D-19, che riguarda solo il passaggio preset ->
													    risultati filtrati. */}
													<div className="grid grid-cols-1 gap-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
														{SUGGESTED_DESTINATIONS.map((dest) => (
															<motion.button
																key={dest.name}
																whileHover={{ backgroundColor: "var(--muted)" }}
																whileTap={{ scale: 0.98 }}
																onClick={() => selectOrOpenRadius(dest)}
																className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-muted transition-all text-left"
															>
																<div className="w-10 h-10 sm:w-12 sm:h-12 bg-muted-strong rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
																	{destinations.iconFor(dest.icon)}
																</div>
																<div className="flex-1 min-w-0">
																	<div className="font-medium text-foreground text-sm sm:text-base truncate">
																		{dest.name}
																	</div>
																	<div className="text-xs sm:text-sm text-muted-foreground-subtle truncate">
																		{dest.subtitle}
																	</div>
																</div>
															</motion.button>
														))}
													</div>
												</motion.div>
											) : (
												<motion.div
													key="filtered"
													initial={{ opacity: 0, x: 20 }}
													animate={{ opacity: 1, x: 0 }}
													exit={{ opacity: 0, x: 20 }}
													transition={{ duration: 0.2 }}
												>
													<h3 className="text-xs sm:text-sm font-semibold text-foreground mb-4 sm:mb-6">
														Risultati
													</h3>
													{resultsCount === 0 && (
														/* Nessun risultato → "Cerca città: xxx", stesso
														   fallback del mobile (baseline riga 3). */
														<motion.button
															whileHover={{ backgroundColor: "var(--muted)" }}
															whileTap={{ scale: 0.98 }}
															onClick={() => {
																handleSearchFallback(searchInput);
																setActiveField("when");
															}}
															className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-muted transition-all text-left w-full"
														>
															<div className="w-10 h-10 sm:w-12 sm:h-12 bg-muted-strong rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
																<Search className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground-subtle" />
															</div>
															<div className="flex-1 min-w-0">
																<div className="font-medium text-foreground text-sm sm:text-base">
																	Cerca città:{" "}
																	<span className="text-primary">
																		{searchInput}
																	</span>
																</div>
																<div className="text-xs sm:text-sm text-muted-foreground-subtle">
																	Cerca eventi in questa zona
																</div>
															</div>
														</motion.button>
													)}
													{/* Nodo di destinazione del portal di DestinationField
													    (vedi commento sopra): resta vuoto finche' l'utente
													    non digita, il fetch e' li' che vive. */}
													<div
														ref={resultsContainerRef}
														className="max-h-[400px] overflow-y-auto pr-2 scrollbar-thin"
													/>
												</motion.div>
											)}
										</AnimatePresence>
									</motion.div>
								)}

								{/* Radius Selector */}
								{activeField === "where" && radius.showSelector && (
									<DesktopRadiusPanel
										value={radius.custom}
										onValueChange={radius.setCustom}
										onBack={() => radius.setShowSelector(false)}
										onSelectPreset={radius.applyPreset}
										onApplyCustom={radius.applyCustomDesktop}
									/>
								)}

								{/* When Dropdown - Desktop */}
								{activeField === "when" && (
									<motion.div
										key="when"
										initial={{ opacity: 0, x: 20 }}
										animate={{ opacity: 1, x: 0 }}
										exit={{ opacity: 0, x: 20 }}
										transition={{ duration: 0.2 }}
										className="p-4 sm:p-8"
									>
										<DateRangeField
											variant="desktop"
											dateFrom={filters.dateFrom}
											dateTo={filters.dateTo}
											onChange={handleDateChange}
										/>

										{(filters.dateFrom || filters.dateTo) && (
											<div className="mt-6 flex justify-end">
												<button
													onClick={handleClearDates}
													className="text-sm font-semibold text-muted-foreground hover:text-foreground underline"
												>
													Cancella date
												</button>
											</div>
										)}
									</motion.div>
								)}
							</AnimatePresence>
						</motion.div>
						</div>
					</Popover.ContentUnstyled>
				)}
			</AnimatePresence>
		</Popover.Portal>
	);
}
