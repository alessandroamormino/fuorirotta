"use client";
// stato locale della query dei risultati, useEffect con setTimeout per il
// debounce, fetch e AbortController per scartare risposte fuori ordine (D-12).

import { useEffect, useRef, useState } from "react";
import * as Popover from "@/components/ui/Popover";

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
}: DestinationFieldProps) {
	const [results, setResults] = useState<ComuneResult[]>([]);
	const [highlightedIndex, setHighlightedIndex] = useState(-1);
	// Dalla Fase 9 piano 03 il testo digitato e' stato condiviso fra la superficie
	// mobile e quella desktop (useNavbarSearch), cosi' che il pannello desktop veda
	// cio' che l'utente ha fatto nell'overlay. Effetto collaterale: digitando
	// nell'overlay mobile anche QUESTO campo riceve il valore, pur essendo nascosto
	// dal breakpoint, e apriva la sua listbox ancorata a un input di larghezza 0 —
	// che finiva a schermo in alto a sinistra, sopra l'header. Il focus e' il
	// discriminante corretto: la listbox appartiene al campo che l'utente sta
	// usando davvero, non a ogni istanza montata che condivide il testo.
	const [hasFocus, setHasFocus] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
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

	const isOpen = hasFocus && results.length > 0;

	const handleSelect = (comune: ComuneResult) => {
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
		<Popover.Root
			open={isOpen}
			onOpenChange={(open) => {
				if (!open) setResults([]);
			}}
		>
			<Popover.Anchor asChild>
				<input
					ref={inputRef}
					type="text"
					placeholder={placeholder}
					value={value}
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
			</Popover.Anchor>
			{/* onOpenAutoFocus/onCloseAutoFocus: il focus resta sempre nell'input,
			    mai nel pannello — altrimenti digitare aprirebbe il popover e
			    rimuoverebbe il focus dal campo a meta' parola. */}
			<Popover.Content
				align="start"
				onOpenAutoFocus={(e) => e.preventDefault()}
				onCloseAutoFocus={(e) => e.preventDefault()}
			>
				<ul id={LISTBOX_ID} role="listbox" className="flex flex-col gap-0.5">
					{results.map((r, index) => (
						<li key={r.id}>
							<button
								type="button"
								id={`destination-field-option-${index}`}
								role="option"
								aria-selected={index === highlightedIndex}
								onMouseDown={(e) => e.preventDefault()}
								onClick={() => handleSelect(r)}
								className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm text-foreground-secondary ${
									index === highlightedIndex ? "bg-muted" : "hover:bg-muted"
								}`}
							>
								{r.name} — {r.provinceName}, {r.regionName}
							</button>
						</li>
					))}
				</ul>
			</Popover.Content>
		</Popover.Root>
	);
}
