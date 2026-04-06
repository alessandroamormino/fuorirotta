"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
	Search,
	ChevronLeft,
	ChevronRight,
	ChevronDown,
	X,
	LayoutList,
	Map,
} from "lucide-react";
import { it } from "date-fns/locale";
import {
	format,
	addMonths,
	subMonths,
	startOfMonth,
	endOfMonth,
	eachDayOfInterval,
	isSameMonth,
	isSameDay,
	isToday,
	startOfWeek,
	endOfWeek,
} from "date-fns";
import Link from "next/link";
import Image from "next/image";

interface NavbarProps {
	onSearch: (filters: SearchFilters) => void;
	onOpenMap?: () => void;
}

interface SearchFilters {
	location: string;
	dateFrom: Date | null;
	dateTo: Date | null;
	radius?: number;
}

type ActiveField = "where" | "when" | "mobile_search" | null;

const SUGGESTED_DESTINATIONS = [
	{
		name: "Nelle vicinanze",
		subtitle: "Destinazioni vicine a te",
		icon: "nearby",
		isNearby: true,
	},
	{ name: "Milano", subtitle: "Capitale lombarda", icon: "city" },
	{ name: "Bergamo", subtitle: "Città alta", icon: "castle" },
	{ name: "Brescia", subtitle: "Leonessa d'Italia", icon: "monument" },
	{ name: "Como", subtitle: "Città dei laghi", icon: "lake" },
	{ name: "Cremona", subtitle: "Città dei violini", icon: "music" },
	{ name: "Lecco", subtitle: "Tra lago e montagne", icon: "mountain" },
	{ name: "Lodi", subtitle: "Città storica", icon: "castle" },
	{ name: "Mantova", subtitle: "Città d'arte", icon: "monument" },
	{ name: "Monza", subtitle: "Città della corona", icon: "city" },
	{ name: "Pavia", subtitle: "Università storica", icon: "monument" },
	{ name: "Sondrio", subtitle: "Porta della Valtellina", icon: "mountain" },
	{ name: "Varese", subtitle: "Città giardino", icon: "lake" },
];

const RADIUS_OPTIONS = [
	{ value: 10, label: "10 km", subtitle: "Vicinissimo" },
	{ value: 20, label: "20 km", subtitle: "Nelle vicinanze" },
	{ value: 50, label: "50 km", subtitle: "Zona estesa" },
];

const DEST_PREVIEW_COUNT = 3;

export default function Navbar({ onSearch, onOpenMap }: NavbarProps) {
	const [activeField, setActiveField] = useState<ActiveField | null>(null);
	const [filters, setFilters] = useState<SearchFilters>({
		location: "",
		dateFrom: null,
		dateTo: null,
	});
	const [currentMonth, setCurrentMonth] = useState(new Date());
	const [hoveredDate, setHoveredDate] = useState<Date | null>(null);
	const searchBarRef = useRef<HTMLDivElement>(null);
	const activeFieldRef = useRef<ActiveField | null>(null);
	const [searchInput, setSearchInput] = useState("");
	const [showRadiusSelector, setShowRadiusSelector] = useState(false);
	const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
	const [customRadius, setCustomRadius] = useState(30);
	const [isNearbySearch, setIsNearbySearch] = useState(false);

	// Mobile overlay state
	const [mobileSearchInput, setMobileSearchInput] = useState("");
	const [mobileDestExpanded, setMobileDestExpanded] = useState(false);
	const [mobileWhenOpen, setMobileWhenOpen] = useState(false);
	const [mobileNearbyOpen, setMobileNearbyOpen] = useState(false);
	const [mobileCustomRadius, setMobileCustomRadius] = useState(20);

	// Sincronizza il ref con lo state (il listener mousedown ha closure stale)
	useEffect(() => {
		activeFieldRef.current = activeField;
	}, [activeField]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			// Non chiudere mai se il mobile overlay è aperto
			if (activeFieldRef.current === "mobile_search") return;
			if (
				searchBarRef.current &&
				!searchBarRef.current.contains(event.target as Node)
			) {
				setActiveField(null);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	// Blocca scroll body quando overlay mobile è aperto
	useEffect(() => {
		if (activeField === "mobile_search") {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [activeField]);

	const handleSearch = () => {
		onSearch({ ...filters, radius: selectedRadius || undefined });
		setActiveField(null);
	};

	const handleMobileSearch = () => {
		onSearch({ ...filters, radius: selectedRadius || undefined });
		setActiveField(null);
		setMobileDestExpanded(false);
		setMobileWhenOpen(false);
	};

	const capitalizeFirstLetter = (str: string) => {
		if (!str) return str;
		return str.charAt(0).toUpperCase() + str.slice(1);
	};

	const handleClearSearch = () => {
		setFilters({
			location: "",
			dateFrom: null,
			dateTo: null,
			radius: undefined,
		});
		setSearchInput("");
		setMobileSearchInput("");
		setSelectedRadius(null);
		setIsNearbySearch(false);
		setActiveField(null);
		onSearch({ location: "", dateFrom: null, dateTo: null, radius: undefined });
	};

	const handleMobileClear = () => {
		setFilters({
			location: "",
			dateFrom: null,
			dateTo: null,
			radius: undefined,
		});
		setMobileSearchInput("");
		setSelectedRadius(null);
		setIsNearbySearch(false);
		setMobileDestExpanded(false);
		setMobileWhenOpen(false);
	};

	const handleDateSelect = (date: Date) => {
		if (!filters.dateFrom || (filters.dateFrom && filters.dateTo)) {
			setFilters({ ...filters, dateFrom: date, dateTo: null });
		} else {
			if (date < filters.dateFrom) {
				setFilters({ ...filters, dateFrom: date, dateTo: filters.dateFrom });
			} else {
				setFilters({ ...filters, dateTo: date });
			}
		}
	};

	const isDateInRange = (date: Date) => {
		if (!filters.dateFrom) return false;
		if (!filters.dateTo && !hoveredDate)
			return isSameDay(date, filters.dateFrom);
		const endDate = filters.dateTo || hoveredDate;
		if (!endDate) return isSameDay(date, filters.dateFrom);
		return date >= filters.dateFrom && date <= endDate;
	};

	const isDateRangeStart = (date: Date) =>
		!!(filters.dateFrom && isSameDay(date, filters.dateFrom));
	const isDateRangeEnd = (date: Date) =>
		!!(filters.dateTo && isSameDay(date, filters.dateTo));

	const getDaysInMonth = (month: Date) => {
		const start = startOfWeek(startOfMonth(month), { locale: it });
		const end = endOfWeek(endOfMonth(month), { locale: it });
		return eachDayOfInterval({ start, end });
	};

	const getIconForDestination = (iconType: string) => {
		switch (iconType) {
			case "nearby":
				return "📍";
			case "city":
				return "🏙️";
			case "castle":
				return "🏰";
			case "lake":
				return "🏞️";
			case "monument":
				return "🏛️";
			case "music":
				return "🎵";
			case "mountain":
				return "⛰️";
			default:
				return "📍";
		}
	};

	const hasActiveFilters =
		filters.location || filters.dateFrom || filters.dateTo;

	const renderCalendarGrid = (month: Date) => {
		const days = getDaysInMonth(month);
		return (
			<div className="grid grid-cols-7 gap-0.5">
				{["L", "M", "M", "G", "V", "S", "D"].map((day, i) => (
					<div
						key={i}
						className="text-center text-[10px] font-semibold text-gray-400 py-2"
					>
						{day}
					</div>
				))}
				{days.map((date, i) => {
					const inRange = isDateInRange(date);
					const isStart = isDateRangeStart(date);
					const isEnd = isDateRangeEnd(date);
					const isCurrentMonth = isSameMonth(date, month);
					const isPast = date < new Date() && !isToday(date);

					return (
						<motion.button
							key={i}
							whileHover={isCurrentMonth && !isPast ? { scale: 1.1 } : {}}
							onClick={() =>
								isCurrentMonth && !isPast && handleDateSelect(date)
							}
							onMouseEnter={() =>
								isCurrentMonth && !isPast && setHoveredDate(date)
							}
							onMouseLeave={() => setHoveredDate(null)}
							disabled={!isCurrentMonth || isPast}
							className={`
                aspect-square flex items-center justify-center text-sm rounded-full transition-all
                ${!isCurrentMonth ? "text-gray-200" : ""}
                ${isPast ? "text-gray-300 cursor-not-allowed" : ""}
                ${isStart || isEnd ? "bg-gradient-to-r from-[#006d77] to-[#83c5be] text-white font-bold" : ""}
                ${inRange && !isStart && !isEnd ? "bg-[#006d77]/10" : ""}
                ${!inRange && !isPast && isCurrentMonth ? "hover:bg-gray-100" : ""}
                ${isToday(date) && !isStart && !isEnd ? "border-2 border-[#006d77]" : ""}
              `}
						>
							{format(date, "d")}
						</motion.button>
					);
				})}
			</div>
		);
	};

	const filteredDestinations = mobileSearchInput.trim()
		? SUGGESTED_DESTINATIONS.filter((d) =>
				d.name.toLowerCase().includes(mobileSearchInput.toLowerCase()),
			)
		: SUGGESTED_DESTINATIONS;

	const visibleDestinations = mobileSearchInput.trim()
		? filteredDestinations
		: mobileDestExpanded
			? SUGGESTED_DESTINATIONS
			: SUGGESTED_DESTINATIONS.slice(0, DEST_PREVIEW_COUNT);

	return (
		<>
			{/* ── MOBILE FULLSCREEN OVERLAY ── */}
			<AnimatePresence>
				{activeField === "mobile_search" && (
					<motion.div
						key="mobile-overlay"
						initial={{ opacity: 0, y: "-100%" }}
						animate={{ opacity: 1, y: 0 }}
						exit={{ opacity: 0, y: "-100%" }}
						transition={{ type: "spring", damping: 30, stiffness: 300 }}
						data-mobile-overlay="true"
						className="fixed inset-0 z-[200] bg-gray-50 flex flex-col sm:hidden"
					>
						{/* Header */}
						<div
							className="flex items-center px-5 pb-4 bg-gray-50 relative"
							style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
						>
							{/* Logo a sinistra */}
							<div className="flex-1 flex items-center">
								<Link
									href="/"
									onClick={() => {
										setActiveField(null);
										setMobileDestExpanded(false);
										setMobileWhenOpen(false);
									}}
								>
									<div className="flex items-center gap-2">
										<Image
											src="/images/logo.svg"
											alt="Fuorirotta"
											width={32}
											height={32}
											className="w-8 h-8"
										/>
										<span className="text-base font-bold text-[#006d77]">
											Fuorirotta
										</span>
									</div>
								</Link>
							</div>
							<div className="flex-1 flex justify-end gap-2">
								<motion.button
									whileTap={{ scale: 0.9 }}
									onClick={() => {
										setActiveField(null);
										setMobileDestExpanded(false);
										setMobileWhenOpen(false);
									}}
									className="w-11 h-11 rounded-full bg-white shadow flex items-center justify-center"
									title="Lista"
								>
									<LayoutList className="w-5 h-5 text-gray-600" />
								</motion.button>
								<motion.button
									whileTap={{ scale: 0.9 }}
									onClick={() => {
										setActiveField(null);
										setMobileDestExpanded(false);
										setMobileWhenOpen(false);
										onOpenMap?.();
									}}
									className="w-11 h-11 rounded-full bg-white shadow flex items-center justify-center"
									title="Mappa"
								>
									<Map className="w-5 h-5 text-gray-600" />
								</motion.button>
								<motion.button
									whileTap={{ scale: 0.9 }}
									onClick={() => {
										setActiveField(null);
										setMobileDestExpanded(false);
										setMobileWhenOpen(false);
									}}
									className="w-11 h-11 rounded-full bg-white shadow flex items-center justify-center"
								>
									<X className="w-5 h-5 text-gray-700" />
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
									<div className="bg-white rounded-2xl shadow-sm p-5 mb-3">
										<AnimatePresence mode="wait" initial={false}>
											{!mobileNearbyOpen ? (
												<motion.div
													key="dove-normal"
													initial={{ opacity: 0, x: -16 }}
													animate={{ opacity: 1, x: 0 }}
													exit={{ opacity: 0, x: -16 }}
													transition={{ duration: 0.2 }}
												>
													<h2 className="text-2xl font-bold text-gray-900 mb-4">
														Dove?
													</h2>
													<div className="flex items-center gap-3 border border-gray-200 rounded-xl px-4 py-3 mb-5">
														<Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
														<input
															autoFocus
															type="text"
															placeholder="Cerca destinazioni"
															value={mobileSearchInput}
															onChange={(e) => {
																const value = capitalizeFirstLetter(
																	e.target.value,
																);
																setMobileSearchInput(value);
																setFilters({ ...filters, location: value });
																setIsNearbySearch(false);
																setSelectedRadius(null);
															}}
															className="flex-1 text-sm outline-none bg-transparent placeholder-gray-400 text-gray-700"
														/>
													</div>

													<p className="text-xs font-semibold text-gray-500 mb-3">
														{mobileSearchInput.trim()
															? "Risultati"
															: "Destinazioni suggerite"}
													</p>

													{/* Lista con altezza max + scroll — "Quando" rimane sempre visibile */}
													<div className="overflow-y-auto max-h-[45vh] grid grid-cols-1 gap-1">
														{visibleDestinations.length > 0 ? (
															visibleDestinations.map((dest) => (
																<motion.button
																	key={dest.name}
																	whileTap={{ scale: 0.98 }}
																	onClick={() => {
																		if (dest.isNearby) {
																			setMobileNearbyOpen(true);
																		} else {
																			setMobileSearchInput(dest.name);
																			setFilters({
																				...filters,
																				location: dest.name,
																			});
																			setIsNearbySearch(false);
																			setSelectedRadius(null);
																			setMobileWhenOpen(true);
																		}
																	}}
																	className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-all text-left"
																>
																	<div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl flex-shrink-0">
																		{getIconForDestination(dest.icon)}
																	</div>
																	<div className="flex-1 min-w-0">
																		<div className="font-medium text-gray-900 text-sm truncate">
																			{dest.name}
																		</div>
																		<div className="text-xs text-gray-500 truncate">
																			{dest.subtitle}
																		</div>
																	</div>
																</motion.button>
															))
														) : (
															/* Nessun risultato → "Cerca città: xxx" */
															<motion.button
																whileTap={{ scale: 0.98 }}
																onClick={() => {
																	setFilters({
																		...filters,
																		location: mobileSearchInput,
																	});
																	setMobileWhenOpen(true);
																}}
																className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 transition-all text-left"
															>
																<div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-xl flex-shrink-0">
																	<Search className="w-4 h-4 text-gray-500" />
																</div>
																<div className="flex-1 min-w-0">
																	<div className="font-medium text-gray-900 text-sm">
																		Cerca città:{" "}
																		<span className="text-[#006d77]">
																			{mobileSearchInput}
																		</span>
																	</div>
																	<div className="text-xs text-gray-500">
																		Cerca eventi in questa zona
																	</div>
																</div>
															</motion.button>
														)}
													</div>

													{/* Mostra tutte / meno — solo se non si sta cercando */}
													{!mobileSearchInput.trim() &&
														!mobileDestExpanded &&
														SUGGESTED_DESTINATIONS.length >
															DEST_PREVIEW_COUNT && (
															<motion.button
																whileTap={{ scale: 0.97 }}
																onClick={() => setMobileDestExpanded(true)}
																className="mt-3 w-full flex items-center justify-center gap-1 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors"
															>
																<ChevronDown className="w-4 h-4" />
																Mostra più destinazioni
															</motion.button>
														)}
													{!mobileSearchInput.trim() && mobileDestExpanded && (
														<motion.button
															whileTap={{ scale: 0.97 }}
															onClick={() => setMobileDestExpanded(false)}
															className="mt-3 w-full flex items-center justify-center gap-1 py-2 text-sm font-semibold text-gray-500 hover:text-gray-800 transition-colors"
														>
															<ChevronDown className="w-4 h-4 rotate-180" />
															Mostra meno
														</motion.button>
													)}
												</motion.div>
											) : (
												<motion.div
													key="dove-nearby"
													initial={{ opacity: 0, x: 16 }}
													animate={{ opacity: 1, x: 0 }}
													exit={{ opacity: 0, x: 16 }}
													transition={{ duration: 0.2 }}
												>
													{/* Header con back */}
													<div className="flex items-center gap-3 mb-6">
														<motion.button
															whileTap={{ scale: 0.9 }}
															onClick={() => setMobileNearbyOpen(false)}
															className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
														>
															<ChevronLeft className="w-5 h-5 text-gray-600" />
														</motion.button>
														<h2 className="text-2xl font-bold text-gray-900">
															Nelle vicinanze
														</h2>
													</div>

													{/* Opzioni predefinite */}
													<div className="grid grid-cols-1 gap-2 mb-5">
														{RADIUS_OPTIONS.map((r) => (
															<motion.button
																key={r.value}
																whileTap={{ scale: 0.98 }}
																onClick={() => setMobileCustomRadius(r.value)}
																className={`flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all ${
																	mobileCustomRadius === r.value
																		? "border-[#006d77] bg-[#006d77]/5"
																		: "border-gray-100 hover:border-gray-200"
																}`}
															>
																<div className="text-left">
																	<div className="font-semibold text-gray-900 text-sm">
																		{r.label}
																	</div>
																	<div className="text-xs text-gray-500">
																		{r.subtitle}
																	</div>
																</div>
																{mobileCustomRadius === r.value && (
																	<div className="w-5 h-5 rounded-full bg-[#006d77] flex items-center justify-center">
																		<svg
																			className="w-3 h-3 text-white"
																			fill="none"
																			viewBox="0 0 24 24"
																			stroke="currentColor"
																		>
																			<path
																				strokeLinecap="round"
																				strokeLinejoin="round"
																				strokeWidth={3}
																				d="M5 13l4 4L19 7"
																			/>
																		</svg>
																	</div>
																)}
															</motion.button>
														))}
													</div>

													{/* Slider personalizzato */}
													<div className="bg-gray-50 rounded-xl p-4 mb-6">
														<div className="flex items-center justify-between mb-3">
															<span className="text-sm font-medium text-gray-700">
																Distanza personalizzata
															</span>
															<span className="text-base font-bold text-[#006d77]">
																{mobileCustomRadius} km
															</span>
														</div>
														<input
															type="range"
															min="5"
															max="200"
															step="5"
															value={mobileCustomRadius}
															onChange={(e) =>
																setMobileCustomRadius(Number(e.target.value))
															}
															className="w-full h-2 rounded-lg appearance-none cursor-pointer"
															style={{
																background: `linear-gradient(to right, #006d77 0%, #006d77 ${((mobileCustomRadius - 5) / 195) * 100}%, #e5e7eb ${((mobileCustomRadius - 5) / 195) * 100}%, #e5e7eb 100%)`,
															}}
														/>
														<div className="flex justify-between text-xs text-gray-400 mt-1">
															<span>5 km</span>
															<span>200 km</span>
														</div>
													</div>

													{/* Conferma */}
													<motion.button
														whileHover={{ scale: 1.02 }}
														whileTap={{ scale: 0.97 }}
														onClick={() => {
															const label = `Nelle vicinanze (${mobileCustomRadius} km)`;
															setMobileSearchInput(label);
															setFilters({
																...filters,
																location: label,
																radius: mobileCustomRadius,
															});
															setSelectedRadius(mobileCustomRadius);
															setIsNearbySearch(true);
															setMobileNearbyOpen(false);
															setMobileWhenOpen(true);
														}}
														className="w-full py-3 bg-[#006d77] hover:bg-[#00565e] text-white font-semibold rounded-xl transition-colors"
													>
														Conferma
													</motion.button>
												</motion.div>
											)}
										</AnimatePresence>
									</div>

									{/* BOX QUANDO collassato */}
									<button
										onClick={() => setMobileWhenOpen(true)}
										className="w-full bg-white rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between text-left mb-3"
									>
										<span className="text-sm text-gray-400 font-medium">
											Quando
										</span>
										<span className="text-sm font-semibold text-gray-900">
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
											className="w-full bg-white rounded-2xl shadow-sm px-5 py-4 flex items-center justify-between text-left"
										>
											<span className="text-sm text-gray-400 font-medium">
												Dove
											</span>
											<span className="text-sm font-semibold text-gray-900 truncate max-w-[200px]">
												{filters.location || "Sono flessibile"}
											</span>
										</button>
									</div>

									{/* Box calendario: header fisso + mesi scrollabili */}
									<div className="flex-1 overflow-hidden mx-4 mb-32 bg-white rounded-2xl shadow-sm flex flex-col">
										{/* Header fisso "Quando?" */}
										<div className="px-5 pt-5 pb-3 flex-shrink-0">
											<h2 className="text-2xl font-bold text-gray-900">
												Quando?
											</h2>
											{/* Intestazione giorni settimana fissa */}
											<div className="grid grid-cols-7 gap-0.5 mt-4">
												{["L", "M", "M", "G", "V", "S", "D"].map((day, i) => (
													<div
														key={i}
														className="text-center text-[10px] font-semibold text-gray-400 py-1"
													>
														{day}
													</div>
												))}
											</div>
										</div>

										{/* Mesi scrollabili */}
										<div className="flex-1 overflow-y-auto px-5 pb-5">
											{[0, 1, 2].map((offset) => {
												const month = addMonths(currentMonth, offset);
												const days = getDaysInMonth(month);
												return (
													<div key={offset} className="mb-6">
														<h3 className="font-bold text-gray-900 text-base mb-3">
															{format(month, "MMMM yyyy", { locale: it })}
														</h3>
														<div className="grid grid-cols-7 gap-0.5">
															{days.map((date, i) => {
																const inRange = isDateInRange(date);
																const isStart = isDateRangeStart(date);
																const isEnd = isDateRangeEnd(date);
																const isCurrentMonth = isSameMonth(date, month);
																const isPast =
																	date < new Date() && !isToday(date);
																return (
																	<motion.button
																		key={i}
																		whileHover={
																			isCurrentMonth && !isPast
																				? { scale: 1.1 }
																				: {}
																		}
																		onClick={() =>
																			isCurrentMonth &&
																			!isPast &&
																			handleDateSelect(date)
																		}
																		onMouseEnter={() =>
																			isCurrentMonth &&
																			!isPast &&
																			setHoveredDate(date)
																		}
																		onMouseLeave={() => setHoveredDate(null)}
																		disabled={!isCurrentMonth || isPast}
																		className={`
																			aspect-square flex items-center justify-center text-sm rounded-full transition-all
																			${!isCurrentMonth ? "text-gray-200" : ""}
																			${isPast ? "text-gray-300 cursor-not-allowed" : ""}
																			${isStart || isEnd ? "bg-gradient-to-r from-[#006d77] to-[#83c5be] text-white font-bold" : ""}
																			${inRange && !isStart && !isEnd ? "bg-[#006d77]/10" : ""}
																			${!inRange && !isPast && isCurrentMonth ? "hover:bg-gray-100" : ""}
																			${isToday(date) && !isStart && !isEnd ? "border-2 border-[#006d77]" : ""}
																		`}
																	>
																		{format(date, "d")}
																	</motion.button>
																);
															})}
														</div>
													</div>
												);
											})}
										</div>
									</div>
								</motion.div>
							)}
						</AnimatePresence>

						{/* Footer fisso */}
						<div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-5 py-4 flex items-center justify-between gap-4 sm:hidden">
							<motion.button
								whileTap={{ scale: 0.96 }}
								onClick={handleMobileClear}
								className="text-sm font-semibold text-gray-700 underline underline-offset-2"
							>
								Cancella tutto
							</motion.button>
							<motion.button
								whileHover={{ scale: 1.02 }}
								whileTap={{ scale: 0.97 }}
								onClick={handleMobileSearch}
								className="flex items-center gap-2 px-6 py-3 bg-[#006d77] hover:bg-[#00565e] text-white font-semibold rounded-full transition-colors shadow-lg"
							>
								<Search className="w-4 h-4" />
								Cerca
							</motion.button>
						</div>
					</motion.div>
				)}
			</AnimatePresence>

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
									/>
									<span className="hidden xl:block text-2xl font-bold text-[#006d77]">
										Fuorirotta
									</span>
								</motion.div>
							</Link>
						</div>

						{/* Search Bar */}
						<div ref={searchBarRef} className="w-full max-w-3xl relative">
							<div className="w-full flex items-center bg-white/90 backdrop-blur-md border border-white/40 rounded-full shadow-lg hover:shadow-xl transition-all px-2 relative">
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
											className="px-4 py-4 rounded-full cursor-pointer transition-all hover:bg-white/50"
										>
											<button className="flex items-center gap-2 w-full justify-center text-sm font-semibold text-gray-700 cursor-pointer">
												<Search className="w-4 h-4" />
												<span>Inizia la ricerca</span>
											</button>
										</div>
									) : (
										/* Filtri attivi: ← fuori + pill centrata */
										<div className="flex items-center gap-2 px-2 py-2 min-w-0">
											<motion.button
												whileTap={{ scale: 0.9 }}
												onClick={handleClearSearch}
												className="w-9 h-9 flex-shrink-0 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
											>
												<ChevronLeft className="w-5 h-5 text-gray-700" />
											</motion.button>
											<button
												onClick={() => {
													setMobileDestExpanded(false);
													setMobileWhenOpen(false);
													setActiveField("mobile_search");
												}}
												className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2"
											>
												<span className="text-sm font-semibold text-gray-900 truncate">
													{filters.location || "Ovunque"}
												</span>
												<span className="text-gray-300 font-light">·</span>
												<span className="text-sm text-gray-500 truncate flex-shrink-0">
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
										className="px-4 sm:px-6 py-2 sm:py-3 rounded-full cursor-pointer transition-all hover:bg-white/50"
									>
										<label className="text-[10px] sm:text-xs font-semibold text-gray-900 block mb-0.5">
											Dove
										</label>
										<input
											type="text"
											placeholder="Cerca destinazioni"
											value={searchInput}
											onChange={(e) => {
												const value = capitalizeFirstLetter(e.target.value);
												setSearchInput(value);
												setFilters({ ...filters, location: value });
												if (isNearbySearch) {
													setIsNearbySearch(false);
													setSelectedRadius(null);
												}
											}}
											className={`w-full text-xs sm:text-sm outline-none bg-transparent placeholder-gray-400 ${
												isNearbySearch
													? "text-gray-900 cursor-not-allowed font-medium"
													: "text-gray-700"
											}`}
											onFocus={() => setActiveField("where")}
											readOnly={isNearbySearch}
										/>
									</div>
									{activeField === "where" && (
										<motion.div
											layoutId="activeRing"
											className="absolute inset-x-0 top-2 bottom-2 rounded-full bg-[#006d77]/5 pointer-events-none"
											transition={{
												type: "spring",
												stiffness: 500,
												damping: 40,
											}}
										/>
									)}
								</div>

								<div className="hidden sm:block w-px h-8 bg-white/30" />

								{/* Desktop: When Field */}
								<div className="hidden sm:block flex-1 relative">
									<div
										onClick={() => setActiveField("when")}
										className="px-4 sm:px-6 py-2 sm:py-3 rounded-full cursor-pointer transition-all hover:bg-white/50"
									>
										<label className="text-[10px] sm:text-xs font-semibold text-gray-900 block mb-0.5">
											Date
										</label>
										<div className="text-xs sm:text-sm text-gray-400 truncate">
											{filters.dateFrom && filters.dateTo
												? `${format(filters.dateFrom, "d MMM", { locale: it })} - ${format(filters.dateTo, "d MMM", { locale: it })}`
												: "Aggiungi date"}
										</div>
									</div>
									{activeField === "when" && (
										<motion.div
											layoutId="activeRing"
											className="absolute inset-x-0 top-2 bottom-2 rounded-full bg-[#006d77]/5 pointer-events-none"
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
											onClick={handleClearSearch}
											className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
										>
											Cancella
										</motion.button>
									)}
									<motion.button
										whileHover={{ scale: 1.05 }}
										whileTap={{ scale: 0.95 }}
										onClick={handleSearch}
										className="w-12 h-12 bg-[#006d77] hover:bg-[#00565e] rounded-full flex items-center justify-center transition-colors"
									>
										<Search className="w-5 h-5 text-white" />
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
									className={`absolute top-full mt-4 bg-white/95 backdrop-blur-md rounded-3xl shadow-2xl border border-white/30 overflow-hidden
                    ${
											activeField === "where"
												? "left-0 right-0 sm:left-0 sm:right-auto sm:w-[500px]"
												: "left-0 right-0 sm:left-auto sm:right-0 sm:w-[700px]"
										}`}
								>
									<AnimatePresence mode="wait">
										{/* Where Dropdown */}
										{activeField === "where" && !showRadiusSelector && (
											<motion.div
												key="where"
												initial={{ opacity: 0, x: -20 }}
												animate={{ opacity: 1, x: 0 }}
												exit={{ opacity: 0, x: -20 }}
												transition={{ duration: 0.2 }}
												className="p-4 sm:p-8"
											>
												<h3 className="text-xs sm:text-sm font-semibold text-gray-900 mb-4 sm:mb-6">
													Destinazioni suggerite
												</h3>
												<div className="grid grid-cols-1 gap-4 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin">
													{SUGGESTED_DESTINATIONS.map((dest) => (
														<motion.button
															key={dest.name}
															whileHover={{ backgroundColor: "#f7f7f7" }}
															whileTap={{ scale: 0.98 }}
															onClick={() => {
																if (dest.isNearby) {
																	setShowRadiusSelector(true);
																} else {
																	setSearchInput(dest.name);
																	setFilters({
																		...filters,
																		location: dest.name,
																	});
																	setIsNearbySearch(false);
																	setSelectedRadius(null);
																	setActiveField("when");
																}
															}}
															className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-gray-50 transition-all text-left"
														>
															<div className="w-10 h-10 sm:w-12 sm:h-12 bg-gray-100 rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
																{getIconForDestination(dest.icon)}
															</div>
															<div className="flex-1 min-w-0">
																<div className="font-medium text-gray-900 text-sm sm:text-base truncate">
																	{dest.name}
																</div>
																<div className="text-xs sm:text-sm text-gray-500 truncate">
																	{dest.subtitle}
																</div>
															</div>
														</motion.button>
													))}
												</div>
											</motion.div>
										)}

										{/* Radius Selector */}
										{activeField === "where" && showRadiusSelector && (
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
														onClick={() => setShowRadiusSelector(false)}
														whileHover={{ scale: 1.05 }}
														whileTap={{ scale: 0.95 }}
														className="w-7 h-7 sm:w-8 sm:h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
													>
														<svg
															className="w-4 h-4 sm:w-5 sm:h-5 text-gray-600"
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
													<h3 className="text-xs sm:text-sm font-semibold text-gray-900">
														Seleziona il raggio
													</h3>
												</div>
												<div className="grid grid-cols-1 gap-4">
													{RADIUS_OPTIONS.map((radius) => (
														<motion.button
															key={radius.value}
															whileHover={{ backgroundColor: "#f7f7f7" }}
															whileTap={{ scale: 0.98 }}
															onClick={() => {
																setSelectedRadius(radius.value);
																setSearchInput(
																	`Nelle vicinanze (${radius.label})`,
																);
																setFilters({
																	...filters,
																	location: `Nelle vicinanze (${radius.label})`,
																	radius: radius.value,
																});
																setIsNearbySearch(true);
																setShowRadiusSelector(false);
																setActiveField("when");
															}}
															className="flex items-center gap-3 sm:gap-4 p-2 sm:p-3 rounded-xl hover:bg-gray-50 transition-all text-left"
														>
															<div className="w-10 h-10 sm:w-12 sm:h-12 bg-gray-100 rounded-lg flex items-center justify-center text-xl sm:text-2xl flex-shrink-0">
																📍
															</div>
															<div className="flex-1">
																<div className="font-medium text-gray-900 text-sm sm:text-base">
																	{radius.label}
																</div>
																<div className="text-xs sm:text-sm text-gray-500">
																	{radius.subtitle}
																</div>
															</div>
														</motion.button>
													))}

													{/* Custom Radius */}
													<div className="border-t pt-3 sm:pt-4 mt-2">
														<div className="p-3 sm:p-4 rounded-xl bg-gray-50">
															<div className="flex items-center justify-between mb-3 sm:mb-4">
																<div className="font-medium text-gray-900 text-sm sm:text-base">
																	Distanza personalizzata
																</div>
																<div className="text-xl sm:text-2xl font-bold text-[#006d77]">
																	{customRadius} km
																</div>
															</div>
															<div className="mb-4">
																<input
																	type="range"
																	min="5"
																	max="200"
																	step="5"
																	value={customRadius}
																	onChange={(e) =>
																		setCustomRadius(Number(e.target.value))
																	}
																	className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
																	style={{
																		background: `linear-gradient(to right, #006d77 0%, #006d77 ${((customRadius - 5) / 195) * 100}%, #e5e7eb ${((customRadius - 5) / 195) * 100}%, #e5e7eb 100%)`,
																	}}
																/>
																<div className="flex justify-between text-xs text-gray-500 mt-1">
																	<span>5 km</span>
																	<span>200 km</span>
																</div>
															</div>
															<motion.button
																whileHover={{ scale: 1.02 }}
																whileTap={{ scale: 0.98 }}
																onClick={() => {
																	setSelectedRadius(customRadius);
																	setSearchInput(
																		`Nelle vicinanze (${customRadius} km)`,
																	);
																	setFilters({
																		...filters,
																		location: `Nelle vicinanze (${customRadius} km)`,
																		radius: customRadius,
																	});
																	setIsNearbySearch(true);
																	setShowRadiusSelector(false);
																	setActiveField("when");
																}}
																className="w-full px-4 py-2 bg-gradient-to-r from-[#006d77] to-[#83c5be] text-white font-semibold rounded-lg hover:shadow-lg transition-all"
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
												<div className="flex gap-8">
													{/* Month 1 */}
													<div className="flex-1">
														<div className="flex items-center justify-between mb-4">
															<button
																onClick={() =>
																	setCurrentMonth(subMonths(currentMonth, 1))
																}
																className="p-2 hover:bg-gray-100 rounded-full transition-colors"
															>
																<ChevronLeft className="w-5 h-5" />
															</button>
															<h3 className="font-bold text-gray-900 text-base">
																{format(currentMonth, "MMMM yyyy", {
																	locale: it,
																})}
															</h3>
															<div className="w-9" />
														</div>
														{renderCalendarGrid(currentMonth)}
													</div>

													{/* Month 2 */}
													<div className="flex-1">
														<div className="flex items-center justify-between mb-4">
															<div className="w-9" />
															<h3 className="font-bold text-gray-900 text-base">
																{format(
																	addMonths(currentMonth, 1),
																	"MMMM yyyy",
																	{ locale: it },
																)}
															</h3>
															<button
																onClick={() =>
																	setCurrentMonth(addMonths(currentMonth, 1))
																}
																className="p-2 hover:bg-gray-100 rounded-full transition-colors"
															>
																<ChevronRight className="w-5 h-5" />
															</button>
														</div>
														{renderCalendarGrid(addMonths(currentMonth, 1))}
													</div>
												</div>

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
															className="text-sm font-semibold text-gray-600 hover:text-gray-900 underline"
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
