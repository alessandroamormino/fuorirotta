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
type NoticeId =
	| "cancelled"
	| "rate-limited"
	| "auth-failed"
	| "deleted"
	| "signed-out"
	| "collision-apple"
	| "collision-google"
	| "linked-apple"
	| "linked-google"
	| "link-conflict-apple"
	| "link-conflict-google"
	| "link-cancelled"
	| "link-failed"
	| "unlinked-apple"
	| "unlinked-google"
	| "link-start-failed";

const NOTICE_TEXT: Record<NoticeId, string> = {
	cancelled: "Accesso annullato",
	"rate-limited": "Troppi tentativi, riprova tra qualche minuto",
	"auth-failed": "Accesso non riuscito. Riprova tra poco.",
	deleted: "Account eliminato",
	"signed-out": "Sei uscito",
	"collision-apple": "Esiste già un account con questa email. Entra con Google e collega Apple dal profilo.",
	"collision-google": "Esiste già un account con questa email. Entra con Apple e collega Google dal profilo.",
	"linked-apple": "Apple collegato",
	"linked-google": "Google collegato",
	"link-conflict-apple": "Questo account Apple è già usato da un altro profilo",
	"link-conflict-google": "Questo account Google è già usato da un altro profilo",
	"link-cancelled": "Collegamento annullato",
	"link-failed": "Collegamento non riuscito. Riprova tra poco.",
	"unlinked-apple": "Apple scollegato",
	"unlinked-google": "Google scollegato",
	"link-start-failed": "Non siamo riusciti ad avviare il collegamento. Riprova.",
};

// Codici d'errore di Better Auth 1.7.10 che il ritorno puo' portare. Il valore grezzo non si mostra mai.
const CANCEL_CODES = ["access_denied", "user_cancelled_authorize"];
const PROVIDERS = ["apple", "google"] as const;
type Provider = (typeof PROVIDERS)[number];

function asProvider(value: string | null): Provider | null {
	return PROVIDERS.find((p) => p === value) ?? null;
}

const STORAGE_KEY = "notice";
// Timeout di visualizzazione, non durata di animazione.
const NOTICE_MS = 6000;

export interface NoticeAction {
	label: string;
	onClick: () => void;
}

interface NoticeOptions {
	/** Resta finche' non lo si chiude o un altro avviso lo sostituisce. */
	sticky?: boolean;
}

let listener: ((text: string, action?: NoticeAction, options?: NoticeOptions) => void) | null = null;

/**
 * Mostra un avviso (uno alla volta: sostituisce quello corrente). No-op se l'host non e' montato.
 * Con `action` compare un pulsante fra il testo e la chiusura: esegue onClick e chiude l'avviso.
 */
export function notify(text: string, action?: NoticeAction, options?: NoticeOptions): void {
	listener?.(text, action, options);
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
	const [message, setMessage] = useState<{ text: string; key: number; action?: NoticeAction; sticky?: boolean } | null>(null);
	// Messaggio in pausa mentre e' sotto il mouse o contiene il focus.
	const [paused, setPaused] = useState(false);

	useEffect(() => {
		const show = (text: string, action?: NoticeAction, options?: NoticeOptions) =>
			setMessage((prev) => ({ text, action, sticky: options?.sticky, key: (prev?.key ?? 0) + 1 }));
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
		const via = asProvider(url.searchParams.get("via"));
		const link = asProvider(url.searchParams.get("link"));
		const linked = asProvider(url.searchParams.get("linked"));
		if (linked) {
			show(NOTICE_TEXT[`linked-${linked}`]);
		} else if (link && error !== null) {
			// Ritorno da un collegamento fallito: Better Auth aggiunge error=<codice>.
			if (error === "account_already_linked_to_different_user") show(NOTICE_TEXT[`link-conflict-${link}`]);
			else show(NOTICE_TEXT[CANCEL_CODES.includes(error) ? "link-cancelled" : "link-failed"]);
		} else if (error !== null && !link) {
			// Il valore grezzo non viene mai mostrato: solo frasi fisse.
			if (error === "account_not_linked" && via) show(NOTICE_TEXT[`collision-${via}`], undefined, { sticky: true });
			else show(NOTICE_TEXT[CANCEL_CODES.includes(error) ? "cancelled" : "auth-failed"]);
		}
		if (linked || link || error !== null || via) {
			for (const key of ["error", "error_description", "via", "link", "linked"]) url.searchParams.delete(key);
			window.history.replaceState(null, "", url.pathname + url.search + url.hash);
		}

		return () => {
			listener = null;
		};
	}, []);

	useEffect(() => {
		if (!message || message.sticky || paused) return;
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
						{message.action && (
							<button
								type="button"
								onClick={() => {
									message.action?.onClick();
									setPaused(false);
									setMessage(null);
								}}
								className="relative flex-none rounded-sm text-sm font-semibold text-background underline underline-offset-4 before:absolute before:-inset-3 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
							>
								{message.action.label}
							</button>
						)}
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
