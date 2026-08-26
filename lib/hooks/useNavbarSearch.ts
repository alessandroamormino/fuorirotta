import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { SearchFilters } from "@/lib/types";
import {
	SUGGESTED_DESTINATIONS,
	DEST_PREVIEW_COUNT,
	type SuggestedDestination,
} from "@/lib/destinations";

type ActiveField = "where" | "when" | "mobile_search" | null;

// D-07: i filtri sono posseduti dal genitore (HomeClient.draftFilters);
// l'hook li riceve come valore piu' callback invece di crearli con useState.
interface UseNavbarSearchArgs {
	filters: SearchFilters;
	onFiltersChange: (filters: SearchFilters) => void;
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
export function useNavbarSearch({ filters, onFiltersChange, onSearch }: UseNavbarSearchArgs) {
	const [activeField, setActiveField] = useState<ActiveField>(null);

	// D-07: shim di una riga sopra onFiltersChange — conserva la firma
	// Dispatch<SetStateAction<SearchFilters>> che i call site interni usano
	// (valore o forma funzionale); nessun handler la chiama due volte nello
	// stesso tick, quindi risolvere la forma funzionale sul `filters` del
	// render corrente e' sempre corretto.
	const setFilters: Dispatch<SetStateAction<SearchFilters>> = (value) => {
		onFiltersChange(
			typeof value === "function"
				? (value as (prev: SearchFilters) => SearchFilters)(filters)
				: value,
		);
	};

	// D-11: searchInput/mobileSearchInput erano due stati paralleli, mutuamente
	// esclusivi per breakpoint, poi unificati in un solo stato autonomo. D-07
	// lo deriva invece che possederlo: vale sempre filters.location, con
	// l'unica eccezione di applyCustomMobile (sotto), che vuole l'etichetta
	// nel filtro ma l'input vuoto — inputOverride cattura solo quella
	// deviazione (null = "segui filters.location").
	const [inputOverride, setInputOverride] = useState<string | null>(null);
	const searchInput = inputOverride ?? filters.location;
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
		// Difetto C (checkpoint Task 5, 11-05-PLAN.md): svuotare l'ultimo
		// filtro rimasto (Dove, quando anche Quando e' gia' vuoto) e' "parti
		// da zero", non "pulisci il campo" — stesso comportamento di clear()
		// piu' sotto: filtri azzerati e onSearch propagato, come al primo
		// caricamento. Seam unico: sia la X desktop sia quella del campo
		// dentro l'overlay mobile chiamano gia' setInput("") per svuotare il
		// testo, quindi ereditano il reset senza che nessun call site duplichi
		// la condizione. Se restano le date, lo scope non si estende: il
		// comportamento resta quello di sotto, invariato. Non tocca
		// selectedCategory: questo hook non lo conosce nemmeno.
		// WR-02: usa resetFilters (non clear()) — questo percorso scatta a ogni
		// tasto premuto nel campo Dove (anche dentro l'overlay mobile), e clear()
		// tocca anche activeField chiudendo il pannello/Dialog di ricerca a meta'
		// digitazione. resetFilters lascia il pannello aperto.
		if (!capitalized && !filters.dateFrom && !filters.dateTo) {
			resetFilters();
			return;
		}
		setInputOverride(null);
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

	// WR-02: solo-reset-filtri, senza toccare activeField ne' i pannelli
	// mobile — estratta da clear() perche' setInput() (che scatta a ogni
	// tasto, anche dentro l'overlay mobile) non deve chiudere il pannello o
	// smontare il Dialog di ricerca. clear() sotto resta la variante completa
	// per il bottone "Cancella" esplicito: chiama questa e in piu' chiude il
	// pannello.
	const resetFilters = () => {
		setFilters({
			location: "",
			dateFrom: null,
			dateTo: null,
			radius: undefined,
		});
		setInputOverride(null);
		setSelectedRadius(null);
		setIsNearbySearch(false);
		onSearch({ location: "", dateFrom: null, dateTo: null, radius: undefined });
	};

	// D-16: comportamento preesistente conservato, non un dimenticanza. Il
	// "Cancella" desktop propaga subito il reset a valle chiamando onSearch —
	// la lista eventi sotto si aggiorna nello stesso istante.
	const clear = () => {
		resetFilters();
		setActiveField(null);
	};

	// D-08: l'asimmetria con clear() sopra e' chiusa. "Cancella tutto" mobile
	// azzera i filtri con la stessa resetFilters() di clear() — che propaga
	// subito con onSearch, l'eccezione dell'ultimo filtro rimasto (D-08) — e
	// si limita in piu' a chiudere i pannelli mobile. Non chiude il Dialog
	// dell'overlay: quello resta il comportamento di oggi, D-08 unifica solo
	// la propagazione, non la resa.
	const clearMobile = () => {
		resetFilters();
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
		setInputOverride(null);
		setFilters((f) => ({
			...f,
			location: `Nelle vicinanze (${label})`,
			radius: value,
			// WR-02: passare a un raggio e' un cambio di destinazione tanto
			// quanto digitare un nuovo testo — setInput gia' azzera questi due
			// campi, gli applier del raggio no. Senza il reset, un comuneId
			// selezionato in precedenza sopravvive e /api/events lo AND-a al
			// filtro raggio: una ricerca "nelle vicinanze" restituisce in
			// silenzio solo gli eventi del comune scelto prima.
			comuneId: undefined,
			comuneIstatCode: undefined,
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
		setInputOverride(null);
		setFilters((f) => ({
			...f,
			location: `Nelle vicinanze (${customRadius} km)`,
			radius: customRadius,
			// WR-02: vedi applyPreset sopra — stesso reset, stesso motivo.
			comuneId: undefined,
			comuneIstatCode: undefined,
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
		setInputOverride("");
		setFilters((f) => ({
			...f,
			location: label,
			radius: customRadius,
			// WR-02: vedi applyPreset sopra — stesso reset, stesso motivo. Su
			// mobile e' anche il percorso piu' facilmente raggiungibile: questo
			// e' l'unico applier che svuota searchInput lasciando un'etichetta
			// in filters.location, cosi' la lista preset (incluso "Nelle
			// vicinanze") torna raggiungibile con l'identita' del comune ancora
			// impostata, se non azzerata qui.
			comuneId: undefined,
			comuneIstatCode: undefined,
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
		setInputOverride(null);
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
	//
	// WR-09: filteredDestinations era un filtro locale con includes() su
	// SUGGESTED_DESTINATIONS — esattamente il meccanismo che D-19 ha rimosso
	// (la stessa regressione che 7852a38 aveva gia' causato una volta).
	// Restava irraggiungibile: `visible` lo consumava solo nel ramo FALSE del
	// ternario isFiltering ? … : … in MobileSearchOverlay, dove
	// searchInput.trim() e' per definizione vuoto. Rimosso per non invitare
	// una futura modifica a ricollegarlo e rirompere D-19 in silenzio.
	const visible = mobileDestExpanded
		? SUGGESTED_DESTINATIONS
		: SUGGESTED_DESTINATIONS.slice(0, DEST_PREVIEW_COUNT);

	// WR-09: il Fix suggerito dal reviewer toglieva anche il guard
	// !searchInput.trim() da qui, ma i bottoni "Mostra piu'/meno" in
	// MobileSearchOverlay sono fratelli non condizionati del ternario
	// isFiltering — solo questo guard li nasconde mentre isFiltering e' true
	// (l'utente sta davvero digitando). Rimuoverlo li farebbe comparire sotto
	// i risultati di una ricerca libera in corso: una regressione visibile,
	// non presente nel codice sorgente del reviewer. Conservato deliberatamente.
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
		// WR-09: selected/setSelected/setIsNearby erano esposti ma senza
		// nessun call site fuori dall'hook (grep su components/, app/, lib/).
		// selectedRadius/setSelectedRadius/setIsNearbySearch restano usati
		// internamente (submit, clear, applyPreset, ...) — solo la loro
		// esposizione qui era morta.
		radius: {
			custom: customRadius,
			setCustom: setCustomRadius,
			showSelector: showRadiusSelector,
			setShowSelector: setShowRadiusSelector,
			isNearby: isNearbySearch,
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
