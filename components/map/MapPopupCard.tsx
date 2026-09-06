"use client";

import Link from "next/link";
import { formatEventRange } from "@/lib/eventStatus";
import { decodeHtmlEntities } from "@/lib/utils";
import CategoryPlaceholder from "@/components/CategoryPlaceholder";

/** Un evento gia' normalizzato dalle properties della feature Mapbox. */
export interface MapPopupEvent {
	id: number;
	title: string;
	category: string;
	imageUrl: string;
	locationName: string;
	dateStart: string;
	dateEnd?: string;
}

interface MapPopupCardProps {
	/** Gia' ordinato per dateStart crescente dal chiamante (D-18). */
	events: MapPopupEvent[];
	onClose: () => void;
}

/**
 * Mini-card React del popup Mapbox (D-11). Montata via createRoot in
 * components/EventsMap.tsx, mai come stringa HTML: chiude il debito D-14
 * della Fase 7.
 *
 * Riceve SEMPRE un array (D-18): un solo elemento e' il caso comune, piu'
 * elementi il caso di coordinate coincidenti (es. NXT Bergamo, 4 eventi
 * sullo stesso punto). Stesso markup per entrambi i casi, nessun ramo
 * speciale per "un solo evento" — e' esattamente il tipo di ramo speciale
 * che ha causato il difetto D-18 in origine.
 *
 * Assunzione dichiarata del pianificatore (12-03-PLAN.md, 12-RESEARCH.md
 * Open Question 2): nessuno StatusBadge qui. La data formattata basta,
 * zero rischio di overflow nei 280px del popup.
 */
export default function MapPopupCard({ events, onClose }: MapPopupCardProps) {
	return (
		<div className="w-[280px] p-3">
			<div className="mb-2 flex min-h-7 items-center justify-between gap-2 pr-1">
				<p className="text-sm font-semibold text-foreground">
					{events.length > 1 ? `${events.length} eventi in questo punto` : ""}
				</p>
				<button
					type="button"
					onClick={onClose}
					aria-label="Chiudi"
					className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground-secondary hover:bg-surface"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2.5}
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>

			<div className="flex flex-col gap-2">
				{events.map((ev) => (
					<Link
						key={ev.id}
						href={`/eventi/${ev.id}`}
						className="flex gap-3 rounded-md p-1 hover:bg-surface"
					>
						<div className="relative h-[62px] w-[62px] shrink-0 overflow-hidden rounded-sm bg-surface">
							{ev.imageUrl ? (
								// Mitigazione T-12-06: imageUrl resta un src, mai un href.
								<img
									src={ev.imageUrl}
									alt={decodeHtmlEntities(ev.title)}
									className="h-full w-full object-cover"
								/>
							) : (
								<CategoryPlaceholder category={ev.category || "Altro"} className="absolute inset-0 h-full w-full" />
							)}
						</div>
						<div className="flex min-w-0 flex-col justify-center">
							<p className="line-clamp-2 text-sm font-semibold leading-tight text-foreground">
								{decodeHtmlEntities(ev.title)}
							</p>
							{/* D-21 vincolante: la meta porta comune+data su foreground-secondary,
							    mai sul grigio debole in deroga WCAG — nessuna informazione qui
							    vive solo su --muted-foreground-subtle. */}
							<p className="mt-0.5 truncate text-xs text-foreground-secondary">
								{ev.locationName ? `${decodeHtmlEntities(ev.locationName)} · ` : ""}
								{formatEventRange(ev.dateStart, ev.dateEnd)}
							</p>
						</div>
					</Link>
				))}
			</div>
		</div>
	);
}
