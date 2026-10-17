"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
import Image from "next/image";
import { CircleAlert, X } from "lucide-react";
import * as Dialog from "@/components/ui/Dialog";
import { returnPathFrom, safeNextPath } from "@/lib/safeNextPath";

/**
 * Corpo dell'accesso, condiviso fra il dialogo globale e /accedi (D-02, D-03).
 * Il titolo lo porta la shell: Dialog.Title di Radix non esiste fuori da un
 * Dialog.Root, e /accedi vuole un h1. Il pulsante e' un <button> locale: nessuno
 * script di Google, nessuna richiesta a terzi prima del click.
 */
export function SignInPanel({ heading, callbackPath }: { heading: ReactNode; callbackPath?: string }) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<"rate" | "generic" | null>(null);
	const busy = useRef(false);

	const start = async () => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setError(null);
		try {
			// Calcolati nel gestore: window non esiste al render sul server.
			const here = returnPathFrom(window.location.pathname, window.location.search);
			const res = await fetch("/api/auth/sign-in/social", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					provider: "google",
					callbackURL: callbackPath ? safeNextPath(callbackPath) : here,
					errorCallbackURL: here,
				}),
			});
			if (res.ok) {
				const { url } = (await res.json()) as { url?: string };
				if (url) {
					// Resta in "pending" fino a che il browser parte per Google.
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
		setPending(false);
	};

	return (
		<div className="mx-auto w-full max-w-sm">
			{heading}
			{/* Colonna flex: il pulsante di Apple (Fase 25) sara' un fratello qui sotto. */}
			<div className="flex flex-col gap-2">
				<button
					type="button"
					onClick={start}
					disabled={pending}
					aria-busy={pending || undefined}
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
					{pending ? (
						<span
							aria-hidden="true"
							className="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
							style={{ animation: "spin 1s linear infinite" }}
						/>
					) : (
						<Image src="/images/google-g.svg" width={20} height={20} alt="" />
					)}
					<span>{pending ? "Apro Google…" : "Continua con Google"}</span>
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
					heading={
						<Dialog.Title className="mb-6 text-lg font-medium leading-[1.2] text-foreground">Accedi</Dialog.Title>
					}
				/>
				{/* Dopo il pannello nell'ordine del DOM: il primo focus va al pulsante di Google. */}
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
