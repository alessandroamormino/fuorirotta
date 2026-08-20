"use client";
// gestori onClick e whileTap di framer-motion (D-12).

import { motion } from "framer-motion";
import { Search, ChevronLeft } from "lucide-react";
import { it } from "date-fns/locale";
import { format } from "date-fns";

interface MobileSearchbarTriggerProps {
	hasActiveFilters: boolean;
	location: string;
	dateFrom: Date | null;
	dateTo: Date | null;
	onOpen: () => void;
	onClear: () => void;
}

// Pillola della searchbar mobile (breakpoint < sm), spostata verbatim da
// Navbar.tsx (D-09) per restare sotto le 250 righe della shell: "Inizia la
// ricerca" quando non ci sono filtri, altrimenti freccia indietro + riepilogo
// filtri. Apre sempre l'overlay fullscreen (MobileSearchOverlay), mai il
// dropdown desktop — activeField "mobile_search" e' l'unico che li discrimina.
export default function MobileSearchbarTrigger({
	hasActiveFilters,
	location,
	dateFrom,
	dateTo,
	onOpen,
	onClear,
}: MobileSearchbarTriggerProps) {
	return (
		<div className="sm:hidden flex-1 min-w-0">
			{!hasActiveFilters ? (
				/* Nessun filtro: "Inizia la ricerca" */
				<div
					onClick={onOpen}
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
						onClick={onClear}
						className="w-9 h-9 flex-shrink-0 rounded-full hover:bg-muted-strong flex items-center justify-center transition-colors"
					>
						<ChevronLeft className="w-5 h-5 text-foreground-secondary" />
					</motion.button>
					<button
						onClick={onOpen}
						className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2"
					>
						<span className="text-sm font-semibold text-foreground truncate">
							{location || "Ovunque"}
						</span>
						<span className="text-disabled-foreground font-light">·</span>
						<span className="text-sm text-muted-foreground-subtle truncate flex-shrink-0">
							{dateFrom && dateTo
								? `${format(dateFrom, "d MMM", { locale: it })} – ${format(dateTo, "d MMM", { locale: it })}`
								: dateFrom
									? format(dateFrom, "d MMM", { locale: it })
									: "Qualsiasi data"}
						</span>
					</button>
				</div>
			)}
		</div>
	);
}
