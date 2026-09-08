"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, Map as MapIcon, Columns2 } from "lucide-react";

export type MobileView = "list" | "map";
// 12-08/D-3: sovrainsieme desktop dei due stati mobili — "split" e' il terzo
// stato, raggiungibile solo dalla variante desktop dell'interruttore.
export type ViewValue = "list" | "split" | "map";

const MOBILE_TABS: { value: MobileView; label: string }[] = [
	{ value: "list", label: "Lista" },
	{ value: "map", label: "Mappa" },
];

const DESKTOP_TABS: { value: ViewValue; label: string }[] = [
	{ value: "list", label: "Lista" },
	{ value: "split", label: "Lista e mappa" },
	{ value: "map", label: "Mappa" },
];

/** Id condivisi fra ViewSwitch e le viste che monta (aria-controls/aria-labelledby). */
export const VIEW_SWITCH_TAB_ID: Record<ViewValue, string> = {
	list: "view-switch-tab-list",
	split: "view-switch-tab-split",
	map: "view-switch-tab-map",
};
export const VIEW_SWITCH_PANEL_ID: Record<MobileView, string> = {
	list: "view-switch-panel-list",
	map: "view-switch-panel-map",
};

// 12-08/D-3: i tre tab desktop non puntano a tre pannelli distinti (in
// `split` due riquadri sono visibili insieme) — un solo id di regione,
// condiviso dai tre, invece di tre VIEW_SWITCH_PANEL_ID che non avrebbero
// senso per uno stato che mostra due riquadri contemporaneamente.
export const DESKTOP_VIEW_REGION_ID = "desktop-view-region";

interface ViewSwitchProps<V extends ViewValue> {
	value: V;
	onChange: (view: V) => void;
	/** Default "mobile": due tab (Lista/Mappa). "desktop": tre tab, Columns2
	 *  per il segmento centrale, 380px invece di piena larghezza. */
	variant?: "mobile" | "desktop";
}

/**
 * Segmented control Lista/Mappa (mobile) o Lista/Lista e mappa/Mappa
 * (desktop, D-3) — stesso file, due configurazioni: l'idioma (tema letto dal
 * DOM, roving tabIndex, resa del tab attivo) e' identico byte per byte fra
 * le due varianti (12-UI-SPEC.md). Componente controllato: nessuno stato
 * proprio salvo il fuoco tastiera (roving tabIndex, stesso idioma di
 * CategoryFilterBar.tsx).
 *
 * Generico su `V` (default `MobileView`, il sottoinsieme): il ramo mobile
 * continua a passare `MobileView`/`Dispatch<SetStateAction<MobileView>>`
 * senza modifiche, il ramo desktop passa `ViewValue`. Il cast su TABS sotto
 * e' l'unico punto non verificato dal compilatore — la corrispondenza fra
 * `variant` e `V` e' responsabilita' del chiamante (mobile+MobileView,
 * desktop+ViewValue, mai incrociati).
 */
export default function ViewSwitch<V extends ViewValue = MobileView>({
	value,
	onChange,
	variant = "mobile",
}: ViewSwitchProps<V>) {
	const TABS = (variant === "desktop" ? DESKTOP_TABS : MOBILE_TABS) as { value: V; label: string }[];
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

	const [focusedValue, setFocusedValue] = useState<V>(value);
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

	// 12-08/D-3: geometria per variante — desktop rende 3 colonne a 380px fisso,
	// mobile 2 colonne a piena larghezza (invariato).
	const gridClass = variant === "desktop" ? "grid-cols-3 w-[380px]" : "grid-cols-2";

	return (
		<div
			role="tablist"
			aria-label="Vista risultati"
			className={`grid ${gridClass} gap-0.5 rounded-pill bg-surface p-0.5`}
			onKeyDown={handleKeyDown}
		>
			{TABS.map((tab, index) => {
				const isSelected = tab.value === value;
				const Icon = tab.value === "list" ? Menu : tab.value === "split" ? Columns2 : MapIcon;
				// Sfondo del tab attivo: --background in chiaro, --border in
				// scuro (non lo stesso valore rovesciato: --background scuro e'
				// nero puro, invisibile come "pillola sollevata" su --surface
				// scuro altrettanto vicino al nero — regola dichiarata dalla
				// UI-SPEC, non un adattamento opzionale).
				const activeBgClass = isDark ? "bg-border" : "bg-background";
				// I tre tab desktop non hanno tre pannelli distinti (in `split`
				// due riquadri sono visibili insieme): tutti e tre puntano alla
				// stessa regione. I due tab mobili mantengono i propri pannelli.
				const ariaControls =
					variant === "desktop" ? DESKTOP_VIEW_REGION_ID : VIEW_SWITCH_PANEL_ID[tab.value as MobileView];
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
						aria-controls={ariaControls}
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
