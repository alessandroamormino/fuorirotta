"use client";
// stato locale della query dei risultati, useEffect con setTimeout per il
// debounce, fetch e AbortController per scartare risposte fuori ordine (D-12).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ComuneResult {
	id: number;
	istatCode: string;
	name: string;
	provinceName: string;
	regionName: string;
}

interface DestinationFieldProps {
	value: string;
	onValueChange: (value: string) => void;
	onSelect: (comune: { id: number; istatCode: string; name: string }) => void;
	placeholder?: string;
	className?: string;
	readOnly?: boolean;
	onFocus?: () => void;
	// Overlay mobile (09-04): l'input Dove originale portava autoFocus,
	// perso se non inoltrato — nessun effetto sull'unico altro call site
	// (desktop), che non lo passa.
	autoFocus?: boolean;
	// D-19 (corretta il 2026-08-20, dopo la regressione di 7852a38): la
	// lista dei risultati non apre piu' un Popover proprio — verrebbe
	// visualizzata come una seconda superficie di suggerimenti sopra
	// quella del pannello genitore (desktop) o duplicata sopra la lista
	// gia' presente (mobile). Con createPortal la lista viene
	// teletrasportata dentro il nodo DOM che il genitore fornisce qui —
	// che E' il pannello "Destinazioni suggerite"/"Risultati" — cosi'
	// resta un solo contenitore visibile per superficie. Se il genitore
	// non ha ancora montato un nodo, i risultati restano in stato ma non
	// vengono disegnati da nessuna parte (nessun crash, nessun flash).
	resultsContainer?: HTMLElement | null;
	// Il genitore possiede l'intestazione ("Risultati" vs "Destinazioni
	// suggerite") e il fallback "Cerca citta'": deve sapere se il fetch
	// ha prodotto risultati senza possedere lo stato del fetch, che resta
	// qui (RESEARCH.md Pitfall 3/4: valore sincrono, debounce solo sulla
	// rete, race guard sull'AbortController).
	onResultsChange?: (count: number) => void;
}

const LISTBOX_ID = "destination-field-listbox";

// Foglia client dell'autocomplete comuni (D-03, D-04, D-05): l'input e lo
// stato dei risultati vivono nello stesso componente, cosi' il valore
// mostrato si aggiorna sincrono a ogni tasto e il debounce agisce solo sulla
// chiamata di rete (RESEARCH.md Pitfall 3).
export default function DestinationField({
	value,
	onValueChange,
	onSelect,
	placeholder,
	className,
	readOnly,
	onFocus,
	autoFocus,
	resultsContainer,
	onResultsChange,
}: DestinationFieldProps) {
	const [results, setResults] = useState<ComuneResult[]>([]);
	const [highlightedIndex, setHighlightedIndex] = useState(-1);
	// Dalla Fase 9 piano 03 il testo digitato e' stato condiviso fra la superficie
	// mobile e quella desktop (useNavbarSearch), cosi' che il pannello desktop veda
	// cio' che l'utente ha fatto nell'overlay. Effetto collaterale: digitando
	// nell'overlay mobile anche QUESTO campo riceve il valore, pur essendo nascosto
	// dal breakpoint. Il focus e' il discriminante corretto: la lista appartiene al
	// campo che l'utente sta usando davvero, non a ogni istanza montata che
	// condivide il testo.
	const [hasFocus, setHasFocus] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	// Selezionare un comune scrive il suo nome in `value`, che riaccende
	// questo effect e rifarebbe il fetch per un testo che l'utente non ha
	// digitato: richiesta sprecata, e la lista tornerebbe piena mentre il
	// pannello sta gia' uscendo verso "Quando". Si salta una volta sola,
	// poi il ref si azzera — cosi' ridigitare lo stesso nome piu' tardi
	// cerca di nuovo.
	const justSelectedRef = useRef<string | null>(null);

	useEffect(() => {
		if (justSelectedRef.current === value) {
			justSelectedRef.current = null;
			return;
		}

		if (value.trim().length === 0) {
			// Svuota i risultati quando il prop value diventa vuoto (es. dopo
			// Cancella dal genitore); non c'e' modo di farlo durante il render
			// senza duplicare lo stato derivato in un altro componente.
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setResults([]);
			setHighlightedIndex(-1);
			return;
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => {
			fetch(`/api/comuni/search?q=${encodeURIComponent(value)}`, {
				signal: controller.signal,
			})
				.then((res) => res.json())
				.then((data) => {
					setResults(data.results || []);
					setHighlightedIndex(-1);
				})
				.catch((err) => {
					// Le risposte abortite sono query piu' vecchie di quella digitata
					// adesso: scartarle in silenzio e' il comportamento corretto, non
					// un errore da segnalare (RESEARCH.md Pitfall 4).
					if (err.name !== "AbortError") {
						console.error("[DestinationField] Ricerca comuni fallita:", err);
					}
				});
		}, 200);

		return () => {
			clearTimeout(timeoutId);
			controller.abort();
		};
	}, [value]);

	useEffect(() => {
		onResultsChange?.(results.length);
	}, [results, onResultsChange]);

	const isOpen = hasFocus && results.length > 0;

	const handleSelect = (comune: ComuneResult) => {
		justSelectedRef.current = comune.name;
		setResults([]);
		setHighlightedIndex(-1);
		onSelect({ id: comune.id, istatCode: comune.istatCode, name: comune.name });
	};

	const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (!isOpen) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setHighlightedIndex((idx) => Math.min(results.length - 1, idx + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			setHighlightedIndex((idx) => Math.max(0, idx - 1));
		} else if (event.key === "Enter") {
			if (highlightedIndex >= 0 && highlightedIndex < results.length) {
				event.preventDefault();
				handleSelect(results[highlightedIndex]);
			}
		} else if (event.key === "Escape") {
			setResults([]);
			setHighlightedIndex(-1);
		}
	};

	return (
		<>
			<input
				ref={inputRef}
				type="text"
				placeholder={placeholder}
				value={value}
				autoFocus={autoFocus}
				onChange={(e) => onValueChange(e.target.value)}
				onFocus={() => {
					setHasFocus(true);
					onFocus?.();
				}}
				// Sicuro rispetto alla selezione col mouse: gli option fanno
				// preventDefault su onMouseDown, quindi cliccarli non toglie il
				// focus all'input e questo blur non scatta prima dell'onClick.
				onBlur={() => setHasFocus(false)}
				onKeyDown={handleKeyDown}
				readOnly={readOnly}
				className={className}
				role="combobox"
				aria-expanded={isOpen}
				aria-autocomplete="list"
				aria-controls={LISTBOX_ID}
				aria-activedescendant={
					highlightedIndex >= 0
						? `destination-field-option-${highlightedIndex}`
						: undefined
				}
			/>
			{isOpen && resultsContainer
				? createPortal(
						<ul id={LISTBOX_ID} role="listbox" className="flex flex-col gap-0.5">
							{results.map((r, index) => (
								<li key={r.id}>
									<button
										type="button"
										id={`destination-field-option-${index}`}
										role="option"
										aria-selected={index === highlightedIndex}
										onMouseDown={(e) => e.preventDefault()}
										// stopPropagation: la lista e' teletrasportata nel
										// pannello con createPortal, ma nel React tree resta
										// figlia di questo campo — e React propaga gli eventi
										// lungo il React tree, non il DOM. Senza questo, il
										// click risale fino al wrapper del campo Dove
										// (Navbar.tsx), il cui onClick rimette activeField a
										// "where" subito dopo che onSelect l'ha portato a
										// "when": il pannello sfarfalla e torna indietro
										// invece di passare al passo successivo.
										onClick={(e) => {
											e.stopPropagation();
											handleSelect(r);
										}}
										className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm text-foreground-secondary ${
											index === highlightedIndex ? "bg-muted" : "hover:bg-muted"
										}`}
									>
										{r.name} — {r.provinceName}, {r.regionName}
									</button>
								</li>
							))}
						</ul>,
						resultsContainer,
					)
				: null}
		</>
	);
}
