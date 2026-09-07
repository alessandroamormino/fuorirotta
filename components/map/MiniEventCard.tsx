"use client";

import Link from "next/link";
import { formatEventRange } from "@/lib/eventStatus";
import { decodeHtmlEntities, cn } from "@/lib/utils";
import CategoryPlaceholder from "@/components/CategoryPlaceholder";

/** Un evento normalizzato al minimo che la mini-card sa rendere. */
export interface MiniEventCardData {
	id: number;
	title: string;
	category: string;
	imageUrl: string;
	locationName: string;
	dateStart: string | Date;
	dateEnd?: string | Date | null;
}

interface MiniEventCardProps {
	event: MiniEventCardData;
	className?: string;
}

/**
 * Mini-card React condivisa (D-11/D-12, 12-06): stessa identita' visiva per
 * il popup Mapbox (components/map/MapPopupCard.tsx) e il carosello del
 * foglio inferiore (components/map/MapEventsRail.tsx) — una sola
 * definizione. L'outer chrome (larghezza, sfondo, hover, anello di
 * selezione) resta a chi la consuma, via `className`.
 *
 * Coerentemente con 12-03 (D-11): nessuno StatusBadge qui, la data
 * formattata basta — stesso contratto gia' scelto per il popup.
 */
export default function MiniEventCard({ event, className }: MiniEventCardProps) {
	return (
		<Link href={`/eventi/${event.id}`} className={cn("flex gap-3 rounded-md p-1", className)}>
			<div className="relative h-[62px] w-[62px] shrink-0 overflow-hidden rounded-sm bg-surface">
				{event.imageUrl ? (
					// Mitigazione T-12-06/T-12-15: imageUrl resta un src, mai un href.
					<img
						src={event.imageUrl}
						alt={decodeHtmlEntities(event.title)}
						className="h-full w-full object-cover"
					/>
				) : (
					<CategoryPlaceholder category={event.category || "Altro"} className="absolute inset-0 h-full w-full" />
				)}
			</div>
			<div className="flex min-w-0 flex-col justify-center">
				<p className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
					{decodeHtmlEntities(event.title)}
				</p>
				{/* D-21 vincolante: comune+data su foreground-secondary, mai solo sul
				    grigio debole in deroga WCAG — nessuna informazione qui vive solo
				    su --muted-foreground-subtle. */}
				<p className="mt-0.5 truncate text-xs text-foreground-secondary">
					{event.locationName ? `${decodeHtmlEntities(event.locationName)} · ` : ""}
					{formatEventRange(event.dateStart, event.dateEnd)}
				</p>
			</div>
		</Link>
	);
}
