import { categoryVisual } from "@/lib/categories/visuals";
import { cn } from "@/lib/utils";

interface CategoryPlaceholderProps {
	/** Nome canonico (event.category, gia' garantito da serializeEvent). */
	category: string;
	/** Sovrascrive raggio/aspect-ratio di default (es. quadrato piccolo nella mini-card mappa). */
	className?: string;
}

/**
 * Segnaposto per evento senza `imageUrl` (D-05). Stesso spazio 3:2 della
 * card-media, sfondo `--surface`, icona della categoria centrata colorata
 * col token `--category-*` corrispondente. Nessuna etichetta testuale: il
 * nome categoria vive gia' nel kicker della card.
 */
export default function CategoryPlaceholder({ category, className }: CategoryPlaceholderProps) {
	const { token, Icon } = categoryVisual(category);

	return (
		<div className={cn("flex aspect-[3/2] w-full items-center justify-center rounded-lg bg-surface", className)}>
			<Icon aria-hidden="true" className="size-[40%]" style={{ color: `var(${token})` }} />
		</div>
	);
}
