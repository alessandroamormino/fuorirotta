"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle() {
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
			// ponytail: fixed top-right z-[300] is a provisional placement, Phase 12 decides the final spot
			className="fixed top-4 right-4 z-[300] flex h-10 w-10 items-center justify-center rounded-full bg-surface border border-border text-foreground shadow-sm hover:border-primary/50 transition-colors"
		>
			{isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
		</button>
	);
}
