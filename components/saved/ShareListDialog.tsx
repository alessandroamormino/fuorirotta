"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Copy, Share2, X } from "lucide-react";
import * as Dialog from "@/components/ui/Dialog";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

/**
 * "Condividi la lista" (24-UI-SPEC Surface 2, SHARE-02): crea, copia e gestisce il link
 * pubblico della lista dei salvati. Aprire il dialogo NON crea nulla (D-02): all'apertura si
 * chiede solo lo stato al server, il link nasce con "Crea link". Il numero di eventi viene dal
 * server (stessa regola della pagina pubblica), mai dalla lista del client. Le URL assolute si
 * costruiscono SOLO dopo la risposta, mai in un render che gira sul server (React error 418).
 */
type ShareLink = { path: string; showName: boolean };
type View = { status: "loading" } | { status: "error" } | { status: "ready"; link: ShareLink | null; upcoming: number };
type CopyState = "idle" | "copied" | "failed";

// Timeout di visualizzazione, non durate di animazione (come ShareButton).
const COPIED_MS = 2000;
const FAILED_MS = 4000;
const COPY_FAILED = "Copia non riuscita. Seleziona il link e copialo a mano.";
const SHARE_URL = "/api/v1/me/share";
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

class HttpError extends Error {
	status: number;
	constructor(status: number) {
		super(`share ${status}`);
		this.status = status;
	}
}

async function call(method: "GET" | "POST", url: string): Promise<unknown> {
	const res = await fetch(url, { method, credentials: "same-origin", cache: "no-store" });
	if (!res.ok) throw new HttpError(res.status);
	return res.json();
}

function parseLink(data: unknown): ShareLink {
	const { path, showName } = (data ?? {}) as { path?: unknown; showName?: unknown };
	if (typeof path !== "string" || !path.startsWith("/l/") || typeof showName !== "boolean") throw new Error("share link");
	return { path, showName };
}

function parseState(data: unknown): { link: ShareLink | null; upcoming: number } {
	const { link, upcoming } = (data ?? {}) as { link?: unknown; upcoming?: unknown };
	if (typeof upcoming !== "number") throw new Error("share state");
	return { link: link == null ? null : parseLink(link), upcoming };
}

const introFor = (n: number) =>
	n === 0
		? "Al momento non hai eventi in arrivo tra i salvati: chi apre il link vedrà quelli che salverai da ora in poi."
		: n === 1
			? "Chiunque abbia il link vedrà il tuo evento in arrivo."
			: `Chiunque abbia il link vedrà i tuoi ${n} eventi in arrivo.`;

const privacyFor = (n: number) =>
	n === 0
		? "Chiunque abbia questo link vede la tua lista, che al momento non ha eventi in arrivo. Non vede la tua email né altri dati del tuo account."
		: `Chiunque abbia questo link vede ${n === 1 ? "il tuo evento" : `i tuoi ${n} eventi`} in arrivo, anche senza account. Non vede la tua email né altri dati del tuo account.`;

function Alert({ children }: { children: React.ReactNode }) {
	return (
		<p role="alert" className="flex items-start gap-2 text-sm text-foreground">
			<CircleAlert size={18} className="flex-none text-destructive" aria-hidden="true" />
			{children}
		</p>
	);
}

export default function ShareListDialog() {
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>({ status: "loading" });
	const [creating, setCreating] = useState(false);
	const [createError, setCreateError] = useState(false);
	const [copy, setCopy] = useState<CopyState>("idle");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Scarta le risposte di una richiesta superata (chiusura, nuovo tentativo).
	const generation = useRef(0);
	// Il focus si sposta dopo il render che ha creato l'elemento di destinazione.
	const pendingFocus = useRef<string | null>(null);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[]
	);

	useEffect(() => {
		if (!pendingFocus.current) return;
		document.getElementById(pendingFocus.current)?.focus();
		pendingFocus.current = null;
	});

	const load = () => {
		const mine = ++generation.current;
		setView({ status: "loading" });
		call("GET", SHARE_URL)
			.then((data) => {
				if (mine === generation.current) setView({ status: "ready", ...parseState(data) });
			})
			.catch(() => {
				if (mine === generation.current) setView({ status: "error" });
			});
	};

	const onOpenChange = (next: boolean) => {
		if (!next && creating) return;
		setOpen(next);
		if (next) {
			load();
			return;
		}
		generation.current++;
		if (timer.current) clearTimeout(timer.current);
		setCreateError(false);
		setCopy("idle");
	};

	const create = () => {
		setCreating(true);
		setCreateError(false);
		call("POST", SHARE_URL)
			.then((data) => {
				const link = parseLink(data);
				setView((v) => (v.status === "ready" ? { ...v, link } : v));
				pendingFocus.current = "share-copy";
			})
			.catch(() => setCreateError(true))
			.finally(() => setCreating(false));
	};

	const flash = (next: "copied" | "failed", ms: number) => {
		if (timer.current) clearTimeout(timer.current);
		setCopy(next);
		timer.current = setTimeout(() => setCopy("idle"), ms);
	};

	const link = view.status === "ready" ? view.link : null;
	const https = link ? `${window.location.origin}${link.path}` : "";

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(https);
			flash("copied", COPIED_MS);
		} catch {
			// Clipboard assente o negata: il link resta selezionato per la copia a mano.
			(document.getElementById("share-link") as HTMLInputElement | null)?.select();
			flash("failed", FAILED_MS);
		}
	};

	const status = copy === "copied" ? "Link copiato" : copy === "failed" ? COPY_FAILED : view.status === "loading" ? "Sto controllando il link" : "";

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Trigger asChild>
				<button
					type="button"
					className={`inline-flex h-12 items-center gap-2 rounded-pill bg-surface px-4 text-sm font-semibold text-foreground hover:bg-muted-strong ${FOCUS_RING}`}
					style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
				>
					<Share2 size={18} aria-hidden="true" />
					Condividi la lista
				</button>
			</Dialog.Trigger>
			{/* "!" come in SignInDialog: w-full di Dialog.Content verrebbe dopo w-[calc(...)] nel CSS compilato. */}
			<Dialog.Content className="w-[calc(100%-2rem)]!">
				<div className="space-y-6">
					<Dialog.Title className="pr-10 text-xl font-semibold leading-[1.2] text-foreground">Condividi la lista</Dialog.Title>
					<Dialog.Description className="text-sm text-foreground-secondary">
						Manda la tua lista di eventi salvati a chi vuoi con un link: si apre senza account.
					</Dialog.Description>
					<span role="status" aria-live="polite" className="sr-only">
						{status}
					</span>

					{view.status === "loading" && <div aria-hidden="true" className="h-11 rounded-md bg-muted-strong" />}

					{view.status === "error" && (
						<div>
							<p className="text-sm text-foreground">Non riusciamo a caricare lo stato del link. Riprova tra poco.</p>
							<Button variant="secondary" size="sm" className="mt-2" onClick={load}>
								Riprova
							</Button>
						</div>
					)}

					{view.status === "ready" && !link && (
						<>
							<p className="text-sm text-foreground">{introFor(view.upcoming)}</p>
							<p className="text-sm text-foreground-secondary">
								La lista si aggiorna da sola: se aggiungi o togli un evento, chi ha il link lo vede subito. Non vede la tua email né altri dati del tuo account. La tua lista resta privata finché non crei un link.
							</p>
							<div className="space-y-6">
								{createError && <Alert>Non riusciamo a creare il link. Riprova tra poco.</Alert>}
								<Button id="share-create" variant="primary" size="md" loading={creating} className="w-full min-[480px]:w-auto" onClick={create}>
									Crea link
								</Button>
							</div>
						</>
					)}

					{view.status === "ready" && link && (
						<>
							<div>
								<label htmlFor="share-link" className="text-sm font-semibold text-foreground">
									Il link
								</label>
								<div className="mt-2 flex flex-col gap-2 sm:flex-row">
									<div className="min-w-0 flex-1">
										<Input id="share-link" readOnly value={https} size="md" className="w-full min-w-0 bg-background" onFocus={(event) => event.currentTarget.select()} />
									</div>
									<Button id="share-copy" variant="secondary" size="md" className="flex-none" onClick={onCopy}>
										{copy === "copied" ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
										{copy === "copied" ? "Link copiato" : "Copia link"}
									</Button>
								</div>
								{copy === "failed" && (
									<p aria-hidden="true" className="mt-2 text-sm text-foreground-secondary">
										{COPY_FAILED}
									</p>
								)}
							</div>
							<p className="text-sm text-foreground-secondary">{privacyFor(view.upcoming)}</p>
						</>
					)}
				</div>
				<Dialog.Close asChild>
					<button
						type="button"
						aria-label="Chiudi"
						disabled={creating}
						className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-muted-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
					>
						<X size={20} aria-hidden="true" />
					</button>
				</Dialog.Close>
			</Dialog.Content>
		</Dialog.Root>
	);
}
