"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";
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
	const busy = useRef(false);

	const start = async () => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
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
					window.location.assign(url);
					return;
				}
			}
		} catch {
			// rete assente: gestito sotto come ogni altro fallimento
		}
		busy.current = false;
		setPending(false);
	};

	return (
		<div className="mx-auto w-full max-w-sm">
			{heading}
			<div className="flex flex-col gap-2">
				<button type="button" onClick={start} disabled={pending}>
					Continua con Google
				</button>
			</div>
			<p className="mt-4 text-sm text-foreground-secondary">
				Continuando accetti l&apos;
				<a href="/privacy" target="_blank" rel="noopener noreferrer">
					informativa privacy
				</a>
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
			<Dialog.Content
				className="w-[calc(100%-2rem)]"
				aria-describedby={undefined}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					returnFocusTo.current?.focus();
				}}
			>
				<SignInPanel heading={<Dialog.Title>Accedi</Dialog.Title>} />
			</Dialog.Content>
		</Dialog.Root>
	);
}
