"use client";
// gestori onClick e whileTap di framer-motion (D-12).

import type { Ref } from "react";
import { motion } from "framer-motion";
import { Search, ChevronLeft } from "lucide-react";
import { it } from "date-fns/locale";
import { format } from "date-fns";

interface SearchbarTriggerProps {
	// D-19: variante esplicita invece di un ramo implicito. "desktop" rende
	// esattamente il markup di sempre (nessun mock desktop esiste ancora);
	// "mobile" rende la pillola a due righe del prototipo, indipendente
	// dallo stato filtri.
	variant: "mobile" | "desktop";
	hasActiveFilters: boolean;
	location: string;
	dateFrom: Date | null;
	dateTo: Date | null;
	// D-19: solo il ramo mobile lo consuma (badge del conteggio filtri).
	// hasActiveFilters dell'hook non lo considera, serve il valore grezzo.
	radius?: number;
	onOpen: () => void;
	onClear: () => void;
	className?: string;
	// D-11 (Fase 17, piano 04): ref sul bottone "Inizia la ricerca" della
	// pillola desktop, per restituire il focus quando il pannello si chiude
	// senza filtri attivi (stato A). React 19 accetta `ref` come prop
	// normale sui componenti a funzione, nessun forwardRef da scrivere.
	ref?: Ref<HTMLButtonElement>;
}

// Pillola montata due volte da Navbar.tsx, una per superficie (D-05, Fase
// 17; D-19, Fase 12). Il ramo "desktop" e' invariato dalla Fase 17 — nessun
// mock desktop esiste ancora (D-20 bucket 4), quindi resta la pillola
// collassata "Inizia la ricerca" / riepilogo filtri a riga singola. Il ramo
// "mobile" e' la forma a due righe con badge del prototipo adottato
// (mobile-eventi.html, .searchpill), che sostituisce ENTRAMBI i vecchi rami
// mobile-only indipendentemente dallo stato filtri.
export default function SearchbarTrigger({
	variant,
	hasActiveFilters,
	location,
	dateFrom,
	dateTo,
	radius,
	onOpen,
	onClear,
	className,
	ref,
}: SearchbarTriggerProps) {
	if (variant === "mobile") {
		const dateLabel =
			dateFrom && dateTo
				? `${format(dateFrom, "d MMM", { locale: it })} – ${format(dateTo, "d MMM", { locale: it })}`
				: dateFrom
					? format(dateFrom, "d MMM", { locale: it })
					: "Qualsiasi data";
		// Il segmento "entro N km" compare SOLO se un raggio e' davvero
		// impostato (12-UI-SPEC.md D-19): dichiarare un raggio di default
		// inesistente sarebbe falso.
		const rowTwo = radius ? `${dateLabel} · entro ${radius} km` : dateLabel;
		// Badge del conteggio filtri attivi: destinazione, data d'inizio,
		// data di fine e raggio, ognuno diverso dal default (renderPill()
		// del prototipo).
		const filterCount = [location, dateFrom, dateTo, radius].filter(
			Boolean,
		).length;

		return (
			<div className={className}>
				<button
					type="button"
					onClick={onOpen}
					aria-label="Apri la ricerca"
					className="flex w-full min-h-[48px] items-center gap-3 rounded-pill bg-surface px-4 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--border-soft)] transition-colors hover:bg-border-soft active:bg-border"
				>
					<Search
						className="h-[18px] w-[18px] flex-shrink-0 text-foreground-secondary"
						aria-hidden="true"
					/>
					<span className="min-w-0 flex-1">
						<span className="block truncate text-sm font-semibold text-foreground">
							{location || "Ovunque"}
						</span>
						<span className="block truncate text-xs text-muted-foreground">
							{rowTwo}
						</span>
					</span>
					{filterCount > 0 && (
						<span className="ml-auto flex h-5 min-w-[20px] flex-shrink-0 items-center justify-center rounded-pill bg-foreground px-1.5 text-xs font-semibold text-background">
							{filterCount}
						</span>
					)}
				</button>
			</div>
		);
	}

	return (
		<div className={className}>
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
