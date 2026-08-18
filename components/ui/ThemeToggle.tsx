"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

/**
 * `className` permette di montarlo dentro un contenitore invece che flottante.
 * Serve perche' su mobile la posizione fissa non ha un angolo libero: in alto
 * copriva la searchbar, in basso la paginazione. Nel Navbar viene montato come
 * quarta icona del pannello di ricerca, dove non puo' coprire nulla.
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
				// Default: flottante in alto a destra, ma solo da md in su.
				// Su mobile lo monta il Navbar (vedi sopra).
				"fixed top-4 right-4 z-[300] hidden md:flex h-10 w-10 items-center justify-center rounded-full bg-surface border border-border text-foreground shadow-sm hover:border-primary/50 transition-colors"
			}
		>
			{isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
		</button>
	);
}
