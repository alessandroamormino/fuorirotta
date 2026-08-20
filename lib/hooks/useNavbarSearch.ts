import { useEffect, useState } from "react";
import type { SearchFilters } from "@/lib/types";
import {
	SUGGESTED_DESTINATIONS,
	DEST_PREVIEW_COUNT,
	type SuggestedDestination,
} from "@/lib/destinations";

type ActiveField = "where" | "when" | "mobile_search" | null;

interface UseNavbarSearchArgs {
	onSearch: (filters: SearchFilters) => void;
}

const capitalizeFirstLetter = (str: string) => {
	if (!str) return str;
	return str.charAt(0).toUpperCase() + str.slice(1);
};

const getIconForDestination = (iconType: string) => {
	switch (iconType) {
		case "nearby":
			return "📍";
		case "city":
			return "🏙️";
		case "castle":
			return "🏰";
		case "lake":
			return "🏞️";
		case "monument":
			return "🏛️";
		case "music":
			return "🎵";
		case "mountain":
			return "⛰️";
		default:
			return "📍";
	}
};

// Stato e handler della Navbar, chiamato una sola volta dalla shell (D-09,
// D-10). Il markup resta diviso per superficie (mobile/desktop); qui vive
// solo la logica condivisa. Restituisce pochi oggetti coerenti, non 14
// valori sciolti (RESEARCH.md Pitfall 5).
export function useNavbarSearch({ onSearch }: UseNavbarSearchArgs) {
	const [activeField, setActiveField] = useState<ActiveField>(null);
	const [filters, setFilters] = useState<SearchFilters>({
		location: "",
		dateFrom: null,
		dateTo: null,
	});

	// D-11: searchInput/mobileSearchInput erano due stati paralleli, mutuamente
	// esclusivi per breakpoint. Unificati in uno solo: nessuna differenza
	// osservabile, perche' desktop e mobile non sono mai visibili insieme.
	const [searchInput, setSearchInputState] = useState("");
	const [showRadiusSelector, setShowRadiusSelector] = useState(false);
	const [selectedRadius, setSelectedRadius] = useState<number | null>(null);
	// D-11: customRadius (30) e mobileCustomRadius (20) unificati in un solo
	// stato, default 20 — allineato all'opzione gia' etichettata "Nelle
	// vicinanze" in RADIUS_OPTIONS. E' la sola deviazione osservabile voluta
	// dell'intero piano (vedi SUMMARY e checkpoint del Task 3).
	const [customRadius, setCustomRadius] = useState(20);
	const [isNearbySearch, setIsNearbySearch] = useState(false);

	// Mobile overlay state — resta per superficie, non ha equivalente desktop.
	const [mobileDestExpanded, setMobileDestExpanded] = useState(false);
	const [mobileWhenOpen, setMobileWhenOpen] = useState(false);
	const [mobileNearbyOpen, setMobileNearbyOpen] = useState(false);

	// T-09-13: il listener manuale su `document` che chiudeva il dropdown al
	// click fuori (e il ref che lo supportava) sono spariti da qui nello
	// stesso commit in cui il dropdown desktop adotta Popover (D-13,
	// DesktopSearchDropdown.tsx): e' Radix, non piu' questo hook, a possedere
	// la chiusura per click esterno, Escape e il ripristino del focus. Il
	// mobile overlay (Dialog) non ha mai usato questo listener.

	// Blocca scroll body quando overlay mobile è aperto
	useEffect(() => {
		if (activeField === "mobile_search") {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [activeField]);

	// Digitare (o svuotare, con lo stesso percorso) il campo destinazione: su
	// entrambe le superfici azzera sempre l'identita' esatta del comune
	// (comuneId/comuneIstatCode, D-01) e il raggio "Nelle vicinanze" in corso.
	// Sul desktop era gia' cosi' (D-01, 09-02); estenderlo al mobile non
	// cambia nulla di osservabile perche' le due superfici sono mutuamente
	// esclusive per breakpoint (D-11) e il campo mobile non ha mai impostato
	// comuneId/comuneIstatCode di suo.
	const setInput = (value: string) => {
		const capitalized = capitalizeFirstLetter(value);
		setSearchInputState(capitalized);
		setFilters((f) => ({
			...f,
			location: capitalized,
			comuneId: undefined,
			comuneIstatCode: undefined,
		}));
		setIsNearbySearch(false);
		setSelectedRadius(null);
	};

	const hasActiveFilters = Boolean(
		filters.location || filters.dateFrom || filters.dateTo,
	);

	const submit = () => {
		onSearch({ ...filters, radius: selectedRadius || undefined });
		setActiveField(null);
	};

	const submitMobile = () => {
		onSearch({ ...filters, radius: selectedRadius || undefined });
		setActiveField(null);
		setMobileDestExpanded(false);
		setMobileWhenOpen(false);
	};

	// D-16: comportamento preesistente conservato, non un dimenticanza. Il
	// "Cancella" desktop propaga subito il reset a valle chiamando onSearch —
	// la lista eventi sotto si aggiorna nello stesso istante.
	const clear = () => {
		setFilters({
			location: "",
			dateFrom: null,
			dateTo: null,
			radius: undefined,
		});
		setSearchInputState("");
		setSelectedRadius(null);
		setIsNearbySearch(false);
		setActiveField(null);
		onSearch({ location: "", dateFrom: null, dateTo: null, radius: undefined });
	};

	// D-16: controparte asimmetrica di clear() sopra. "Cancella tutto" mobile
	// azzera solo lo stato locale e i pannelli dell'overlay — NON chiama
	// onSearch. La lista sotto resta ferma finche' non si preme di nuovo
	// Cerca. Divergenza preesistente dalla baseline, conservata di proposito.
	const clearMobile = () => {
		setFilters({
			location: "",
			dateFrom: null,
			dateTo: null,
			radius: undefined,
		});
		setSearchInputState("");
		setSelectedRadius(null);
		setIsNearbySearch(false);
		setMobileDestExpanded(false);
		setMobileWhenOpen(false);
	};

	// Preset immediato (solo desktop): cliccare una delle tre righe 10/20/50km
	// applica subito il raggio, chiude il selettore e apre "Quando" — a
	// differenza del mobile, dove le stesse tre opzioni si limitano a
	// impostare radius.custom (vedi markup: onClick={() => radius.setCustom(...)})
	// e serve un tocco separato su "Conferma" per applicare (applyCustomMobile).
	const applyPreset = (value: number, label: string) => {
		setSelectedRadius(value);
		setSearchInputState(`Nelle vicinanze (${label})`);
		setFilters((f) => ({
			...f,
			location: `Nelle vicinanze (${label})`,
			radius: value,
		}));
		setIsNearbySearch(true);
		setShowRadiusSelector(false);
		setActiveField("when");
	};

	// Le due conferme del raggio personalizzato restano due funzioni distinte:
	// applyCustomDesktop scrive l'etichetta nel campo Dove, applyCustomMobile
	// lo azzera (perche' la pill della searchbar mostra gia' l'etichetta) e
	// apre il passo "Quando" mobile. Flussi di superficie diversi, non un
	// comportamento da uniformare.
	const applyCustomDesktop = () => {
		setSelectedRadius(customRadius);
		setSearchInputState(`Nelle vicinanze (${customRadius} km)`);
		setFilters((f) => ({
			...f,
			location: `Nelle vicinanze (${customRadius} km)`,
			radius: customRadius,
		}));
		setIsNearbySearch(true);
		setShowRadiusSelector(false);
		setActiveField("when");
	};

	const applyCustomMobile = () => {
		const label = `Nelle vicinanze (${customRadius} km)`;
		// L'etichetta NON entra nell'input: la mostra gia' la pill della
		// searchbar. Lasciandola qui, riaprire "Dove?" mostrava i risultati di
		// ricerca per una stringa senza senso invece delle destinazioni
		// suggerite, e per cambiare filtro bisognava cancellare la frase a mano.
		setSearchInputState("");
		setFilters((f) => ({
			...f,
			location: label,
			radius: customRadius,
		}));
		setSelectedRadius(customRadius);
		setIsNearbySearch(true);
		setMobileNearbyOpen(false);
		setMobileWhenOpen(true);
	};

	// Selezione di un comune identico per identita', qualunque sia la strada
	// che ci arriva (D-07): l'autocomplete (09-02) e le destinazioni suggerite
	// (sotto) finiscono nello stesso stato, mai in due percorsi separati.
	const applyComuneIdentity = (opts: {
		name: string;
		comuneId?: number;
		comuneIstatCode?: string;
	}) => {
		setSearchInputState(opts.name);
		setFilters((f) => ({
			...f,
			location: opts.name,
			comuneId: opts.comuneId,
			comuneIstatCode: opts.comuneIstatCode,
		}));
		setIsNearbySearch(false);
		setSelectedRadius(null);
	};

	const selectComune = (comune: {
		id: number;
		istatCode: string;
		name: string;
	}) =>
		applyComuneIdentity({
			name: comune.name,
			comuneId: comune.id,
			comuneIstatCode: comune.istatCode,
		});

	// D-07: il click su una destinazione suggerita produce la stessa selezione
	// dell'autocomplete — comuneId resta undefined (le destinazioni suggerite
	// conoscono solo l'istatCode, non la chiave surrogata, che e' un
	// autoincrement diverso fra locale e produzione), nessuna chiamata di
	// rete per risolvere il nome. La voce "Nelle vicinanze" (isNearby) non
	// tocca l'identita' del comune: l'apertura del selettore del raggio resta
	// al markup, che differisce per superficie (showSelector vs mobileNearbyOpen).
	const selectSuggested = (dest: SuggestedDestination) => {
		if (dest.isNearby) return;
		applyComuneIdentity({
			name: dest.name,
			comuneId: undefined,
			comuneIstatCode: dest.istatCode ?? undefined,
		});
	};

	// D-08 + D-16 (seconda asimmetria preesistente): anteprima a
	// DEST_PREVIEW_COUNT con "mostra tutte/mostra meno", lista che si nasconde
	// mentre si digita. Oggi SOLO il markup mobile consuma questo derivato —
	// il desktop rende sempre l'intero SUGGESTED_DESTINATIONS in un
	// contenitore scrollabile, senza bottone di espansione (scoperta della
	// baseline 09-01, non prevista dai documenti di pianificazione). L'hook
	// espone il derivato; quale superficie lo usa resta una scelta del
	// markup, che 09-04/09-05 replicheranno com'e' oggi.
	const filteredDestinations = searchInput.trim()
		? SUGGESTED_DESTINATIONS.filter((d) =>
				d.name.toLowerCase().includes(searchInput.toLowerCase()),
			)
		: SUGGESTED_DESTINATIONS;

	const visible = searchInput.trim()
		? filteredDestinations
		: mobileDestExpanded
			? SUGGESTED_DESTINATIONS
			: SUGGESTED_DESTINATIONS.slice(0, DEST_PREVIEW_COUNT);

	const canToggle =
		!searchInput.trim() && SUGGESTED_DESTINATIONS.length > DEST_PREVIEW_COUNT;

	return {
		filters,
		setFilters,
		search: {
			input: searchInput,
			setInput,
			submit,
			submitMobile,
			clear,
			clearMobile,
			hasActiveFilters,
		},
		radius: {
			selected: selectedRadius,
			setSelected: setSelectedRadius,
			custom: customRadius,
			setCustom: setCustomRadius,
			showSelector: showRadiusSelector,
			setShowSelector: setShowRadiusSelector,
			isNearby: isNearbySearch,
			setIsNearby: setIsNearbySearch,
			applyPreset,
			applyCustomDesktop,
			applyCustomMobile,
		},
		panels: {
			activeField,
			setActiveField,
			mobileDestExpanded,
			setMobileDestExpanded,
			mobileWhenOpen,
			setMobileWhenOpen,
			mobileNearbyOpen,
			setMobileNearbyOpen,
		},
		destinations: {
			visible,
			canToggle,
			iconFor: getIconForDestination,
			selectComune,
			selectSuggested,
		},
	};
}
