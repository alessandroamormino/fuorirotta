"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import Input from "@/components/ui/Input";
import { followId, type FollowItem, type PlaceKind } from "@/lib/follows/keys";
import { cn } from "@/lib/utils";
import { normalizeComuneName } from "@/lib/territorial/normalize";

/**
 * Ricerca luoghi + chip (Fase 23, UI-SPEC Superficie 2). Componente controllato:
 * non sa dove vanno le scelte, le consegna a onAdd/onRemove. Combobox scritta a
 * mano (nessuna libreria): i risultati stanno IN LINEA sotto il campo, perche'
 * un popover assoluto verrebbe tagliato da una finestra che scorre.
 */
type Option = { kind: PlaceKind; key: string; label: string; sublabel: string; chip: string };

interface PlacePickerProps {
	labelId: string;
	chipsLabel: string;
	chips: readonly FollowItem[];
	/** followId di tutto cio' che l'account segue gia'. */
	followed: ReadonlySet<string>;
	capReached: boolean;
	disabled?: boolean;
	emptyText?: string;
	onAdd: (item: FollowItem) => void;
	onRemove: (item: FollowItem) => void;
}

const DEBOUNCE_MS = 200;
const MIN_CHARS = 2;

export default function PlacePicker({
	labelId,
	chipsLabel,
	chips,
	followed,
	capReached,
	disabled,
	emptyText,
	onAdd,
	onRemove,
}: PlacePickerProps) {
	const listId = useId();
	const inputId = useId();
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const abort = useRef<AbortController | null>(null);
	const [query, setQuery] = useState("");
	const [options, setOptions] = useState<Option[]>([]);
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(-1);
	// Testo dell'ultima ricerca finita bene e esito dell'ultima richiesta: servono alle righe "nessun luogo" e "errore".
	const [searched, setSearched] = useState("");
	const [failed, setFailed] = useState(false);
	const [announce, setAnnounce] = useState("");

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
			abort.current?.abort();
		},
		[],
	);

	const search = (text: string) => {
		abort.current?.abort();
		const ctl = new AbortController();
		abort.current = ctl;
		fetch(`/api/places/search?q=${encodeURIComponent(text)}`, { signal: ctl.signal })
			.then((res) => (res.ok ? (res.json() as Promise<{ results: Option[] }>) : Promise.reject(new Error("search"))))
			.then((json) => {
				setOptions(json.results);
				setSearched(text);
				setFailed(false);
				setActive(-1);
				setOpen(true);
			})
			.catch((err: unknown) => {
				if (err instanceof DOMException && err.name === "AbortError") return;
				setFailed(true);
				setOpen(true);
			});
	};

	const onChange = (text: string) => {
		setQuery(text);
		if (timer.current) clearTimeout(timer.current);
		if (normalizeComuneName(text).length < MIN_CHARS) {
			abort.current?.abort();
			setOptions([]);
			setFailed(false);
			setOpen(false);
			return;
		}
		timer.current = setTimeout(() => search(text.trim()), DEBOUNCE_MS);
	};

	const isFollowed = (o: Option) => followed.has(followId(o.kind, o.key)) || chips.some((c) => c.kind === o.kind && c.key === o.key);

	const pick = (o: Option) => {
		if (isFollowed(o)) return;
		onAdd({ kind: o.kind, key: o.key, label: o.chip });
		setAnnounce(`${o.chip} aggiunto`);
		if (timer.current) clearTimeout(timer.current);
		abort.current?.abort();
		setQuery("");
		setOptions([]);
		setOpen(false);
		document.getElementById(inputId)?.focus();
	};

	const listVisible = open && !failed && options.length > 0;
	const message = open && !capReached ? (failed ? "Non riusciamo a cercare adesso. Riprova tra poco." : options.length === 0 && searched ? `Nessun luogo trovato per «${searched}».` : null) : null;

	// Escape chiude SOLO la lista e, se era aperta, consuma l'evento: dentro una finestra il primo Escape non la chiude.
	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			if (open) {
				e.stopPropagation();
				setOpen(false);
			}
		} else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (options.length === 0) return;
			e.preventDefault();
			setOpen(true);
			const step = e.key === "ArrowDown" ? 1 : -1;
			setActive((a) => (a < 0 ? (step > 0 ? 0 : options.length - 1) : (a + step + options.length) % options.length));
		} else if (e.key === "Enter" && listVisible && active >= 0) {
			e.preventDefault();
			pick(options[active]);
		}
	};

	return (
		<div>
			<span id={labelId} className="mb-2 block text-sm font-semibold text-foreground">
				Luoghi
			</span>
			<div className="relative">
				<Search size={20} aria-hidden="true" className="pointer-events-none absolute left-4 top-3 text-muted-foreground" />
				<Input
					id={inputId}
					size="md"
					role="combobox"
					aria-labelledby={labelId}
					aria-expanded={listVisible}
					aria-controls={listId}
					aria-activedescendant={listVisible && active >= 0 ? `${listId}-${active}` : undefined}
					aria-autocomplete="list"
					placeholder="Cerca comune, provincia o regione"
					autoComplete="off"
					inputMode="search"
					enterKeyHint="search"
					className="w-full pl-11"
					value={query}
					disabled={disabled || capReached}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={onKeyDown}
				/>
			</div>

			{capReached && <p className="mt-2 text-sm text-foreground-secondary">Hai raggiunto il limite di 50 luoghi seguiti</p>}

			{message && (
				<p role="status" className="mt-2 text-sm text-foreground-secondary">
					{message}
				</p>
			)}

			{listVisible && !capReached && (
				<ul
					id={listId}
					role="listbox"
					aria-labelledby={labelId}
					className="mt-2 max-h-56 overflow-y-auto rounded-lg bg-surface shadow-[var(--elev-ring)]"
				>
					{options.map((o, i) => {
						const already = isFollowed(o);
						return (
							<li
								key={followId(o.kind, o.key)}
								id={`${listId}-${i}`}
								role="option"
								aria-selected={i === active}
								aria-disabled={already || undefined}
								className={cn(i > 0 && "border-t border-border-soft", i === active && "bg-muted-strong")}
							>
								<button
									type="button"
									tabIndex={-1}
									onClick={() => pick(o)}
									className="block min-h-11 w-full px-3 py-2 text-left"
								>
									<span className="block text-sm font-semibold text-foreground">{o.label}</span>
									{already ? (
										<span className="flex items-center gap-1 text-sm text-foreground-secondary">
											<Check size={14} aria-hidden="true" /> Già seguito
										</span>
									) : (
										<span className="block text-sm text-foreground-secondary">{o.sublabel}</span>
									)}
								</button>
							</li>
						);
					})}
				</ul>
			)}

			{chips.length > 0 ? (
				<ul aria-label={chipsLabel} className="mt-3 flex flex-wrap gap-3">
					{chips.map((c) => (
						<li
							key={followId(c.kind, c.key)}
							className="inline-flex h-9 items-center gap-1 rounded-pill bg-foreground pl-3 pr-1 text-sm font-semibold text-background"
						>
							{c.label}
							<button
								type="button"
								aria-label={`Smetti di seguire ${c.label}`}
								onClick={() => {
									onRemove(c);
									setAnnounce(`${c.label} rimosso`);
								}}
								className="relative inline-flex h-7 w-7 items-center justify-center rounded-full before:absolute before:-inset-2 before:content-[''] hover:bg-background/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-foreground"
							>
								<X size={14} aria-hidden="true" />
							</button>
						</li>
					))}
				</ul>
			) : (
				emptyText && <p className="mt-3 text-sm text-foreground-secondary">{emptyText}</p>
			)}

			<p role="status" className="sr-only">
				{announce}
			</p>
		</div>
	);
}
