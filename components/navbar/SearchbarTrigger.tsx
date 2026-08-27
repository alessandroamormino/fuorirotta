"use client";
// gestori onClick e whileTap di framer-motion (D-12).

import type { Ref } from "react";
import { motion } from "framer-motion";
import { Search, ChevronLeft } from "lucide-react";
import { it } from "date-fns/locale";
import { format } from "date-fns";

interface SearchbarTriggerProps {
	hasActiveFilters: boolean;
	location: string;
	dateFrom: Date | null;
	dateTo: Date | null;
	onOpen: () => void;
	onClear: () => void;
	className?: string;
	// D-11 (Fase 17, piano 04): ref sul bottone "Inizia la ricerca" della
	// pillola desktop, per restituire il focus quando il pannello si chiude
	// senza filtri attivi (stato A). React 19 accetta `ref` come prop
	// normale sui componenti a funzione, nessun forwardRef da scrivere.
	ref?: Ref<HTMLButtonElement>;
}

// Pillola condivisa fra mobile e desktop (D-05, Fase 17): "Inizia la ricerca"
// quando non ci sono filtri, altrimenti freccia indietro + riepilogo filtri.
// Nata mobile-only (spostata verbatim da Navbar.tsx, D-09 di Fase 9) e ora
// promossa — non riscritta — a unica implementazione della forma collassata,
// montata due volte da Navbar.tsx: una per superficie. Ogni chiamante decide
// a quale breakpoint mostrarsi tramite `className` (il default preserva il
// comportamento di oggi, mobile-only), e cosa succede all'apertura tramite
// `onOpen` — sul mobile apre l'overlay fullscreen (MobileSearchOverlay),
// sul desktop apre il pannello ancorato (DesktopSearchDropdown); questo
// componente non lo sa e non gli importa.
export default function SearchbarTrigger({
	hasActiveFilters,
	location,
	dateFrom,
	dateTo,
	onOpen,
	onClear,
	className,
	ref,
}: SearchbarTriggerProps) {
	return (
		<div className={className ?? "sm:hidden flex-1 min-w-0"}>
			{!hasActiveFilters ? (
				/* Nessun filtro: "Inizia la ricerca" */
				<div
					onClick={onOpen}
					className="px-4 py-4 rounded-full cursor-pointer transition-all hover:bg-surface/50"
				>
					<button
						ref={ref}
						className="flex items-center gap-2 w-full justify-center text-sm font-semibold text-foreground-secondary cursor-pointer"
					>
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
