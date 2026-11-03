"use client";

import { useEffect } from "react";
import { Check } from "lucide-react";
import { useIsVisited, toggleVisited, loadVisitedIds } from "@/lib/visited/store";
import { savedAuth, useSavedMode } from "@/lib/saved/store";
import type { Snap } from "@/lib/saved/snapshot";
import { notify } from "@/components/account/NoticeHost";
import { requestSignIn } from "@/components/account/UserStateProvider";
import { cn, decodeHtmlEntities } from "@/lib/utils";

/**
 * "Ci sono stato" sulla pagina dell'evento (D-08), accanto al cuore e mai
 * legato a lui (D-04). Stato dallo store di modulo, mai da un Context. Server e
 * primo render del client sono sempre il bottone non premuto nella sua scatola
 * definitiva: lo stato premuto compare dopo l'idratazione senza spostare nulla
 * (React error 418). Il nome accessibile NON cambia con lo stato: lo porta
 * aria-pressed. Sotto sm resta solo l'icona (tondo come il cuore), dal sm in
 * su c'e' anche il testo: cosi' il titolo non si stringe sul telefono.
 */
interface VisitedButtonProps {
	eventId: number;
	/** Titolo grezzo: si decodifica qui. */
	title: string;
	/** Date come arrivano dal server (ISO): servono all'ospite per il giorno di visita. */
	dateStart: string;
	dateEnd: string | null;
	/** Testo dell'evento per la lista del dispositivo (null = l'evento non lo ammette: il segno resta senza). */
	snap: Snap | null;
	className?: string;
}

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function VisitedButton({ eventId, title, dateStart, dateEnd, snap, className }: VisitedButtonProps) {
	const visited = useIsVisited(eventId);
	const mode = useSavedMode();

	// Modo account: gli id arrivano dal server; se VisitedSync non li ha ancora portati, qui si chiedono.
	useEffect(() => {
		if (mode === "account") void loadVisitedIds(true);
	}, [mode]);

	return (
		<button
			type="button"
			onClick={() => {
				const wasVisited = visited;
				void toggleVisited(eventId, { dateStart, dateEnd, snap }).then((result) => {
					if (result === "cap") {
						if (savedAuth().signedIn) {
							notify("Hai raggiunto il limite di 500 eventi visitati. Rimuovine qualcuno per aggiungerne altri.");
						} else {
							// Come il tetto dei salvati: l'azione di accesso solo con l'accesso acceso sia nella build sia sul server.
							const canSignIn = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true" && savedAuth().enabled !== false;
							notify(
								"Hai raggiunto il limite di 100 eventi visitati senza account. Accedi per segnarne fino a 500.",
								canSignIn ? { label: "Accedi", onClick: requestSignIn } : undefined
							);
						}
					} else if (result === "error") {
						notify(wasVisited ? "Rimozione non riuscita. Riprova tra poco." : "Salvataggio non riuscito. Riprova tra poco.");
					}
				});
			}}
			aria-pressed={visited}
			aria-label={`Ci sono stato: ${decodeHtmlEntities(title)}`}
			className={cn(
				"flex h-12 w-12 items-center justify-center gap-2 rounded-full text-sm font-medium transition-colors sm:w-auto sm:px-4",
				visited ? "bg-primary text-primary-foreground" : "bg-surface text-foreground hover:bg-muted-strong active:bg-muted-strong",
				FOCUS_RING,
				className
			)}
			style={visited ? undefined : { boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
		>
			<Check size={20} strokeWidth={2} aria-hidden="true" />
			<span aria-hidden="true" className="hidden sm:inline">
				Ci sono stato
			</span>
		</button>
	);
}
