"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { applyResolved, readDeviceList, useSavedCount, useSavedMode, type SavedMode } from "@/lib/saved/store";
import { ACCOUNT_CAP, GUEST_CAP, SAVED_RETENTION_MONTHS, type ResolvedItem } from "@/lib/saved/snapshot";
import { buildSavedView, type SavedItemData, type SavedRow } from "@/lib/saved/view";
import { formatEventRange } from "@/lib/eventStatus";
import { decodeHtmlEntities } from "@/lib/utils";
import Button from "@/components/ui/Button";
import SaveHeart from "@/components/saved/SaveHeart";
import { useUserState } from "@/components/account/UserStateProvider";

type State =
	| { status: "loading" }
	| { status: "error" }
	| { status: "ready"; upcoming: SavedRow[]; past: SavedRow[]; total: number };

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
	const mode = useSavedMode();
	const [loaded, setLoaded] = useState<State>({ status: "loading" });
	const [showAllPast, setShowAllPast] = useState(false);
	// Righe di sola istantanea tolte con il cuore (D-16): escono subito dalla pagina.
	const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
	const [attempt, setAttempt] = useState(0);
	// Finche' la modalita' non e' nota (stato dell'accesso, unione) la pagina resta in caricamento.
	const state: State = mode === "pending" ? { status: "loading" } : loaded;

	useEffect(() => {
		if (mode === "pending") return;
		let cancelled = false;
		const load = async () => {
			try {
				let items: SavedItemData[];
				if (mode === "account") {
					// Solo dopo l'unione (useSavedMode): una lista mezza unita non si mostra mai.
					const res = await fetch("/api/v1/me/saved", { credentials: "same-origin", cache: "no-store" });
					if (!res.ok) throw new Error(`saved ${res.status}`);
					items = ((await res.json()) as { items: SavedItemData[] }).items;
				} else {
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
					items = entries.map((entry) => {
						const item = resolved.find((i) => i.ref === entry.id);
						return { ref: entry.id, eventId: item?.eventId ?? null, savedAt: entry.savedAt, snap: entry.snap, live: item?.live ?? null };
					});
				}
				const view = buildSavedView(items, new Date());
				if (!cancelled) setLoaded({ status: "ready", ...view, total: items.length });
			} catch {
				if (!cancelled) setLoaded({ status: "error" });
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [mode, attempt]);

	const keep = (rows: SavedRow[]) => rows.filter((r) => !removed.has(r.key));
	const view =
		state.status === "ready" ? { upcoming: keep(state.upcoming), past: keep(state.past), total: state.total - removed.size } : null;
	const onRemoved = (key: string) => setRemoved((prev) => new Set(prev).add(key));

	return (
		<div aria-busy={state.status === "loading"}>
			<HeaderSlot mode={mode} accountTotal={view?.total ?? 0} />
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
					{mode === "account" ? (
						<>
							<p className="text-base text-foreground-secondary">Non riusciamo a caricare i tuoi salvati. Riprova tra poco.</p>
							<Button
								variant="secondary"
								size="md"
								className="mt-4"
								onClick={() => {
									setLoaded({ status: "loading" });
									setAttempt((n) => n + 1);
								}}
							>
								Riprova
							</Button>
						</>
					) : (
						<p className="text-base text-foreground-secondary">
							Non riusciamo a caricare i salvati adesso. Restano su questo dispositivo: riprova tra poco.
						</p>
					)}
				</div>
			)}
			{view && view.upcoming.length === 0 && view.past.length === 0 && (
				<EmptyBlock
					heading="Nessun evento salvato"
					body="Tocca il cuore su un evento per ritrovarlo qui, anche dopo che è finito."
					cta
				/>
			)}
			{view && (view.upcoming.length > 0 || view.past.length > 0) && (
				<div className="space-y-8">
					<section aria-labelledby="salvati-in-arrivo">
						<h2 id="salvati-in-arrivo" className={`mb-4 ${HEADING}`} style={HEADING_STYLE}>
							In arrivo
						</h2>
						{view.upcoming.length > 0 ? (
							<RowList rows={view.upcoming} mode={mode} onRemoved={onRemoved} />
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
						{view.past.length > 0 ? (
							<>
								<RowList
									id={PAST_LIST_ID}
									rows={showAllPast ? view.past : view.past.slice(0, PAST_VISIBLE)}
									mode={mode}
									onRemoved={onRemoved}
								/>
								{!showAllPast && view.past.length > PAST_VISIBLE && (
									<Button
										variant="secondary"
										size="sm"
										className="mt-4"
										aria-expanded={false}
										aria-controls={PAST_LIST_ID}
										onClick={() => setShowAllPast(true)}
									>
										Mostra altri {view.past.length - PAST_VISIBLE} eventi
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

/**
 * Sotto il titolo (22-UI-SPEC Surface 3): l'invito ad accedere per l'ospite, l'avviso
 * del tetto (100 sul dispositivo, 500 nell'account) al posto dell'invito. Con il flag di
 * build spento non c'e' nessun invito; lo stato dell'accesso in arrivo tiene lo spazio.
 */
function HeaderSlot({ mode, accountTotal }: { mode: SavedMode; accountTotal: number }) {
	const { enabled, openSignIn } = useUserState();
	const guestCount = useSavedCount();
	const flagOn = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";
	const canSignIn = flagOn && enabled === true;
	const textButton = `min-h-11 text-left text-sm text-foreground-secondary underline underline-offset-4 ${FOCUS_RING}`;

	if (mode === "pending") return flagOn ? <div className="mt-2 mb-6 min-h-11" /> : null;
	if (mode === "account") {
		return accountTotal >= ACCOUNT_CAP ? (
			<p className={`mt-2 mb-6 p-4 text-sm text-foreground ${SURFACE}`}>Hai raggiunto il limite di 500 eventi salvati.</p>
		) : null;
	}
	if (guestCount >= GUEST_CAP) {
		return (
			<div className={`mt-2 mb-6 p-4 text-sm text-foreground ${SURFACE}`}>
				<p>Hai raggiunto il limite di 100 eventi salvati.</p>
				{canSignIn && (
					<button type="button" aria-haspopup="dialog" onClick={openSignIn} className={textButton}>
						Accedi per salvarne altri
					</button>
				)}
			</div>
		);
	}
	if (!canSignIn) return null;
	return (
		<div className="mt-2 mb-6 min-h-11">
			<button type="button" aria-haspopup="dialog" onClick={openSignIn} className={textButton}>
				Accedi per ritrovarli su tutti i tuoi dispositivi
			</button>
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

function RowList({ rows, id, mode, onRemoved }: { rows: SavedRow[]; id?: string; mode: SavedMode; onRemoved: (key: string) => void }) {
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
						<SaveHeart
							// Account: l'id canonico dell'evento (ref e' la riga salvata); ospite: l'id del dispositivo.
							eventId={mode === "account" ? (row.eventId ?? row.ref) : row.ref}
							title={row.title}
							presentation="row"
							// D-16: una riga di sola istantanea se ne va subito, senza risalvataggio.
							gone={row.gone ? { ref: row.ref, onRemoved: () => onRemoved(row.key) } : undefined}
							className="relative z-10 flex-none"
						/>
					</li>
				);
			})}
		</ul>
	);
}
