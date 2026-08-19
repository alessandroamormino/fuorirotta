"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Search, ChevronLeft, X } from "lucide-react";
import { it } from "date-fns/locale";
import { format } from "date-fns";
import Link from "next/link";
import Image from "next/image";
import DateRangeField from "@/components/ui/DateRangeField";
import DestinationField from "@/components/navbar/DestinationField";
import MobileSearchOverlay from "@/components/navbar/MobileSearchOverlay";
import type { SearchFilters } from "@/lib/types";
import { SUGGESTED_DESTINATIONS, RADIUS_OPTIONS } from "@/lib/destinations";
import { useNavbarSearch } from "@/lib/hooks/useNavbarSearch";

interface NavbarProps {
	onSearch: (filters: SearchFilters) => void;
	onOpenMap?: () => void;
}

export default function Navbar({ onSearch, onOpenMap }: NavbarProps) {
	const { filters, setFilters, search, radius, panels, destinations } =
		useNavbarSearch({ onSearch });
	const {
		activeField,
		setActiveField,
		setMobileDestExpanded,
		setMobileWhenOpen,
		searchBarRef,
	} = panels;
	const hasActiveFilters = search.hasActiveFilters;
	const getIconForDestination = destinations.iconFor;

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
					<div className="flex items-center justify-center gap-8">
						{/* Logo */}
						<div className="absolute left-4 md:left-8 lg:left-15">
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
										className="hidden sm:block w-8 h-8 sm:w-10 sm:h-10"
										loading="eager"
										priority
									/>
									<span className="hidden xl:block text-2xl font-bold text-primary">
										Fuorirotta
									</span>
								</motion.div>
							</Link>
						</div>

						{/* Search Bar */}
						<div ref={searchBarRef} className="w-full max-w-3xl relative">
							<div className="w-full flex items-center bg-surface/90 backdrop-blur-md border border-surface/40 rounded-full shadow-lg hover:shadow-xl transition-all px-2 relative">
								{/* Mobile: searchbar */}
								<div className="sm:hidden flex-1 min-w-0">
									{!hasActiveFilters ? (
										/* Nessun filtro: "Inizia la ricerca" */
										<div
											onClick={() => {
												setMobileDestExpanded(false);
												setMobileWhenOpen(false);
												setActiveField("mobile_search");
											}}
											className="px-4 py-4 rounded-full cursor-pointer transition-all hover:bg-surface/50"
										>
											<button className="flex items-center gap-2 w-full justify-center text-sm font-semibold text-foreground-secondary cursor-pointer">
												<Search className="w-4 h-4" />
												<span>Inizia la ricerca</span>
											</button>
										</div>
									) : (
										/* Filtri attivi: ← fuori + pill centrata */
										<div className="flex items-center gap-2 px-2 py-2 min-w-0">
											<motion.button
												whileTap={{ scale: 0.9 }}
												onClick={search.clear}
												className="w-9 h-9 flex-shrink-0 rounded-full hover:bg-muted-strong flex items-center justify-center transition-colors"
											>
												<ChevronLeft className="w-5 h-5 text-foreground-secondary" />
											</motion.button>
											<button
												onClick={() => {
													setMobileDestExpanded(false);
													setMobileWhenOpen(false);
													setActiveField("mobile_search");
												}}
												className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2"
											>
												<span className="text-sm font-semibold text-foreground truncate">
													{filters.location || "Ovunque"}
												</span>
												<span className="text-disabled-foreground font-light">·</span>
												<span className="text-sm text-muted-foreground-subtle truncate flex-shrink-0">
													{filters.dateFrom && filters.dateTo
														? `${format(filters.dateFrom, "d MMM", { locale: it })} – ${format(filters.dateTo, "d MMM", { locale: it })}`
														: filters.dateFrom
															? format(filters.dateFrom, "d MMM", {
																	locale: it,
																})
															: "Qualsiasi data"}
												</span>
											</button>
										</div>
									)}
								</div>

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

							{/* Desktop Dropdown */}
							{activeField !== null && activeField !== "mobile_search" && (
								<motion.div
									layout
									initial={{ opacity: 0, y: -10 }}
									animate={{ opacity: 1, y: 0 }}
									exit={{ opacity: 0, y: -10 }}
									transition={{
										layout: { type: "spring", damping: 30, stiffness: 400 },
										opacity: { duration: 0.2 },
									}}
									className={`absolute top-full mt-4 bg-surface/95 backdrop-blur-md rounded-3xl shadow-2xl border border-surface/30 overflow-hidden
                    ${
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
												<h3 className="text-xs sm:text-sm font-semibold text-foreground mb-4 sm:mb-6">
													Destinazioni suggerite
												</h3>
												<div className="grid grid-cols-1 gap-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
													{SUGGESTED_DESTINATIONS.map((dest) => (
														<motion.button
															key={dest.name}
															whileHover={{ backgroundColor: "var(--muted)" }}
															whileTap={{ scale: 0.98 }}
															onClick={() => {
																if (dest.isNearby) {
																	radius.setShowSelector(true);
																} else {
																	destinations.selectSuggested(dest);
																	setActiveField("when");
																}
															}}
															className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-muted transition-all text-left"
														>
															<div className="w-10 h-10 sm:w-12 sm:h-12 bg-muted-strong rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
																{getIconForDestination(dest.icon)}
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
										)}

										{/* Radius Selector */}
										{activeField === "where" && radius.showSelector && (
											<motion.div
												key="radius"
												initial={{ opacity: 0, x: -20 }}
												animate={{ opacity: 1, x: 0 }}
												exit={{ opacity: 0, x: -20 }}
												transition={{ duration: 0.2 }}
												className="p-4 sm:p-8"
											>
												<div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
													<motion.button
														onClick={() => radius.setShowSelector(false)}
														whileHover={{ scale: 1.05 }}
														whileTap={{ scale: 0.95 }}
														className="w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-muted-strong flex items-center justify-center transition-colors"
													>
														<svg
															className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground"
															fill="none"
															stroke="currentColor"
															viewBox="0 0 24 24"
														>
															<path
																strokeLinecap="round"
																strokeLinejoin="round"
																strokeWidth={2}
																d="M15 19l-7-7 7-7"
															/>
														</svg>
													</motion.button>
													<h3 className="text-xs sm:text-sm font-semibold text-foreground">
														Seleziona il raggio
													</h3>
												</div>
												<div className="grid grid-cols-1 gap-4">
													{RADIUS_OPTIONS.map((opt) => (
														<motion.button
															key={opt.value}
															whileHover={{ backgroundColor: "var(--muted)" }}
															whileTap={{ scale: 0.98 }}
															onClick={() => radius.applyPreset(opt.value, opt.label)}
															className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-muted transition-all text-left"
														>
															<div className="w-10 h-10 sm:w-12 sm:h-12 bg-muted-strong rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
																📍
															</div>
															<div className="flex-1">
																<div className="font-medium text-foreground text-sm sm:text-base">
																	{opt.label}
																</div>
																<div className="text-xs sm:text-sm text-muted-foreground-subtle">
																	{opt.subtitle}
																</div>
															</div>
														</motion.button>
													))}

													{/* Custom Radius */}
													<div className="border-t pt-3 sm:pt-4 mt-2">
														<div className="p-3 sm:p-4 rounded-xl bg-muted">
															<div className="flex items-center justify-between mb-3 sm:mb-4">
																<div className="font-medium text-foreground text-sm sm:text-base">
																	Distanza personalizzata
																</div>
																<div className="text-xl sm:text-2xl font-bold text-primary">
																	{radius.custom} km
																</div>
															</div>
															<div className="mb-4">
																<input
																	type="range"
																	min="5"
																	max="200"
																	step="5"
																	value={radius.custom}
																	onChange={(e) =>
																		radius.setCustom(Number(e.target.value))
																	}
																	className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer"
																	style={{
																		background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${((radius.custom - 5) / 195) * 100}%, var(--border) ${((radius.custom - 5) / 195) * 100}%, var(--border) 100%)`,
																	}}
																/>
																<div className="flex justify-between text-xs text-muted-foreground-subtle mt-1">
																	<span>5 km</span>
																	<span>200 km</span>
																</div>
															</div>
															<motion.button
																whileHover={{ scale: 1.02 }}
																whileTap={{ scale: 0.98 }}
																onClick={radius.applyCustomDesktop}
																className="w-full px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:shadow-lg transition-all"
															>
																Applica
															</motion.button>
														</div>
													</div>
												</div>
											</motion.div>
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
													onChange={(range) =>
														setFilters((f) => ({ ...f, ...range }))
													}
												/>

												{(filters.dateFrom || filters.dateTo) && (
													<div className="mt-6 flex justify-end">
														<button
															onClick={() =>
																setFilters({
																	...filters,
																	dateFrom: null,
																	dateTo: null,
																})
															}
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
							)}
						</div>
					</div>
				</div>
			</nav>
		</>
	);
}
