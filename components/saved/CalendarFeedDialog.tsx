"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarPlus, Check, Copy, X } from "lucide-react";
import * as Dialog from "@/components/ui/Dialog";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";

/**
 * "Aggiungi al calendario" (22-UI-SPEC Surface 6, CAL-03): il link personale del
 * feed, da incollare o aprire nel calendario. Il link si chiede al server
 * all'apertura (get-or-create: e' lo stesso a ogni apertura, D-11) e le URL
 * assolute si costruiscono SOLO dopo la risposta, mai in un render che gira sul
 * server (React error 418). Nessun intervallo di aggiornamento e nessun
 * promemoria garantito nel testo: dipendono dal calendario dell'utente.
 */
type Link = { status: "loading" } | { status: "ready"; path: string } | { status: "error" };
type CopyState = "idle" | "copied" | "failed";

// Timeout di visualizzazione, non durate di animazione (come ShareButton).
const COPIED_MS = 2000;
const FAILED_MS = 4000;
const COPY_FAILED = "Copia non riuscita. Seleziona il link e copialo a mano.";
const ROTATED = "Nuovo link creato. Quello vecchio non funziona più.";
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

async function requestPath(url: string): Promise<string> {
	const res = await fetch(url, { method: "POST", credentials: "same-origin", cache: "no-store" });
	if (!res.ok) throw new Error(`calendar-feed ${res.status}`);
	const { path } = (await res.json()) as { path?: unknown };
	if (typeof path !== "string" || !path.startsWith("/cal/")) throw new Error("calendar-feed path");
	return path;
}

export default function CalendarFeedDialog() {
	const [open, setOpen] = useState(false);
	const [link, setLink] = useState<Link>({ status: "loading" });
	const [confirming, setConfirming] = useState(false);
	const [rotating, setRotating] = useState(false);
	const [notice, setNotice] = useState("");
	const [copy, setCopy] = useState<CopyState>("idle");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Cosa rifare con "Riprova": una rigenerazione fallita non deve ripiegare sul link vecchio.
	const lastAction = useRef<"load" | "rotate">("load");
	// Scarta le risposte di una richiesta superata (chiusura, nuovo tentativo).
	const generation = useRef(0);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[]
	);

	const run = (action: "load" | "rotate") => {
		lastAction.current = action;
		const mine = ++generation.current;
		if (action === "rotate") setRotating(true);
		else setLink({ status: "loading" });
		requestPath(action === "rotate" ? "/api/v1/me/calendar-feed/rotate" : "/api/v1/me/calendar-feed")
			.then((path) => {
				if (mine !== generation.current) return;
				setLink({ status: "ready", path });
				if (action === "rotate") {
					setConfirming(false);
					setNotice(ROTATED);
				}
			})
			.catch(() => {
				if (mine === generation.current) setLink({ status: "error" });
			})
			.finally(() => {
				if (mine === generation.current) setRotating(false);
			});
	};

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (next) {
			run("load");
			return;
		}
		generation.current++;
		if (timer.current) clearTimeout(timer.current);
		setConfirming(false);
		setRotating(false);
		setNotice("");
		setCopy("idle");
	};

	// Il focus va alla scelta sicura quando la conferma si apre.
	useEffect(() => {
		if (confirming) document.getElementById("feed-keep")?.focus();
	}, [confirming]);

	const closeConfirm = () => {
		setConfirming(false);
		document.getElementById("feed-regen")?.focus();
	};

	const flash = (next: "copied" | "failed", ms: number) => {
		if (timer.current) clearTimeout(timer.current);
		setCopy(next);
		timer.current = setTimeout(() => setCopy("idle"), ms);
	};

	const https = link.status === "ready" ? `${window.location.origin}${link.path}` : "";
	const webcal = link.status === "ready" ? `webcal://${window.location.host}${link.path}` : "";

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(https);
			flash("copied", COPIED_MS);
		} catch {
			// Clipboard assente o negata: il link resta selezionato per la copia a mano.
			(document.getElementById("feed-link") as HTMLInputElement | null)?.select();
			flash("failed", FAILED_MS);
		}
	};

	const status = copy === "copied" ? "Link copiato" : copy === "failed" ? COPY_FAILED : link.status === "loading" ? "Sto preparando il link" : notice;
	const needsLink = link.status !== "ready";

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Trigger asChild>
				<button
					type="button"
					className={`inline-flex h-12 items-center gap-2 rounded-pill bg-surface px-4 text-sm font-semibold text-foreground hover:bg-muted-strong ${FOCUS_RING}`}
					style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
				>
					<CalendarPlus size={18} aria-hidden="true" />
					Aggiungi al calendario
				</button>
			</Dialog.Trigger>
			{/* "!" come in SignInDialog: w-full di Dialog.Content verrebbe dopo w-[calc(...)] nel CSS compilato. */}
			<Dialog.Content
				className="w-[calc(100%-2rem)]!"
				onEscapeKeyDown={(event) => {
					// Prima si chiude la conferma, poi il dialogo.
					if (confirming) {
						event.preventDefault();
						closeConfirm();
					}
				}}
			>
				<div className="space-y-6">
					<Dialog.Title className="pr-10 text-xl font-semibold leading-[1.2] text-foreground">Aggiungi al calendario</Dialog.Title>
					<Dialog.Description className="text-sm text-foreground-secondary">
						I tuoi salvati compaiono nel calendario e si aggiornano da soli. Ogni evento ha un promemoria alle 18:00 del giorno prima, se il tuo calendario lo supporta.
					</Dialog.Description>

					<a
						href={needsLink ? undefined : webcal}
						aria-disabled={needsLink || undefined}
						className={`inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-base font-medium text-primary-foreground transition-colors hover:brightness-90 min-[480px]:w-auto ${FOCUS_RING} ${needsLink ? "pointer-events-none opacity-50" : ""}`}
					>
						Iscriviti con Apple Calendar o Outlook
					</a>

					<div>
						<h3 className="text-sm font-semibold text-foreground">Google Calendar</h3>
						<ol className="mt-2 list-decimal space-y-2 pl-6 text-sm text-foreground">
							<li>Copia il link qui sotto.</li>
							<li>In Google Calendar, accanto ad Altri calendari, tocca + e scegli Da URL.</li>
							<li>Incolla il link e conferma.</li>
						</ol>
					</div>

					<div>
						<label htmlFor="feed-link" className="text-sm font-semibold text-foreground">
							Il tuo link
						</label>
						<div className="mt-2">
							{link.status === "error" ? (
								<div>
									<p className="text-sm text-foreground">Non riusciamo a creare il link. Riprova tra poco.</p>
									<Button variant="secondary" size="sm" className="mt-2" onClick={() => run(lastAction.current)}>
										Riprova
									</Button>
								</div>
							) : link.status === "loading" ? (
								<div aria-hidden="true" className="h-11 rounded-md bg-muted-strong" />
							) : (
								<div className="flex flex-col gap-2 sm:flex-row">
									<div className="min-w-0 flex-1">
										<Input
											id="feed-link"
											readOnly
											value={https}
											size="md"
											className="w-full min-w-0 bg-background"
											onFocus={(event) => event.currentTarget.select()}
										/>
									</div>
									<Button variant="secondary" size="md" className="flex-none" onClick={onCopy}>
										{copy === "copied" ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
										{copy === "copied" ? "Link copiato" : "Copia link"}
									</Button>
								</div>
							)}
							{copy === "failed" && (
								<p aria-hidden="true" className="mt-2 text-sm text-foreground-secondary">
									{COPY_FAILED}
								</p>
							)}
							<span role="status" aria-live="polite" className="sr-only">
								{status}
							</span>
						</div>
					</div>

					<p className="text-sm text-foreground-secondary">Chiunque abbia questo link può vedere i tuoi eventi salvati. Non condividerlo.</p>

					<div className="border-t border-border-soft pt-6">
						<Button
							id="feed-regen"
							variant="ghost"
							size="sm"
							disabled={needsLink}
							aria-expanded={confirming}
							aria-controls="feed-regen-confirm"
							onClick={() => setConfirming(true)}
						>
							Rigenera link
						</Button>
						{confirming && (
							<div id="feed-regen-confirm" className="mt-4">
								<p className="text-sm text-foreground">Il link attuale smetterà di funzionare e dovrai iscriverti di nuovo da ogni calendario.</p>
								<div className="mt-4 flex gap-2">
									<Button variant="destructive" size="sm" loading={rotating} onClick={() => run("rotate")}>
										Rigenera link
									</Button>
									<Button id="feed-keep" variant="ghost" size="sm" disabled={rotating} onClick={closeConfirm}>
										Mantieni il link attuale
									</Button>
								</div>
							</div>
						)}
					</div>
				</div>
				<Dialog.Close asChild>
					<button
						type="button"
						aria-label="Chiudi"
						className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-muted-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
					>
						<X size={20} aria-hidden="true" />
					</button>
				</Dialog.Close>
			</Dialog.Content>
		</Dialog.Root>
	);
}
