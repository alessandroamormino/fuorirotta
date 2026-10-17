"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * Avvisi brevi (21-UI-SPEC Superficie 3). Il contenitore e' sempre montato e
 * VUOTO nell'HTML di ogni pagina: la regione role="status" deve esistere prima
 * del messaggio perche' i lettori di schermo lo annuncino, e un contenuto
 * diverso fra server e client sarebbe un errore di idratazione. Il testo
 * arriva dopo il mount: da notify(), da un'etichetta in sessionStorage scritta
 * prima di una navigazione completa, o dal parametro ?error= del ritorno da
 * Google (letto in un effect, mai da searchParams, che renderebbe dinamiche le
 * pagine pubbliche).
 */
type NoticeId = "cancelled" | "rate-limited" | "auth-failed" | "deleted" | "signed-out";

const NOTICE_TEXT: Record<NoticeId, string> = {
	cancelled: "Accesso annullato",
	"rate-limited": "Troppi tentativi, riprova tra qualche minuto",
	"auth-failed": "Accesso non riuscito. Riprova tra poco.",
	deleted: "Account eliminato",
	"signed-out": "Sei uscito",
};

const STORAGE_KEY = "notice";
// Timeout di visualizzazione, non durata di animazione.
const NOTICE_MS = 6000;

let listener: ((text: string) => void) | null = null;

/** Mostra un avviso (uno alla volta: sostituisce quello corrente). No-op se l'host non e' montato. */
export function notify(text: string): void {
	listener?.(text);
}

/** Da chiamare PRIMA di una navigazione completa: l'avviso compare una volta dopo il caricamento. */
export function queueNoticeAfterNavigation(id: NoticeId): void {
	try {
		sessionStorage.setItem(STORAGE_KEY, id);
	} catch {
		// Navigazione privata: l'avviso si salta, la navigazione avviene lo stesso.
	}
}

function isNoticeId(value: string | null): value is NoticeId {
	return value !== null && Object.prototype.hasOwnProperty.call(NOTICE_TEXT, value);
}

export default function NoticeHost() {
	const [message, setMessage] = useState<{ text: string; key: number } | null>(null);
	// Messaggio in pausa mentre e' sotto il mouse o contiene il focus.
	const [paused, setPaused] = useState(false);

	useEffect(() => {
		const show = (text: string) => setMessage((prev) => ({ text, key: (prev?.key ?? 0) + 1 }));
		listener = show;

		try {
			const stored = sessionStorage.getItem(STORAGE_KEY);
			sessionStorage.removeItem(STORAGE_KEY);
			if (isNoticeId(stored)) show(NOTICE_TEXT[stored]);
		} catch {
			// sessionStorage non disponibile: nessun avviso dopo la navigazione.
		}

		const url = new URL(window.location.href);
		const error = url.searchParams.get("error");
		if (error !== null) {
			// Il valore grezzo non viene mai mostrato: solo due frasi fisse.
			show(NOTICE_TEXT[error === "access_denied" ? "cancelled" : "auth-failed"]);
			url.searchParams.delete("error");
			window.history.replaceState(null, "", url.pathname + url.search + url.hash);
		}

		return () => {
			listener = null;
		};
	}, []);

	useEffect(() => {
		if (!message || paused) return;
		const timer = setTimeout(() => setMessage(null), NOTICE_MS);
		return () => clearTimeout(timer);
	}, [message, paused]);

	return (
		<div className="pointer-events-none fixed inset-x-4 top-[calc(env(safe-area-inset-top,0px)+16px)] z-[300] flex justify-center">
			<div role="status" aria-live="polite">
				{message && (
					<div
						key={message.key}
						onMouseEnter={() => setPaused(true)}
						onMouseLeave={() => setPaused(false)}
						onFocus={() => setPaused(true)}
						onBlur={() => setPaused(false)}
						className="pointer-events-auto flex max-w-[420px] animate-[noticeIn_var(--motion-fast)_var(--ease-standard)] items-start gap-3 rounded-lg bg-foreground px-4 py-3 text-sm font-medium text-background motion-reduce:animate-none"
						style={{ boxShadow: "var(--elev-raised)" }}
					>
						<span>{message.text}</span>
						<button
							type="button"
							aria-label="Chiudi avviso"
							onClick={() => {
								setPaused(false);
								setMessage(null);
							}}
							className="relative mt-0.5 flex-none rounded-sm text-background before:absolute before:-inset-3.5 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
						>
							<X size={16} aria-hidden="true" />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
