"use client";

import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Copy, Share2, X } from "lucide-react";
import { useUserState } from "@/components/account/UserStateProvider";
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
type Busy = null | "create" | "rotate" | "off";
type Confirm = null | "off" | "regen";

// Timeout di visualizzazione, non durate di animazione (come ShareButton).
const COPIED_MS = 2000;
const FAILED_MS = 4000;
const COPY_FAILED = "Copia non riuscita. Seleziona il link e copialo a mano.";
const SHARE_URL = "/api/v1/me/share";
const ROTATE_URL = "/api/v1/me/share/rotate";
const ROTATED = "Nuovo link creato. Quello vecchio non funziona più.";
const DEACTIVATED = "Link disattivato. Chi lo aveva non può più aprirlo.";
const INACTIVE = "Il link non era più attivo.";
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

class HttpError extends Error {
	status: number;
	constructor(status: number) {
		super(`share ${status}`);
		this.status = status;
	}
}

async function call(url: string, init: { method?: string; body?: string } = {}): Promise<unknown> {
	const headers = init.body ? { "Content-Type": "application/json" } : undefined;
	const res = await fetch(url, { ...init, headers, credentials: "same-origin", cache: "no-store" });
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
	const ownerName = useUserState().user?.name ?? "";
	const [open, setOpen] = useState(false);
	const [view, setView] = useState<View>({ status: "loading" });
	// Creare, sostituire o disattivare non si abbandona a meta': finche' una richiesta e' in corso il dialogo non si chiude.
	const [busy, setBusy] = useState<Busy>(null);
	const [createError, setCreateError] = useState(false);
	const [confirm, setConfirm] = useState<Confirm>(null);
	const [confirmError, setConfirmError] = useState("");
	const [notice, setNotice] = useState("");
	const [nameBusy, setNameBusy] = useState(false);
	const [nameError, setNameError] = useState(false);
	const [canShare, setCanShare] = useState(false);
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
		call(SHARE_URL)
			.then((data) => {
				if (mine === generation.current) setView({ status: "ready", ...parseState(data) });
			})
			.catch(() => {
				if (mine === generation.current) setView({ status: "error" });
			});
	};

	const onOpenChange = (next: boolean) => {
		if (!next && busy) return;
		setOpen(next);
		if (next) {
			// Mai a livello di modulo o in un render sul server (React error 418).
			setCanShare(typeof navigator.share === "function");
			load();
			return;
		}
		generation.current++;
		if (timer.current) clearTimeout(timer.current);
		setCreateError(false);
		setCopy("idle");
		setConfirm(null);
		setConfirmError("");
		setNotice("");
		setNameError(false);
	};

	// Il focus va alla scelta sicura quando la conferma si apre, e torna al
	// bottone che l'ha aperta quando si annulla: quel bottone esiste di nuovo
	// solo dopo il render, quindi lo si cerca qui e non in closeConfirm.
	const returnFocus = useRef<string | null>(null);
	useEffect(() => {
		if (confirm) document.getElementById("share-keep")?.focus();
		else if (returnFocus.current) {
			document.getElementById(returnFocus.current)?.focus();
			returnFocus.current = null;
		}
	}, [confirm]);

	const openConfirm = (kind: "off" | "regen") => {
		setConfirm(kind);
		setConfirmError("");
	};

	const closeConfirm = () => {
		returnFocus.current = confirm === "off" ? "share-off" : "share-regen";
		setConfirm(null);
		setConfirmError("");
	};

	// Un'altra scheda ha gia' tolto il link: si riparte dallo stato vero.
	const inactive = () => {
		setConfirm(null);
		setConfirmError("");
		setNotice(INACTIVE);
		load();
	};
	const isGone = (error: unknown) => error instanceof HttpError && error.status === 404;

	const create = () => {
		setBusy("create");
		setCreateError(false);
		setNotice("");
		call(SHARE_URL, { method: "POST" })
			.then((data) => {
				const link = parseLink(data);
				setView((v) => (v.status === "ready" ? { ...v, link } : v));
				pendingFocus.current = "share-copy";
			})
			.catch(() => setCreateError(true))
			.finally(() => setBusy(null));
	};

	const rotate = () => {
		setBusy("rotate");
		setConfirmError("");
		call(ROTATE_URL, { method: "POST" })
			.then((data) => {
				const next = parseLink(data);
				setView((v) => (v.status === "ready" ? { ...v, link: next } : v));
				setConfirm(null);
				setCopy("idle");
				setNotice(ROTATED);
				pendingFocus.current = "share-copy";
			})
			.catch((error) => (isGone(error) ? inactive() : setConfirmError("Non siamo riusciti a generare un nuovo link. Riprova tra poco.")))
			.finally(() => setBusy(null));
	};

	const deactivate = () => {
		setBusy("off");
		setConfirmError("");
		call(SHARE_URL, { method: "DELETE" })
			.then(() => {
				// La riga sparisce con il link: il prossimo parte con il nome spento (D-11).
				setView((v) => (v.status === "ready" ? { ...v, link: null } : v));
				setConfirm(null);
				setCopy("idle");
				setNotice(DEACTIVATED);
				pendingFocus.current = "share-create";
			})
			.catch(() => setConfirmError("Non siamo riusciti a disattivare il link. Riprova tra poco."))
			.finally(() => setBusy(null));
	};

	const setShowName = (value: boolean) => {
		setView((v) => (v.status === "ready" && v.link ? { ...v, link: { ...v.link, showName: value } } : v));
	};

	// Il nome si applica subito allo stesso link (D-04): ottimista, annullato se il server rifiuta.
	const onToggleName = (next: boolean) => {
		if (nameBusy || !link) return;
		const previous = link.showName;
		setNameBusy(true);
		setNameError(false);
		setNotice("");
		setShowName(next);
		call(SHARE_URL, { method: "PATCH", body: JSON.stringify({ showName: next }) })
			.catch((error) => {
				if (isGone(error)) {
					inactive();
					return;
				}
				setShowName(previous);
				setNameError(true);
			})
			.finally(() => setNameBusy(false));
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

	// Il foglio di sistema porta solo il titolo fisso e il link: mai il nome, mai un conteggio.
	const onShare = async () => {
		const data = { title: "Eventi salvati su Fuorirotta", text: "Guarda gli eventi che ho salvato su Fuorirotta.", url: https };
		if (navigator.canShare && !navigator.canShare(data)) return;
		try {
			await navigator.share(data);
		} catch {
			// Foglio chiuso (AbortError) o rifiutato: in entrambi i casi il tasto "Copia link" e' li'.
		}
	};

	const status = copy === "copied" ? "Link copiato" : copy === "failed" ? COPY_FAILED : view.status === "loading" ? "Sto controllando il link" : notice;

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
			<Dialog.Content
				className="w-[calc(100%-2rem)]!"
				onEscapeKeyDown={(event) => {
					// Con una richiesta in corso non si esce; altrimenti prima si chiude la conferma, poi il dialogo.
					if (busy) event.preventDefault();
					else if (confirm) {
						event.preventDefault();
						closeConfirm();
					}
				}}
				onInteractOutside={(event) => {
					if (busy) event.preventDefault();
				}}
			>
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
								<Button id="share-create" variant="primary" size="md" loading={busy === "create"} className="w-full min-[480px]:w-auto" onClick={create}>
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
								{canShare && (
									<Button variant="primary" size="md" className="mt-2 w-full min-[480px]:w-auto" onClick={onShare}>
										<Share2 size={18} aria-hidden="true" />
										Condividi
									</Button>
								)}
							</div>
							<p className="text-sm text-foreground-secondary">{privacyFor(view.upcoming)}</p>

							<div>
								<label aria-busy={nameBusy || undefined} className="flex min-h-11 items-start gap-3">
									<input
										type="checkbox"
										className="mt-1 h-5 w-5 flex-none"
										// Colore della spunta in linea: la utility Tailwind omonima fa scattare il gate VR-06 (cerca l'alias teal).
										style={{ accentColor: "var(--primary)" }}
										aria-describedby="share-name-help"
										checked={link.showName}
										onChange={(event) => onToggleName(event.target.checked)}
									/>
									<span>
										<span className="block text-sm font-semibold text-foreground">Mostra il mio nome</span>
										<span id="share-name-help" className="block break-words text-sm text-foreground-secondary">
											{link.showName && ownerName ? (
												<>
													Chi apre il link vede il titolo «I salvati di <span className="text-foreground">{ownerName}</span>».
												</>
											) : (
												"Chi apre il link vede il titolo «Eventi salvati»."
											)}
										</span>
									</span>
								</label>
								{nameError && (
									<div className="mt-2">
										<Alert>Non siamo riusciti a salvare la scelta. Riprova.</Alert>
									</div>
								)}
							</div>

							<div className="border-t border-border-soft pt-6">
								{/* La conferma PRENDE IL POSTO dei due bottoni (UAT 2026-10-25): sotto i
								    bottoni originali sembrava un doppione di "Disattiva". */}
								{confirm ? (
									<div id={confirm === "off" ? "share-off-confirm" : "share-regen-confirm"} role="group" aria-labelledby="share-confirm-title">
										<p id="share-confirm-title" className="text-sm font-semibold text-foreground">
											{confirm === "off" ? "Disattivare il link?" : "Generare un nuovo link?"}
										</p>
										<p className="mt-1 text-sm text-foreground-secondary">
											{confirm === "off"
												? "Chi ha il link attuale non potrà più aprirlo. Potrai crearne uno nuovo quando vuoi."
												: "Chi ha il link attuale non potrà più aprirlo. Il nuovo link funziona subito."}
										</p>
										{confirmError && (
											<div className="mt-4">
												<Alert>{confirmError}</Alert>
											</div>
										)}
										<div className="mt-4 flex flex-wrap gap-2">
											<Button variant="destructive" size="sm" loading={busy === (confirm === "off" ? "off" : "rotate")} onClick={confirm === "off" ? deactivate : rotate}>
												{confirm === "off" ? "Sì, disattiva" : "Sì, genera"}
											</Button>
											<Button id="share-keep" variant="ghost" size="sm" disabled={busy !== null} onClick={closeConfirm}>
												Annulla
											</Button>
										</div>
									</div>
								) : (
									<div className="flex flex-wrap gap-2">
										<Button id="share-off" variant="ghost" size="sm" disabled={busy !== null} onClick={() => openConfirm("off")}>
											Disattiva link
										</Button>
										<Button id="share-regen" variant="ghost" size="sm" disabled={busy !== null} onClick={() => openConfirm("regen")}>
											Genera nuovo link
										</Button>
									</div>
								)}
							</div>
						</>
					)}
				</div>
				<Dialog.Close asChild>
					<button
						type="button"
						aria-label="Chiudi"
						disabled={busy !== null}
						className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-muted-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
					>
						<X size={20} aria-hidden="true" />
					</button>
				</Dialog.Close>
			</Dialog.Content>
		</Dialog.Root>
	);
}
