"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Share2 } from "lucide-react";
import { shareText } from "@/lib/calendar/links";
import { todayInRome } from "@/lib/dateWindow";
import { decodeHtmlEntities } from "@/lib/utils";

/**
 * "Condividi evento" (D-03, D-06, D-07): foglio nativo dove esiste Web Share,
 * altrimenti copia il link. Il rendering e' identico su server e client: ogni
 * sonda di capacita' (navigator, clipboard) e l'ora corrente vivono SOLO nel
 * gestore del click (React error 418).
 */
interface ShareButtonProps {
	eventId: number;
	/** Titolo grezzo: si decodifica qui. */
	title: string;
	dateStart: string | Date;
	dateEnd?: string | Date | null;
	/** Comune (pagina) o luogo (popup): il segmento salta se vuoto. */
	place?: string | null;
	/** URL canonico dal server; assente nel popup, che e' una createRoot senza props del server. */
	url?: string;
	presentation: "detail" | "popup";
	/** Mostra l'etichetta a ogni larghezza (evento concluso: manca il pulsante del calendario). */
	labelAlways?: boolean;
}

// Timeout di visualizzazione, non durate di animazione.
const COPIED_MS = 2000;
const FAILED_MS = 4000;
const FAILED_COPY = "Copia non riuscita. Copia l'indirizzo dalla barra del browser.";
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function ShareButton({
	eventId,
	title,
	dateStart,
	dateEnd,
	place,
	url,
	presentation,
	labelAlways = false,
}: ShareButtonProps) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
	const pending = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[]
	);

	const flash = (next: "copied" | "failed", ms: number) => {
		if (timer.current) clearTimeout(timer.current);
		setState(next);
		timer.current = setTimeout(() => setState("idle"), ms);
	};

	const handleClick = async () => {
		if (pending.current) return;
		const decodedTitle = decodeHtmlEntities(title);
		const shareUrl = url ?? `${window.location.origin}/eventi/${eventId}`;
		const data = {
			title: decodedTitle,
			text: shareText({ title, dateStart, dateEnd, place }, todayInRome()),
			url: shareUrl,
		};
		if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
			pending.current = true;
			try {
				await navigator.share(data);
				return;
			} catch (error) {
				// Il foglio chiuso dall'utente non e' un errore.
				if (error instanceof DOMException && error.name === "AbortError") return;
			} finally {
				pending.current = false;
			}
		}
		try {
			await navigator.clipboard.writeText(shareUrl);
			flash("copied", COPIED_MS);
		} catch {
			flash("failed", FAILED_MS);
		}
	};

	const isPopup = presentation === "popup";
	const message = state === "copied" ? "Link copiato" : state === "failed" ? FAILED_COPY : "";

	return (
		<div className={isPopup ? "absolute bottom-1 right-0" : "relative"}>
			<button
				type="button"
				onClick={handleClick}
				aria-label={isPopup ? `Condividi: ${decodeHtmlEntities(title)}` : "Condividi evento"}
				className={
					isPopup
						? `relative flex h-8 w-8 items-center justify-center rounded-full text-foreground-secondary hover:bg-muted-strong before:absolute before:-inset-1.5 before:content-[''] ${FOCUS_RING}`
						: `flex h-12 items-center justify-center gap-2 rounded-pill bg-surface text-sm font-medium text-foreground hover:bg-muted-strong active:bg-muted-strong ${
								labelAlways ? "px-4" : "w-12 sm:w-auto sm:px-4"
							} ${FOCUS_RING}`
				}
				style={isPopup ? undefined : { boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
			>
				{state === "copied" ? <Check size={18} aria-hidden="true" /> : <Share2 size={18} aria-hidden="true" />}
				{!isPopup && <span className={labelAlways ? undefined : "hidden sm:inline"}>Condividi evento</span>}
			</button>
			<span
				aria-hidden="true"
				className={`pointer-events-none absolute z-10 bg-foreground text-sm font-medium text-background motion-reduce:transition-none ${
					isPopup ? "right-full top-1/2 mr-2 -translate-y-1/2" : "bottom-full right-0 mb-2"
				} ${
					// w-max: un absolute senza larghezza si stringe al pulsante (48px su mobile), una parola per riga
					state === "failed"
						? "h-auto w-max max-w-[240px] whitespace-normal rounded-lg px-4 py-2"
						: "flex h-8 items-center whitespace-nowrap rounded-pill px-4"
				}`}
				style={{
					boxShadow: "var(--elev-raised)",
					opacity: state === "idle" ? 0 : 1,
					transition: "opacity var(--motion-fast) var(--ease-standard)",
				}}
			>
				{message || "Link copiato"}
			</span>
			<span role="status" aria-live="polite" className="sr-only">
				{message}
			</span>
		</div>
	);
}
