"use client";

import { useSyncExternalStore } from "react";

// Stato che vive nel browser, non in React: lo si legge con
// useSyncExternalStore invece che con useState + useEffect, che al mount
// disegnava prima il valore sbagliato e poi lo correggeva (un render in piu',
// e la regola react-hooks/set-state-in-effect di React 19).
// Lo snapshot lato server e' `false` in entrambi i casi, come il vecchio
// useState(false): l'HTML del server non cambia.

export const DESKTOP_MEDIA_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
	const mql = window.matchMedia(DESKTOP_MEDIA_QUERY);
	mql.addEventListener("change", onChange);
	return () => mql.removeEventListener("change", onChange);
}

/**
 * Superficie desktop: la stessa media query a 1024px del CSS (D-8, 12-10),
 * una sola verita' condivisa da HomeClient ed EventDetailClient.
 */
export function useIsDesktopSurface(): boolean {
	return useSyncExternalStore(
		subscribeDesktop,
		() => window.matchMedia(DESKTOP_MEDIA_QUERY).matches,
		() => false
	);
}

function subscribeTheme(onChange: () => void) {
	window.addEventListener("theme-change", onChange);
	return () => window.removeEventListener("theme-change", onChange);
}

/**
 * Tema scuro letto dalla classe su <html>, che lo script anti-FOUC applica
 * prima del mount (D-01) e ThemeToggle cambia annunciandolo con l'evento
 * `theme-change`.
 */
export function useIsDark(): boolean {
	return useSyncExternalStore(
		subscribeTheme,
		() => document.documentElement.classList.contains("dark"),
		() => false
	);
}
