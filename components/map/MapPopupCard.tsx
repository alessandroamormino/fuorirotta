"use client";

import MiniEventCard, { type MiniEventCardData } from "@/components/map/MiniEventCard";

/** Un evento gia' normalizzato dalle properties della feature Mapbox. */
export type MapPopupEvent = MiniEventCardData;

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
					<MiniEventCard key={ev.id} event={ev} className="hover:bg-surface" />
				))}
			</div>
		</div>
	);
}
