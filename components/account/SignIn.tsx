"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import Image from "next/image";
import { CircleAlert, X } from "lucide-react";
import * as Dialog from "@/components/ui/Dialog";
import { returnPathFrom, safeNextPath } from "@/lib/safeNextPath";
import AppleLogo from "./AppleLogo";
import { useUserState } from "./UserStateProvider";

/**
 * Corpo dell'accesso, condiviso fra il dialogo globale e /accedi (D-02, D-03).
 * Il titolo lo porta la shell: Dialog.Title di Radix non esiste fuori da un
 * Dialog.Root, e /accedi vuole un h1. I pulsanti sono <button> locali: nessuno
 * script di Google o di Apple, nessuna richiesta a terzi prima del click.
 * `apple`: true = pulsante di Apple sopra quello di Google (D-01); null = stato
 * non ancora arrivato, un segnaposto statico tiene il posto cosi' Google non
 * salta; false = solo Google, come nella Fase 21.
 */
type Provider = "apple" | "google";

export function SignInPanel({
	heading,
	callbackPath,
	apple,
}: {
	heading: ReactNode;
	callbackPath?: string;
	apple: boolean | null;
}) {
	const [pending, setPending] = useState<Provider | null>(null);
	const [error, setError] = useState<"rate" | "generic" | null>(null);
	const busy = useRef(false);

	const start = async (provider: Provider) => {
		if (busy.current) return;
		busy.current = true;
		setPending(provider);
		setError(null);
		try {
			// Calcolati nel gestore: window non esiste al render sul server.
			const here = returnPathFrom(window.location.pathname, window.location.search);
			// Il ritorno d'errore nomina il provider (via=), cosi' l'avviso sa chi ha fallito.
			// Passa da safeNextPath: resta un percorso relativo, mai un indirizzo esterno.
			const errorHere = safeNextPath(`${here}${here.includes("?") ? "&" : "?"}via=${provider}`);
			const res = await fetch("/api/auth/sign-in/social", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					provider,
					callbackURL: callbackPath ? safeNextPath(callbackPath) : here,
					errorCallbackURL: errorHere,
				}),
			});
			if (res.ok) {
				const { url } = (await res.json()) as { url?: string };
				if (url) {
					// Resta in "pending" fino a che il browser parte per il provider.
					window.location.assign(url);
					return;
				}
			}
			setError(res.status === 429 ? "rate" : "generic");
		} catch {
			// Rete assente o risposta illeggibile: stesso messaggio di ogni altro fallimento.
			setError("generic");
		}
		busy.current = false;
		setPending(null);
	};

	return (
		<div className="mx-auto w-full max-w-sm">
			{heading}
			{/* Colonna flex: Apple sopra Google (D-01), stessa misura (D-03). */}
			<div className="flex flex-col gap-2">
				{apple === true && (
					<button
						type="button"
						onClick={() => start("apple")}
						disabled={pending !== null}
						aria-busy={pending === "apple" || undefined}
						style={{
							backgroundColor: "var(--apple-btn-bg)",
							borderColor: "var(--apple-btn-bg)",
							color: "var(--apple-btn-fg)",
						}}
						className={
							"relative inline-flex h-12 w-full items-center justify-center gap-3 rounded-pill border px-6 text-sm font-medium " +
							// Strato di stato del marchio: stesso velo del pulsante di Google, con il colore del testo di Apple.
							"before:absolute before:inset-0 before:rounded-pill before:bg-[var(--apple-btn-fg)] before:opacity-0 " +
							"before:transition-opacity before:duration-(--motion-fast) before:ease-(--ease-standard) " +
							"hover:before:opacity-[0.08] active:before:opacity-[0.12] disabled:cursor-default " +
							"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
						}
					>
						{pending === "apple" ? (
							<span
								aria-hidden="true"
								className="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
								style={{ animation: "spin 1s linear infinite" }}
							/>
						) : (
							<AppleLogo size={20} />
						)}
						<span>{pending === "apple" ? "Apro Apple…" : "Continua con Apple"}</span>
					</button>
				)}
				{apple === null && <div aria-hidden="true" className="h-12 rounded-pill bg-muted-strong" />}
				<button
					type="button"
					onClick={() => start("google")}
					disabled={pending !== null}
					aria-busy={pending === "google" || undefined}
					style={{
						backgroundColor: "var(--google-btn-bg)",
						borderColor: "var(--google-btn-border)",
						color: "var(--google-btn-fg)",
					}}
					className={
						"relative inline-flex h-12 w-full items-center justify-center gap-3 rounded-pill border px-6 text-sm font-medium " +
						// Strato di stato del marchio: velo del colore del testo, 0.08 al passaggio e 0.12 alla pressione.
						"before:absolute before:inset-0 before:rounded-pill before:bg-[var(--google-btn-fg)] before:opacity-0 " +
						"before:transition-opacity before:duration-(--motion-fast) before:ease-(--ease-standard) " +
						"hover:before:opacity-[0.08] active:before:opacity-[0.12] disabled:cursor-default " +
						"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
					}
				>
					{pending === "google" ? (
						<span
							aria-hidden="true"
							className="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
							style={{ animation: "spin 1s linear infinite" }}
						/>
					) : (
						<Image src="/images/google-g.svg" width={20} height={20} alt="" />
					)}
					<span>{pending === "google" ? "Apro Google…" : "Continua con Google"}</span>
				</button>
			</div>
			{error && (
				<p role="alert" className="mt-4 flex items-start gap-2 text-sm text-foreground">
					<CircleAlert size={18} aria-hidden="true" className="mt-px flex-none text-destructive" />
					<span>
						{error === "rate"
							? "Troppi tentativi, riprova tra qualche minuto"
							: "Non siamo riusciti ad avviare l'accesso. Riprova."}
					</span>
				</p>
			)}
			<p className="mt-4 text-sm text-foreground-secondary">
				Continuando accetti l&apos;
				<a
					href="/privacy"
					target="_blank"
					rel="noopener noreferrer"
					className="rounded-sm text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
				>
					informativa privacy
				</a>
				<span className="sr-only"> (si apre in una nuova scheda)</span>
			</p>
		</div>
	);
}

export default function SignInDialog({
	open,
	onOpenChange,
	returnFocusTo,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	returnFocusTo: RefObject<HTMLElement | null>;
}) {
	// null finche' /api/v1/me/state non risponde: il pannello tiene il posto di Apple (ACCT-05:
	// le pagine pubbliche non conoscono il flag, arriva solo dopo il mount).
	const { apple } = useUserState();
	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			{/* "!" perche' w-full di Dialog.Content viene DOPO w-[calc(...)] nel CSS compilato
			    e lo batterebbe (verificato): senza, sotto i 512px il pannello tocca i bordi. */}
			<Dialog.Content
				className="w-[calc(100%-2rem)]!"
				aria-describedby={undefined}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocusTo.current?.focus();
				}}
			>
				<SignInPanel
					apple={apple}
					heading={
						<Dialog.Title className="mb-6 text-lg font-medium leading-[1.2] text-foreground">Accedi</Dialog.Title>
					}
				/>
				{/* Dopo il pannello nell'ordine del DOM: il primo focus va al primo pulsante (Apple se c'e', altrimenti Google). */}
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
