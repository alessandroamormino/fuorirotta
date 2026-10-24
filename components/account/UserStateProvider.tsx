"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SignInDialog from "./SignIn";
import SavedSync from "../saved/SavedSync";
import FollowSync from "../follow/FollowSync";
import { clearFollowIntent } from "@/lib/follows/intent";

/**
 * Stato dell'utente per le isole client (D-01, D-07, D-19). Sul server e al
 * primo render del client e' SEMPRE lo stato da ospite (enabled null, user
 * null): le pagine pubbliche sono in cache condivisa e non conoscono nessuno
 * (ACCT-05), e un valore diverso al primo render e' un errore di idratazione
 * (React 418). La verita' si chiede dopo il mount a /api/v1/me/state.
 *
 * Qui vive anche l'UNICO dialogo di accesso dell'app: chi vuole farlo aprire
 * (icona della barra, le righe di /salvati) chiama openSignIn(); chi sta in
 * un'altra radice React, come il cuore nel popup della mappa, chiama
 * requestSignIn(). Il cuore NON apre mai l'accesso a un tocco (D-04): solo
 * l'azione dell'avviso del tetto dei 100 salvati.
 */
export interface UserState {
	/** null finche' lo stato non e' arrivato; false = interruttore spento sul server. */
	enabled: boolean | null;
	user: { name: string; email: string; image: string | null } | null;
	openSignIn: () => void;
}

const GUEST: UserState = { enabled: null, user: null, openSignIn: () => {} };

const UserStateContext = createContext<UserState>(GUEST);

// Come il listener di notify(): una funzione di modulo, perche' il popup della mappa
// e' una createRoot a parte e un Context non ci arriva. No-op finche' il provider non e' montato.
let signInOpener: (() => void) | null = null;

export function requestSignIn(): void {
	signInOpener?.();
}

export function useUserState(): UserState {
	return useContext(UserStateContext);
}

export function UserStateProvider({ children }: { children: ReactNode }) {
	const [remote, setRemote] = useState<Pick<UserState, "enabled" | "user">>({ enabled: null, user: null });
	const [open, setOpen] = useState(false);
	// Dove riportare il focus alla chiusura: il dialogo e' globale, senza Trigger Radix.
	const returnFocusTo = useRef<HTMLElement | null>(null);

	useEffect(() => {
		// Il valore e' inlinato alla build: senza il flag non parte nessuna richiesta.
		if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") return;
		const controller = new AbortController();
		fetch("/api/v1/me/state", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
			.then((res) => (res.ok ? res.json() : null))
			.then((data: { enabled?: boolean; user?: { name: string; email: string; image?: string | null } | null } | null) => {
				if (!data || typeof data.enabled !== "boolean") return;
				setRemote({ enabled: data.enabled, user: data.user ? { ...data.user, image: data.user.image ?? null } : null });
			})
			.catch(() => {
				// Lo stato e' una lettura di sfondo: se fallisce resta l'ospite, e un
				// problema vero di sessione emerge quando l'utente prova ad accedere.
			});
		return () => controller.abort();
	}, []);

	const openSignIn = useCallback(() => {
		returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		setOpen(true);
	}, []);

	useEffect(() => {
		signInOpener = openSignIn;
		return () => {
			if (signInOpener === openSignIn) signInOpener = null;
		};
	}, [openSignIn]);

	// Chiudere il dialogo senza accedere scarta l'intento di follow (D-01). Il rimando a Google e'
	// una navigazione completa che non passa di qui: l'intento sopravvive al giro.
	const onOpenChange = useCallback((next: boolean) => {
		if (!next) clearFollowIntent();
		setOpen(next);
	}, []);

	const value = useMemo<UserState>(() => ({ ...remote, openSignIn }), [remote, openSignIn]);

	return (
		<UserStateContext.Provider value={value}>
			{children}
			<SignInDialog open={open} onOpenChange={onOpenChange} returnFocusTo={returnFocusTo} />
			<SavedSync />
			<FollowSync />
		</UserStateContext.Provider>
	);
}
