"use client";

import { Event } from "@/lib/types";
import { eventStatus, formatEventRange } from "@/lib/eventStatus";
import Link from "next/link";
import { decodeHtmlEntities, cn } from "@/lib/utils";
import StatusBadge from "@/components/StatusBadge";
import CategoryPlaceholder from "@/components/CategoryPlaceholder";

interface EventCardProps {
	event: Event;
	/** Calcolata dal chiamante (posizione utente nota). Assente -> il segmento "N km" non compare. */
	distanceKm?: number;
	/** D-12: legame bidirezionale lista<->mappa — anello quando il pin corrispondente e' selezionato. */
	highlighted?: boolean;
	/**
	 * D-12, verso card -> pin: solo puntatore fine (mouse). Il tocco naviga al
	 * dettaglio come oggi — l'evidenziazione da tap sulla card in lista
	 * cambierebbe il gesto principale di una superficie gia' approvata.
	 */
	onHoverStart?: () => void;
	onHoverEnd?: () => void;
}

/**
 * Card evento sulla forma del prototipo mobile adottato (.planning/sketches/
 * 003-mobile-redesign/, .card/.card-media/.card-status/.card-body). Bucket 3
 * (12-UI-SPEC.md): componente unico per ogni breakpoint, il desktop lo
 * eredita non appena esiste — nessuna variante `sm:`/`md:` che biforchi la
 * resa.
 */
export default function EventCard({ event, distanceKm, highlighted, onHoverStart, onHoverEnd }: EventCardProps) {
	const status = eventStatus(event.dateStart, event.dateEnd);
	const title = decodeHtmlEntities(
		event.title.toLowerCase().charAt(0).toUpperCase() + event.title.toLowerCase().slice(1)
	);
	const comune = event.comune;

	const handlePointerEnter = (e: React.PointerEvent) => {
		if (e.pointerType === "mouse") onHoverStart?.();
	};
	const handlePointerLeave = (e: React.PointerEvent) => {
		if (e.pointerType === "mouse") onHoverEnd?.();
	};

	return (
		<Link
			href={`/eventi/${event.id}`}
			className="group block"
			onPointerEnter={handlePointerEnter}
			onPointerLeave={handlePointerLeave}
		>
			<div
				className={cn(
					"relative aspect-[3/2] w-full overflow-hidden rounded-lg bg-surface",
					highlighted ? "shadow-[0_0_0_2px_var(--primary)]" : "shadow-[var(--elev-ring)]"
				)}
			>
				{event.imageUrl ? (
					<img
						src={event.imageUrl}
						alt={event.title}
						className="h-full w-full object-cover [will-change:transform] group-hover:scale-[1.03]"
						style={{ transition: "transform var(--motion-base) var(--ease-standard)" }}
					/>
				) : (
					<CategoryPlaceholder category={event.category ?? "Altro"} className="rounded-lg" />
				)}
				<StatusBadge label={status.label} tone={status.tone} variant="card" className="absolute left-3 top-3" />
			</div>

			<div className="px-1 pt-3">
				<p className="mb-0.5 flex items-center gap-1.5 text-xs text-muted-foreground-subtle">
					<span>{event.category}</span>
					{distanceKm != null && (
						<>
							<span className="text-border">·</span>
							<span>{Math.round(distanceKm)} km</span>
						</>
					)}
				</p>
				{/* UAT mobile 2026-09-19: "g", "p", "q" sull'ultima riga tagliati.
				    --leading-tight di questo progetto e' 1.05 (app/globals.css, non
				    il 1.25 di Tailwind): a 17px la riga e' alta 17,85px mentre la
				    scatola del font ne chiede 21, quindi la mezza interlinea e'
				    NEGATIVA e l'inchiostro esce di 0,89px sotto la riga. Ovunque
				    altro non si vede perche' non c'e' niente che tagli; qui
				    line-clamp-2 porta con se' overflow:hidden, ed e' lui a tagliare.
				    Percio' la correzione sta sul sito di clamp e non sul token: 1.05
				    resta giusto per tutti i titoli non troncati.
				    1.2 e' scelto sulla misura, non a occhio: la soglia oltre la
				    quale non si taglia piu' e' 1.155 (SF Pro Display) e 1.082
				    (Roboto, il fallback Android), quindi 1.2 ha margine su entrambi
				    costando 2,55px per riga. leading-snug (1.375) risolveva anche,
				    ma a 5,5px per riga cambiava il ritmo tipografico.
				    Stesso difetto e stessa correzione in
				    components/map/MiniEventCard.tsx. */}
				<h3 className="m-0 line-clamp-2 font-display text-base leading-[1.2] font-semibold tracking-[-0.01em] text-balance text-foreground">
					{title}
				</h3>
				<p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
					<strong className="font-medium text-foreground-secondary">
						{comune ? `${comune.name} (${comune.provinceCode})` : event.locationName || "Lombardia"}
					</strong>
					<span className="text-border">·</span>
					<span>{formatEventRange(event.dateStart, event.dateEnd)}</span>
				</p>
			</div>
		</Link>
	);
}
