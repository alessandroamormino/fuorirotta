"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, Map as MapIcon } from "lucide-react";

export type MobileView = "list" | "map";

const TABS: { value: MobileView; label: string }[] = [
	{ value: "list", label: "Lista" },
	{ value: "map", label: "Mappa" },
];

/** Id condivisi fra ViewSwitch e le due viste che monta (aria-controls/aria-labelledby). */
export const VIEW_SWITCH_TAB_ID: Record<MobileView, string> = {
	list: "view-switch-tab-list",
	map: "view-switch-tab-map",
};
export const VIEW_SWITCH_PANEL_ID: Record<MobileView, string> = {
	list: "view-switch-panel-list",
	map: "view-switch-panel-map",
};

interface ViewSwitchProps {
	value: MobileView;
	onChange: (view: MobileView) => void;
}

/**
 * Segmented control Lista/Mappa (D-08, 12-UI-SPEC.md "Barra superiore",
 * punto 3). Componente controllato: nessuno stato proprio salvo il fuoco
 * tastiera (roving tabIndex, stesso idioma di CategoryFilterBar.tsx).
 */
export default function ViewSwitch({ value, onChange }: ViewSwitchProps) {
	// Questo codebase non usa mai `dark:` di Tailwind (risolverebbe su
	// prefers-color-scheme, non sulla classe .dark che l'utente sceglie a
	// mano) — stesso pattern gia' in EventsMap.tsx/ThemeToggle.tsx per
	// qualunque resa che deve differire per tema: letta dal DOM, non da CSS.
	const [isDark, setIsDark] = useState(false);
	useEffect(() => {
		// Sync da document.documentElement.classList (l'anti-FOUC script l'ha
		// gia' applicata prima del mount) — stesso pattern di ThemeToggle.tsx.
		setIsDark(document.documentElement.classList.contains("dark"));
		const handleThemeChange = (event: Event) => {
			const detail = (event as CustomEvent<{ isDark: boolean }>).detail;
			setIsDark(!!detail?.isDark);
		};
		window.addEventListener("theme-change", handleThemeChange);
		return () => window.removeEventListener("theme-change", handleThemeChange);
	}, []);

	const [focusedValue, setFocusedValue] = useState<MobileView>(value);
	useEffect(() => {
		setFocusedValue(value);
	}, [value]);

	const focusedIndexRaw = TABS.findIndex((tab) => tab.value === focusedValue);
	const focusedIndex = focusedIndexRaw === -1 ? 0 : focusedIndexRaw;
	const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

	const focusTab = (index: number) => {
		setFocusedValue(TABS[index].value);
		tabRefs.current[index]?.focus();
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
		const lastIndex = TABS.length - 1;
		switch (event.key) {
			case "ArrowRight":
				event.preventDefault();
				focusTab(focusedIndex === lastIndex ? 0 : focusedIndex + 1);
				break;
			case "ArrowLeft":
				event.preventDefault();
				focusTab(focusedIndex === 0 ? lastIndex : focusedIndex - 1);
				break;
			case "Home":
				event.preventDefault();
				focusTab(0);
				break;
			case "End":
				event.preventDefault();
				focusTab(lastIndex);
				break;
			default:
				break;
		}
	};

	return (
		<div
			role="tablist"
			aria-label="Vista risultati"
			className="grid grid-cols-2 gap-0.5 rounded-pill bg-surface p-0.5"
			onKeyDown={handleKeyDown}
		>
			{TABS.map((tab, index) => {
				const isSelected = tab.value === value;
				const Icon = tab.value === "list" ? Menu : MapIcon;
				// Sfondo del tab attivo: --background in chiaro, --border in
				// scuro (non lo stesso valore rovesciato: --background scuro e'
				// nero puro, invisibile come "pillola sollevata" su --surface
				// scuro altrettanto vicino al nero — regola dichiarata dalla
				// UI-SPEC, non un adattamento opzionale).
				const activeBgClass = isDark ? "bg-border" : "bg-background";
				return (
					<button
						key={tab.value}
						ref={(el) => {
							tabRefs.current[index] = el;
						}}
						type="button"
						role="tab"
						id={VIEW_SWITCH_TAB_ID[tab.value]}
						aria-selected={isSelected}
						aria-controls={VIEW_SWITCH_PANEL_ID[tab.value]}
						tabIndex={focusedIndex === index ? 0 : -1}
						onClick={() => onChange(tab.value)}
						className={
							isSelected
								? `flex h-9 items-center justify-center gap-1.5 rounded-pill text-sm font-semibold text-foreground ${activeBgClass}`
								: "flex h-9 items-center justify-center gap-1.5 rounded-pill text-sm text-foreground-secondary"
						}
						style={
							isSelected && !isDark
								? { boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.04)" }
								: undefined
						}
					>
						<Icon className="h-4 w-4" aria-hidden="true" />
						{tab.label}
					</button>
				);
			})}
		</div>
	);
}
