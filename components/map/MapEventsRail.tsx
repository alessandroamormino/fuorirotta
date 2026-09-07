"use client";

import { useEffect, useRef } from "react";
import { Event } from "@/lib/types";
import { cn } from "@/lib/utils";
import MiniEventCard from "@/components/map/MiniEventCard";

interface MapEventsRailProps {
	/** Eventi in vista, gia' risolti da HomeClient sugli id di onViewportChange (12-03). */
	events: Event[];
	/**
	 * Eventi realmente inquadrati: pin singoli PIU' quelli chiusi nei cluster.
	 * Diverso da `events.length`, che puo' contenere solo cio' che e' gia'
	 * indirizzabile singolarmente. A zoom basso e' tutto cluster e
	 * `events.length` vale 0 mentre qui ci sono migliaia di eventi.
	 */
	totalInView: number;
	selectedEventId: number | null;
}

/**
 * Foglio inferiore della vista mappa mobile (D-08/D-12): conteggio "{N}
 * eventi in vista" + carosello orizzontale a scroll-snap. Riusa
 * MiniEventCard (components/map/MiniEventCard.tsx) — la stessa mini-card
 * gia' montata dal popup Mapbox (MapPopupCard.tsx): una sola identita'
 * visiva per la mappa, non due.
 *
 * Non ricalcola i bounds: gli `events` che riceve sono gia' risolti da
 * HomeClient sugli id che `onViewportChange` di EventsMap riporta — la
 * mappa e' l'unica che sa cosa sta davvero rendendo (key_links del piano).
 */
export default function MapEventsRail({ events, totalInView, selectedEventId }: MapEventsRailProps) {
	const railRef = useRef<HTMLDivElement>(null);

	// Verso pin -> carosello (D-12): porta in vista la mini-card selezionata
	// con uno scorrimento agganciato via scrollIntoView (nessun calcolo
	// manuale di offset), rispettando prefers-reduced-motion.
	useEffect(() => {
		if (selectedEventId == null || !railRef.current) return;
		const card = railRef.current.querySelector<HTMLElement>(`[data-event-id="${selectedEventId}"]`);
		if (!card) return;
		const prefersReducedMotion =
			typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		card.scrollIntoView({
			behavior: prefersReducedMotion ? "auto" : "smooth",
			block: "nearest",
			inline: "center",
		});
	}, [selectedEventId]);

	return (
		<div
			className="pointer-events-none absolute inset-x-0 bottom-0 z-10 rounded-t-lg"
			style={{
				background: "color-mix(in srgb, var(--background) 94%, transparent)",
				backdropFilter: "saturate(180%) blur(24px)",
				WebkitBackdropFilter: "saturate(180%) blur(24px)",
				paddingBottom: "max(env(safe-area-inset-bottom), var(--space-3))",
				boxShadow: "0 -8px 30px rgba(0, 0, 0, 0.14)",
			}}
		>
			<div className="pointer-events-auto flex items-center justify-between gap-3 px-4 pb-2 pt-3">
				<span className="text-sm font-semibold text-foreground">
					{totalInView} {totalInView === 1 ? "evento" : "eventi"} in vista
				</span>
				<span className="text-xs text-muted-foreground">
					{/* Il suggerimento dice la verita' su cosa fare ADESSO: se il
					    carosello non copre tutto l'inquadrato, il gesto utile e'
					    ingrandire, non toccare un pin che non c'e'. */}
					{events.length < totalInView ? "Ingrandisci per vederli" : "Tocca un pin"}
				</span>
			</div>

			{totalInView === 0 ? (
				<p className="pointer-events-auto px-4 pb-5 text-sm text-muted-foreground">
					{"Nessun evento in quest'area. Sposta la mappa o allarga il raggio."}
				</p>
			) : events.length === 0 ? (
				<p className="pointer-events-auto px-4 pb-5 text-sm text-muted-foreground">
					{"Ingrandisci per vedere i singoli eventi: qui sono tutti raggruppati."}
				</p>
			) : (
				<div
					ref={railRef}
					className="pointer-events-auto flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				>
					{events.map((event) => (
						<div key={`${event.source}-${event.id}`} data-event-id={event.id} className={cn("shrink-0 snap-center", events.length === 1 ? "w-full" : "w-[264px]")}>
							<MiniEventCard
								event={{
									id: event.id,
									title: event.title,
									category: event.category ?? "",
									imageUrl: event.imageUrl ?? "",
									locationName: event.locationName ?? "",
									dateStart: event.dateStart,
									dateEnd: event.dateEnd,
								}}
								className={cn(
									"h-full bg-background",
									event.id === selectedEventId
										? "shadow-[0_0_0_2px_var(--primary)]"
										: "shadow-[var(--elev-ring)]"
								)}
							/>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
