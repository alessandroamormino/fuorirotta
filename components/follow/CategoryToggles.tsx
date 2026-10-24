"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { CANONICAL_CATEGORIES } from "@/lib/categories/taxonomy";
import { CATEGORY_VISUALS } from "@/lib/categories/visuals";
import { cn } from "@/lib/utils";

/**
 * Le 7 categorie canoniche come interruttori (PREF-02, UI-SPEC Superficie 2).
 * L'elenco e l'ordine vengono dalla tassonomia, mai da una copia scritta qui;
 * l'icona della categoria lascia il posto a una spunta quando e' scelta.
 */
interface CategoryTogglesProps {
	selected: ReadonlySet<string>;
	onToggle: (category: string) => void;
	disabled?: boolean;
}

export default function CategoryToggles({ selected, onToggle, disabled }: CategoryTogglesProps) {
	const labelId = useId();
	return (
		<div>
			<span id={labelId} className="block text-sm font-semibold text-foreground">
				Categorie
			</span>
			<div role="group" aria-labelledby={labelId} className="mt-2 flex flex-wrap gap-2">
				{CANONICAL_CATEGORIES.map((name) => {
					const on = selected.has(name);
					const Glyph = on ? Check : CATEGORY_VISUALS[name].Icon;
					return (
						<button
							key={name}
							type="button"
							aria-pressed={on}
							disabled={disabled}
							onClick={() => onToggle(name)}
							className={cn(
								"inline-flex h-11 items-center gap-2 rounded-pill px-4 text-sm transition-colors",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
								"disabled:cursor-not-allowed disabled:opacity-50",
								on
									? "bg-foreground font-semibold text-background"
									: "bg-surface text-foreground-secondary shadow-[inset_0_0_0_1px_var(--border-soft)] hover:bg-muted-strong hover:text-foreground",
							)}
						>
							<Glyph size={16} aria-hidden="true" className="shrink-0" />
							{name}
						</button>
					);
				})}
			</div>
		</div>
	);
}
