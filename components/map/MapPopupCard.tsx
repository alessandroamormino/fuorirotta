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
const CloseIcon = () => (
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
);

export default function MapPopupCard({ events, onClose }: MapPopupCardProps) {
	const isSingle = events.length <= 1;

	return (
		<div className="relative w-[280px] p-3">
			{/* Riga d'intestazione: SOLO col caso multi-evento (UAT 12-10). Con un
			    solo evento il titolo era gia' una stringa vuota, ma min-h-7 +
			    mb-2 riservavano comunque una riga morta sopra la card — il mock
			    (.map-pop-close, assets/desktop.css) non prevede quella riga: il
			    bottone di chiusura vi galleggia sopra in position:absolute. */}
			{!isSingle && (
				<div className="mb-2 flex min-h-7 items-center justify-between gap-2 pr-1">
					<p className="text-sm font-semibold text-foreground">
						{events.length} eventi in questo punto
					</p>
					<button
						type="button"
						onClick={onClose}
						aria-label="Chiudi"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground-secondary hover:bg-surface"
					>
						<CloseIcon />
					</button>
				</div>
			)}

			{isSingle && (
				// Stessa ricetta del mock (color-mix 88% + blur + shadow): il
				// bottone galleggia sopra il contenuto, deve restare leggibile
				// senza una riga di sfondo propria.
				<button
					type="button"
					onClick={onClose}
					aria-label="Chiudi"
					className="absolute right-2 top-2 z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground shadow-[0_1px_6px_rgba(0,0,0,0.2)] backdrop-blur-[10px] hover:bg-background"
					style={{ background: "color-mix(in srgb, var(--background) 88%, transparent)" }}
				>
					<CloseIcon />
				</button>
			)}

			<div className="flex flex-col gap-2">
				{events.map((ev) => (
					<MiniEventCard key={ev.id} event={ev} className="hover:bg-surface" />
				))}
			</div>
		</div>
	);
}
