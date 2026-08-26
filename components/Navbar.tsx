"use client";
// useState locale per il nodo DOM del contenitore risultati "Dove" (D-19) e
// per il suo contatore, piu' gli onClick dei campi e le animazioni
// framer-motion (motion.div/motion.button); chiama inoltre l'hook condiviso
// useNavbarSearch, che possiede lo stato dei filtri (D-12).

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { it } from "date-fns/locale";
import { format } from "date-fns";
import Link from "next/link";
import Image from "next/image";
import DestinationField from "@/components/navbar/DestinationField";
import MobileSearchOverlay from "@/components/navbar/MobileSearchOverlay";
import MobileSearchbarTrigger from "@/components/navbar/MobileSearchbarTrigger";
import DesktopSearchDropdown from "@/components/navbar/DesktopSearchDropdown";
import * as Popover from "@/components/ui/Popover";
import ThemeToggle from "@/components/ui/ThemeToggle";
import type { SearchFilters } from "@/lib/types";
import { useNavbarSearch } from "@/lib/hooks/useNavbarSearch";

interface NavbarProps {
	// D-07: Navbar e' un componente controllato — riceve i filtri come valore
	// e li restituisce via callback, senza possederne una copia.
	filters: SearchFilters;
	onFiltersChange: (filters: SearchFilters) => void;
	onSearch: (filters: SearchFilters) => void;
	onOpenMap?: () => void;
}

export default function Navbar({ filters: controlledFilters, onFiltersChange, onSearch, onOpenMap }: NavbarProps) {
	const { filters, setFilters, search, radius, panels, destinations } =
		useNavbarSearch({ filters: controlledFilters, onFiltersChange, onSearch });
	const { activeField, setActiveField, setMobileDestExpanded, setMobileWhenOpen } =
		panels;
	const hasActiveFilters = search.hasActiveFilters;

	// Il dropdown desktop e' aperto per ogni activeField tranne il caso
	// mobile_search (che apre invece l'overlay fullscreen sopra) e null.
	const dropdownOpen = activeField !== null && activeField !== "mobile_search";

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
				onOpenMap={onOpenMap}
			/>

			{/* ── NAVBAR ── */}
			<nav
				id="main-navbar"
				className="fixed top-2 left-0 right-0 z-50 px-4 py-4"
			>
				<div className="container mx-auto">
					<div className="flex items-center gap-3 sm:gap-4 lg:gap-6">
						{/* Logo — in flusso (D-10): non piu' absolute, fratello flex-none
						    della zona di ricerca e del toggle. */}
						<div className="flex-none">
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
									<span className="hidden xl:block text-2xl font-bold text-primary">
										Fuorirotta
									</span>
								</motion.div>
							</Link>
						</div>

						{/* Search Bar — flex-1 min-w-0 (D-10): cede spazio per prima,
						    non invade quello del logo/toggle a larghezze intermedie. */}
						<div className="flex-1 min-w-0 flex justify-center">
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
									    click e senza smontare il pannello. */}
									<div
										data-navbar-searchbar
										className="w-full flex items-center bg-surface/90 backdrop-blur-md border border-surface/40 rounded-full shadow-lg hover:shadow-xl transition-all px-2 relative"
									>
										{/* Mobile: searchbar */}
										<MobileSearchbarTrigger
											hasActiveFilters={hasActiveFilters}
											location={filters.location}
											dateFrom={filters.dateFrom}
											dateTo={filters.dateTo}
											onOpen={() => {
												setMobileDestExpanded(false);
												setMobileWhenOpen(false);
												setActiveField("mobile_search");
											}}
											onClear={search.clear}
										/>

										{/* Desktop: Where Field */}
										<div className="hidden sm:block flex-1 relative">
											<div
												onClick={() => setActiveField("where")}
												className="relative px-4 sm:px-6 py-2 sm:py-3 rounded-full cursor-pointer transition-all hover:bg-surface/50"
											>
												<label className="text-[10px] sm:text-xs font-semibold text-foreground block mb-0.5">
													Dove
												</label>
												<DestinationField
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
													className="absolute inset-x-0 top-2 bottom-2 rounded-full bg-primary/5 pointer-events-none"
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
												onClick={() => setActiveField("when")}
												className="px-4 sm:px-6 py-2 sm:py-3 rounded-full cursor-pointer transition-all hover:bg-surface/50"
											>
												<label className="text-[10px] sm:text-xs font-semibold text-foreground block mb-0.5">
													Date
												</label>
												<div className="text-xs sm:text-sm text-muted-foreground-faint truncate">
													{filters.dateFrom && filters.dateTo
														? `${format(filters.dateFrom, "d MMM", { locale: it })} - ${format(filters.dateTo, "d MMM", { locale: it })}`
														: "Aggiungi date"}
												</div>
											</div>
											{activeField === "when" && (
												<motion.div
													layoutId="activeRing"
													className="absolute inset-x-0 top-2 bottom-2 rounded-full bg-primary/5 pointer-events-none"
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
									</div>
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

						{/* Toggle tema — un solo montaggio in tutto il prodotto reso a
						    utente (D-09), sempre visibile in tutti e quattro gli stati
						    e su entrambi i breakpoint. Stessa forma visiva del mount
						    flottante rimosso, solo riposizionata (17-UI-SPEC.md). */}
						<ThemeToggle className="flex-none flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-surface border border-border text-foreground shadow-sm hover:border-primary/50 transition-colors" />
					</div>
				</div>
			</nav>
		</>
	);
}
