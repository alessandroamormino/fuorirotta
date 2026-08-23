"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CANONICAL_CATEGORIES } from "@/lib/categories/taxonomy";

interface CategoryFilterBarProps {
	categories: { name: string; count: number }[];
	selected: string;
	onSelect: (value: string) => void;
}

interface ChipData {
	name: string;
	count?: number;
}

interface ChipItem {
	value: string;
	label: string;
	count?: number;
}

const ALL_VALUE = "all";

// Stesso idioma di components/ui/Button.tsx: lookup a Record, nessun colore
// scritto a mano (npm run check:tokens fallisce la build sugli esadecimali).
const chipVariantClasses: Record<"selected" | "unselected", string> = {
	selected: "bg-primary text-primary-foreground font-semibold",
	unselected: "bg-muted-strong text-foreground-secondary border border-border",
};

export default function CategoryFilterBar({
	categories,
	selected,
	onSelect,
}: CategoryFilterBarProps) {
	// Backstop UI-SPEC category-filter/error: quando /api/categories fallisce
	// `categories` arriva vuoto. Si degrada ai 7 nomi canonici senza count
	// invece di far sparire la riga di filtro — il chip Altro non deve mai
	// scomparire, nemmeno quando la faccetta non risponde (D-11).
	const chips: ChipData[] = useMemo(
		() =>
			categories.length > 0
				? categories
				: CANONICAL_CATEGORIES.map((name) => ({ name })),
		[categories]
	);

	// Un solo array, un solo `.map()` piu' sotto: "Tutte" e le categorie
	// condividono lo stesso markup di chip, renderizzate nell'ordine ricevuto
	// (il server ha gia' applicato orderCategories, il client non riordina mai).
	const items: ChipItem[] = useMemo(
		() => [
			{ value: ALL_VALUE, label: "Tutte" },
			...chips.map((c) => ({ value: c.name, label: c.name, count: c.count })),
		],
		[chips]
	);

	const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const activeIndex = useMemo(() => {
		const idx = items.findIndex((item) => item.value === selected);
		return idx === -1 ? 0 : idx;
	}, [items, selected]);

	// Tabstop roving: segue la chip selezionata dall'esterno, ma la navigazione
	// da tastiera (frecce/Home/End) sposta solo il focus, non la selezione
	// (comportamento dichiarato in 11-UI-SPEC.md), quindi serve uno stato
	// locale separato dalla prop `selected` per tracciare quale chip e' nel
	// tab order in questo momento.
	//
	// WR-03: tracciato per `value` (identita' del chip), non per indice
	// numerico di posizione. `items` puo' riordinarsi fra un fetch e l'altro
	// (fallback su CANONICAL_CATEGORIES prima della risposta di /api/categories,
	// poi ordine reale di orderCategories()): un indice memorizzato punterebbe
	// alla posizione sbagliata dopo un riordino che non cambia pero' la
	// selezione (l'unico caso in cui l'effect sotto si risincronizza).
	const [focusedValue, setFocusedValue] = useState(items[activeIndex]?.value);

	useEffect(() => {
		setFocusedValue(items[activeIndex]?.value);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [activeIndex]);

	const focusedIndexRaw = items.findIndex((item) => item.value === focusedValue);
	// Se il chip a fuoco e' sparito (es. cambio di elenco categorie), ricadi
	// sulla chip selezionata invece di un tabIndex tutto a -1.
	const focusedIndex = focusedIndexRaw === -1 ? activeIndex : focusedIndexRaw;

	const focusChip = (index: number) => {
		setFocusedValue(items[index]?.value);
		chipRefs.current[index]?.focus();
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const lastIndex = items.length - 1;
		switch (event.key) {
			case "ArrowRight":
				event.preventDefault();
				focusChip(focusedIndex === lastIndex ? 0 : focusedIndex + 1);
				break;
			case "ArrowLeft":
				event.preventDefault();
				focusChip(focusedIndex === 0 ? lastIndex : focusedIndex - 1);
				break;
			case "Home":
				event.preventDefault();
				focusChip(0);
				break;
			case "End":
				event.preventDefault();
				focusChip(lastIndex);
				break;
			default:
				break;
		}
	};

	return (
		<div
			role="radiogroup"
			aria-label="Filtra per categoria"
			className="flex gap-2 overflow-x-auto scrollbar-hide"
			onKeyDown={handleKeyDown}
		>
			{items.map((item, index) => {
				const isSelected = item.value === selected;
				return (
					<button
						key={item.value}
						ref={(el) => {
							chipRefs.current[index] = el;
						}}
						type="button"
						role="radio"
						aria-checked={isSelected}
						tabIndex={focusedIndex === index ? 0 : -1}
						onClick={() => onSelect(item.value)}
						className={cn(
							"h-10 px-4 rounded-full shrink-0 whitespace-nowrap inline-flex items-center gap-1 text-sm transition-colors",
							isSelected ? chipVariantClasses.selected : chipVariantClasses.unselected
						)}
					>
						<span>{item.label}</span>
						{/* Tutte non porta mai count (evitrebbe un secondo totale da un
						    secondo endpoint che potrebbe non concordare col primo).
						    count === 0 si renderizza identico a un count non-zero (D-11). */}
						{item.count !== undefined && (
							<span className="opacity-75">{item.count}</span>
						)}
					</button>
				);
			})}
		</div>
	);
}
