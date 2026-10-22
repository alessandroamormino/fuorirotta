"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { applyResolved, readDeviceList } from "@/lib/saved/store";
import { SAVED_RETENTION_MONTHS, type ResolvedItem } from "@/lib/saved/snapshot";
import { buildSavedView, type SavedItemData, type SavedRow } from "@/lib/saved/view";
import { formatEventRange } from "@/lib/eventStatus";
import { decodeHtmlEntities } from "@/lib/utils";
import Button from "@/components/ui/Button";
import SaveHeart from "@/components/saved/SaveHeart";

type State =
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; upcoming: SavedRow[]; past: SavedRow[] };

const PAST_VISIBLE = 5;
const PAST_LIST_ID = "salvati-passati-list";

const HEADING = "font-display text-lg font-semibold leading-tight text-foreground";
const HEADING_STYLE = { letterSpacing: "var(--tracking-display)" };
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const SURFACE = "rounded-lg bg-surface shadow-[var(--elev-ring)]";

/**
 * Lista di /salvati: legge il dispositivo DOPO il mount (lo storage non esiste
 * sul server), chiede al server le istantanee vive e solo allora divide in
 * "In arrivo" e "Passati". L'ora si legge dopo la risposta, mai in un render
 * che gira anche sul server (React error 418).
 */
export default function SavedList() {
	const [state, setState] = useState<State>({ status: "loading" });
	const [showAllPast, setShowAllPast] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const entries = readDeviceList();
				let resolved: ResolvedItem[] = [];
				if (entries.length > 0) {
					const res = await fetch("/api/v1/saved/resolve", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ ids: entries.map((e) => e.id) }),
					});
					if (!res.ok) throw new Error(`resolve ${res.status}`);
					resolved = ((await res.json()) as { items: ResolvedItem[] }).items;
					applyResolved(resolved);
				}
				const items: SavedItemData[] = entries.map((entry) => {
					const item = resolved.find((i) => i.ref === entry.id);
					return { ref: entry.id, eventId: item?.eventId ?? null, savedAt: entry.savedAt, snap: entry.snap, live: item?.live ?? null };
				});
				const view = buildSavedView(items, new Date());
				if (!cancelled) setState({ status: "ready", ...view });
			} catch {
				if (!cancelled) setState({ status: "error" });
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div aria-busy={state.status === "loading"}>
			{state.status === "loading" && (
				<>
					<p role="status" className="sr-only">
						Caricamento dei salvati
					</p>
					<ul aria-hidden="true" className="flex flex-col gap-4">
						{[0, 1, 2].map((i) => (
							<li key={i} className={`h-24 ${SURFACE}`} />
						))}
					</ul>
				</>
			)}
			{state.status === "error" && (
				<div className={`p-6 text-center ${SURFACE}`}>
					<p className="text-base text-foreground-secondary">
						Non riusciamo a caricare i salvati adesso. Restano su questo dispositivo: riprova tra poco.
					</p>
				</div>
			)}
			{state.status === "ready" && state.upcoming.length === 0 && state.past.length === 0 && (
				<EmptyBlock
					heading="Nessun evento salvato"
					body="Tocca il cuore su un evento per ritrovarlo qui, anche dopo che è finito."
					cta
				/>
			)}
			{state.status === "ready" && (state.upcoming.length > 0 || state.past.length > 0) && (
				<div className="space-y-8">
					<section aria-labelledby="salvati-in-arrivo">
						<h2 id="salvati-in-arrivo" className={`mb-4 ${HEADING}`} style={HEADING_STYLE}>
							In arrivo
						</h2>
						{state.upcoming.length > 0 ? (
							<RowList rows={state.upcoming} />
						) : (
							<EmptyBlock
								heading="Nessun evento in programma"
								body="Gli eventi che salvi e che devono ancora iniziare appaiono qui."
								cta
							/>
						)}
					</section>
					<section aria-labelledby="salvati-passati">
						<h2 id="salvati-passati" className={`mb-4 ${HEADING}`} style={HEADING_STYLE}>
							Passati
						</h2>
						{state.past.length > 0 ? (
							<>
								<RowList id={PAST_LIST_ID} rows={showAllPast ? state.past : state.past.slice(0, PAST_VISIBLE)} />
								{!showAllPast && state.past.length > PAST_VISIBLE && (
									<Button
										variant="secondary"
										size="sm"
										className="mt-4"
										aria-expanded={false}
										aria-controls={PAST_LIST_ID}
										onClick={() => setShowAllPast(true)}
									>
										Mostra altri {state.past.length - PAST_VISIBLE} eventi
									</Button>
								)}
							</>
						) : (
							<EmptyBlock
								heading="Nessun evento passato"
								body={`Gli eventi salvati che finiscono restano qui per ${SAVED_RETENTION_MONTHS} mesi.`}
							/>
						)}
					</section>
				</div>
			)}
		</div>
	);
}

function EmptyBlock({ heading, body, cta = false }: { heading: string; body: string; cta?: boolean }) {
	return (
		<div className={`flex flex-col items-center p-6 text-center ${SURFACE}`}>
			<Heart size={32} className="text-muted-foreground" aria-hidden="true" />
			<p className="mt-2 text-base font-semibold text-foreground">{heading}</p>
			<p className="mt-2 text-base text-foreground-secondary">{body}</p>
			{cta && (
				<Link
					href="/"
					className={`mt-4 inline-flex h-12 items-center rounded-pill bg-surface px-4 text-sm font-semibold text-foreground hover:bg-muted-strong ${FOCUS_RING}`}
					style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
				>
					Esplora gli eventi
				</Link>
			)}
		</div>
	);
}

function RowList({ rows, id }: { rows: SavedRow[]; id?: string }) {
	return (
		<ul id={id} className="flex flex-col gap-4">
			{rows.map((row) => {
				// Stessa resa del titolo della card (EventCard).
				const lower = row.title.toLowerCase();
				const title = decodeHtmlEntities(lower.charAt(0).toUpperCase() + lower.slice(1));
				const titleClass = "line-clamp-2 font-display text-base font-semibold leading-[1.2] text-balance text-foreground";
				return (
					<li
						key={row.key}
						className={`relative flex items-start gap-2 p-4 ${SURFACE} has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-background`}
					>
						<div className="min-w-0 flex-1">
							{row.eventId !== null ? (
								// Link steso su tutta la riga; il cuore sta sopra (z-10).
								<Link
									href={`/eventi/${row.eventId}`}
									className={`${titleClass} after:absolute after:inset-0 after:content-[''] focus-visible:outline-none`}
								>
									{title}
								</Link>
							) : (
								<p className={titleClass}>{title}</p>
							)}
							<p className="mt-1 text-sm text-foreground-secondary">
								{[row.place, formatEventRange(row.dateStart, row.dateEnd)].filter(Boolean).join(" · ")}
							</p>
							{row.gone && (
								<p className="mt-1 text-sm text-muted-foreground">{"Pagina dell'evento non più disponibile"}</p>
							)}
						</div>
						<SaveHeart eventId={row.ref} title={row.title} presentation="row" className="relative z-10 flex-none" />
					</li>
				);
			})}
		</ul>
	);
}
