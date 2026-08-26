"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * D-09 (Fase 17): un solo toggle in tutto il prodotto, in flusso dentro la
 * Navbar — nessuna variante flottante (`position: fixed`) resta raggiungibile,
 * nemmeno come fallback di default. `className` personalizza la resa (la
 * Navbar passa la propria), ma un montaggio senza className (es. la
 * vetrina `/dev/ui-primitives`) deve comunque restare in flusso nel proprio
 * contenitore, mai fluttuare fuori da esso.
 */
export default function ThemeToggle({ className }: { className?: string }) {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from the DOM class the anti-FOUC script already applied, never from localStorage/render, per D-01
		setIsDark(document.documentElement.classList.contains("dark"));
	}, []);

	const toggleTheme = () => {
		const next = !isDark;
		document.documentElement.classList.toggle("dark", next);
		try {
			localStorage.setItem("theme", next ? "dark" : "light");
		} catch {
			// localStorage unavailable (private browsing) — theme stays session-only
		}
		window.dispatchEvent(new CustomEvent("theme-change", { detail: { isDark: next } }));
		setIsDark(next);
	};

	return (
		<button
			type="button"
			onClick={toggleTheme}
			aria-label={isDark ? "Passa al tema chiaro" : "Passa al tema scuro"}
			className={
				className ??
				// Default in flusso (D-09): stessa forma visiva del montaggio in
				// barra, senza alcun posizionamento fixed/absolute.
				"flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full bg-surface border border-border text-foreground shadow-sm hover:border-primary/50 transition-colors"
			}
		>
			{isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
		</button>
	);
}
