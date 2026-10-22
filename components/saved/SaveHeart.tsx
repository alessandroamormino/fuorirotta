"use client";

import { Heart } from "lucide-react";
import { useIsSaved, toggleSaved } from "@/lib/saved/store";
import { cn, decodeHtmlEntities } from "@/lib/utils";

/**
 * Cuore "salva" (SAVE-01). Tutto lo stato viene dallo store di modulo, mai da
 * un Context: nel popup della mappa (createRoot a parte) un Context non
 * arriverebbe. Server e primo render del client sono sempre il contorno non
 * salvato, nella scatola definitiva: lo stato salvato compare dopo l'idratazione
 * senza spostare nulla (React error 418). Il nome accessibile NON cambia con lo
 * stato: lo porta aria-pressed (un nome che cambia viene annunciato due volte).
 */
interface SaveHeartProps {
	eventId: number;
	/** Titolo grezzo: si decodifica qui. */
	title: string;
	/** overlay: sopra la foto della card; row: nelle righe di /salvati. */
	presentation: "overlay" | "row";
	/** Sostituisce "Salva: {titolo}" (le righe "Altre date" aggiungono la data). */
	label?: string;
	className?: string;
}

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function SaveHeart({ eventId, title, presentation, label, className }: SaveHeartProps) {
	const saved = useIsSaved(eventId);
	const isOverlay = presentation === "overlay";

	return (
		<button
			type="button"
			onClick={() => {
				void toggleSaved(eventId);
			}}
			aria-pressed={saved}
			aria-label={label ?? `Salva: ${decodeHtmlEntities(title)}`}
			className={cn(
				"flex items-center justify-center rounded-full transition-colors",
				// Area di tocco da 44px attorno al cerchio da 32px (la ricetta dell'icona condividi del popup).
				isOverlay
					? "h-8 w-8 backdrop-blur-md backdrop-saturate-[180%] shadow-[0_2px_8px_rgba(0,0,0,0.14)] before:absolute before:-inset-1.5 before:content-['']"
					: "h-11 w-11 hover:bg-muted-strong",
				saved ? "text-primary" : "text-foreground",
				FOCUS_RING,
				className
			)}
			style={isOverlay ? { background: "color-mix(in srgb, var(--background) 88%, transparent)" } : undefined}
		>
			<Heart
				size={isOverlay ? 18 : 20}
				strokeWidth={2}
				fill={saved ? "currentColor" : "none"}
				aria-hidden="true"
			/>
		</button>
	);
}
