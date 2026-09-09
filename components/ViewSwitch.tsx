"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, Map as MapIcon, Columns2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

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
	// UAT 12-08 #4: la pillola del tab attivo deve scivolare come il pannello
	// Dove/Quando della navbar (DesktopSearchDropdown.tsx) — stesso
	// meccanismo (`layoutId` + molla `damping:30, stiffness:400`), non
	// un'invenzione nuova. Divergenza dichiarata dal mock: assets/desktop.css
	// da' al tab attivo solo una transizione di background/color, nessuna
	// animazione di elemento condiviso — aggiunta voluta dall'utente.
	// useReducedMotion (framer-motion, dipendenza gia' installata) decide se
	// montare la pillola come motion.span animato o come span statico —
	// nessun `duration:` letterale scritto qui: VR-07 (D-16) vieta durate
	// fuori da lib/motion.ts, e uno span statico e' comunque la resa piu'
	// corretta per prefers-reduced-motion (nessuna animazione, non
	// un'animazione istantanea).
	const shouldReduceMotion = useReducedMotion();
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

	// 12-08/D-3: geometria per variante — mobile 2 colonne a piena larghezza
	// (invariato). Desktop 3 colonne: UAT #7 ha segnalato padding interno e
	// testo troppo vicino ai bordi alla larghezza 380px del mock — divergenza
	// dichiarata dall'utente, non dal mock: 440px (invece di 380) e un
	// padding/gap di container raddoppiato a 4px (invece di 2px) danno alla
	// pillola "Lista e mappa" (l'etichetta lunga che rende il controllo
	// affollato) lo spazio per il proprio padding orizzontale (`px-3`, i
	// bottoni mobile restano senza).
	const gridClass = variant === "desktop" ? "grid-cols-3 w-[440px]" : "grid-cols-2";
	const containerPad = variant === "desktop" ? "gap-1 p-1" : "gap-0.5 p-0.5";
	const buttonPad = variant === "desktop" ? "px-3" : "";

	return (
		<div
			role="tablist"
			aria-label="Vista risultati"
			className={`grid ${gridClass} ${containerPad} rounded-pill bg-surface`}
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
								? `relative flex h-9 items-center justify-center gap-1.5 rounded-pill text-sm font-semibold text-foreground ${buttonPad}`
								: `relative flex h-9 items-center justify-center gap-1.5 rounded-pill text-sm text-foreground-secondary ${buttonPad}`
						}
					>
						{isSelected &&
							(shouldReduceMotion ? (
								<span
									className={`absolute inset-0 rounded-pill ${activeBgClass}`}
									style={
										!isDark
											? { boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.04)" }
											: undefined
									}
								/>
							) : (
								<motion.span
									layoutId={`view-switch-pill-${variant}`}
									className={`absolute inset-0 rounded-pill ${activeBgClass}`}
									style={
										!isDark
											? { boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 0 0 0.5px rgba(0,0,0,0.04)" }
											: undefined
									}
									transition={{ type: "spring", damping: 30, stiffness: 400 }}
								/>
							))}
						<Icon className="relative z-10 h-4 w-4" aria-hidden="true" />
						<span className="relative z-10">{tab.label}</span>
					</button>
				);
			})}
		</div>
	);
}
