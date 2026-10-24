"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useUserState } from "@/components/account/UserStateProvider";
import MiniEventCard from "@/components/map/MiniEventCard";
import SaveHeart from "@/components/saved/SaveHeart";
import Button from "@/components/ui/Button";
import { hasPerTeHint, setPerTeHint } from "@/lib/follows/hint";
import { followId } from "@/lib/follows/keys";
import { loadFollows, useFollowList, useFollowsStatus } from "@/lib/follows/store";
import type { Event } from "@/lib/types";

/**
 * Rail "Per te" in cima alla lista della home (PREF-05, D-11). Vive nel riquadro
 * riservato `.per-te-slot` (HomeClient): la pagina del server non sa nulla
 * dell'utente, questo componente chiede il feed privato dopo l'idratazione.
 * Server e primo render del client sono `null`, uguali per tutti (React 418).
 *
 * La radice e' alta quanto il riquadro, `--per-te-h`, in OGNI stato (attesa,
 * pieno, vuoto, errore): niente dentro puo' spostare le card sotto, e nessuno
 * stato usa dissolvenze o scorrimenti. Il suggerimento del dispositivo
 * (lib/follows/hint.ts) si toglie quando non c'e' piu' motivo di riservare
 * lo spazio: nessun utente, nessun follow.
 */
const AUTH_ON = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const LINK = `inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-foreground underline underline-offset-4 ${FOCUS_RING}`;
const ROW = "flex h-20 flex-none items-center gap-3 px-1";
const BLOCK = "flex h-20 w-full flex-col justify-center rounded-lg bg-surface px-4 shadow-[var(--elev-ring)]";

// null = nessuna risposta ancora; 'error' = rete o 5xx; 'gone' = 401/404, la sessione non c'e' piu'.
type Feed = { items: Event[]; total: number; follows: number };
type FeedState = Feed | "error" | "gone" | null;

const subscribeNever = () => () => {};

function Skeleton() {
	return (
		<div aria-hidden="true" className={ROW}>
			{[0, 1].map((i) => (
				<div key={i} className="h-[72px] w-[264px] shrink-0 rounded-md bg-surface shadow-[var(--elev-ring)]" />
			))}
		</div>
	);
}

export default function PerTeRail() {
	// false sul server e nel primo render, true dopo l'idratazione.
	const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
	const { enabled, user } = useUserState();
	const list = useFollowList();
	const status = useFollowsStatus();
	// Il suggerimento che il dispositivo aveva al caricamento: decide se l'attesa mostra lo scheletro.
	const [hintAtMount] = useState(hasPerTeHint);
	const [feed, setFeed] = useState<FeedState>(null);
	const [retry, setRetry] = useState(0);

	const signedIn = user !== null;
	const noAccount = enabled === false || (enabled === true && !signedIn);
	const listReady = signedIn && list !== null;
	const listLength = list?.length ?? 0;
	// Cambia solo quando cambia COSA si segue, non l'etichetta che il server rifinisce dopo un PUT.
	const signature = useMemo(() => (list ? list.map((f) => followId(f.kind, f.key)).join("|") : null), [list]);
	const hasFollows = listReady && listLength > 0;

	// Il dispositivo non ha piu' motivo di riservare lo spazio: nessun utente o nessun follow.
	useEffect(() => {
		if (!AUTH_ON) return;
		if (noAccount || (listReady && listLength === 0)) setPerTeHint(false);
	}, [noAccount, listReady, listLength]);

	useEffect(() => {
		if (!hasFollows) return;
		// Un dispositivo nuovo apre il riquadro da qui; uno gia' noto lo ha aperto lo script nel <head>.
		setPerTeHint(true);
		const controller = new AbortController();
		fetch("/api/v1/me/feed?limit=10", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
			.then(async (res) => {
				if (controller.signal.aborted) return;
				if (res.status === 401 || res.status === 404) {
					setPerTeHint(false);
					setFeed("gone");
					return;
				}
				const data = res.ok ? ((await res.json()) as Feed) : null;
				if (controller.signal.aborted) return;
				if (!data || !Array.isArray(data.items)) {
					setFeed("error");
					return;
				}
				if (data.follows === 0) setPerTeHint(false);
				setFeed(data);
			})
			.catch(() => {
				if (!controller.signal.aborted) setFeed("error");
			});
		return () => controller.abort();
	}, [hasFollows, signature, retry]);

	if (!AUTH_ON || !mounted || noAccount) return null;
	// Prima che la lista sia pronta: lo scheletro solo se il dispositivo sa di avere dei follow.
	if (!listReady && !hintAtMount) return null;
	if (listReady && listLength === 0) return null; // D-11: nessun invito, il riquadro si chiude
	if (feed === "gone" || (feed !== null && feed !== "error" && feed.follows === 0)) return null;

	const items = feed !== null && feed !== "error" ? feed.items : [];
	// La lista non si carica: stesso riquadro d'errore del feed, con "Riprova" (che rilancia loadFollows).
	const failed = feed === "error" || (signedIn && list === null && status === "error");
	const pending = !failed && (feed === null || !listReady);

	function retryFeed() {
		if (status === "error") void loadFollows();
		setFeed(null);
		setRetry((n) => n + 1);
	}

	return (
		<section
			aria-labelledby="per-te-titolo"
			aria-busy={pending ? true : undefined}
			className="flex h-[var(--per-te-h)] flex-col pb-6"
		>
			<div className="flex h-11 flex-none items-center justify-between gap-3">
				<h2
					id="per-te-titolo"
					className="font-display text-lg font-semibold leading-[1.2] text-foreground"
					style={{ letterSpacing: "var(--tracking-display)" }}
				>
					Per te
				</h2>
				{items.length > 0 && (
					<Link href="/per-te" className={LINK}>
						Vedi tutti
					</Link>
				)}
			</div>
			{pending ? (
				<Skeleton />
			) : failed ? (
				<div className={ROW}>
					<div className={BLOCK}>
						<p className="text-sm text-foreground-secondary">Non riusciamo a caricare Per te. Riprova tra poco.</p>
						<div>
							<Button variant="secondary" size="sm" onClick={retryFeed}>
								Riprova
							</Button>
						</div>
					</div>
				</div>
			) : items.length === 0 ? (
				<div className={ROW}>
					<div className={BLOCK}>
						<p className="text-sm text-foreground-secondary">Niente in arrivo nei posti che segui</p>
						{/* -my-2: il bersaglio resta alto 44px, ma il blocco da 80px regge anche il testo su due righe. */}
						<div className="-my-2">
							<Link href="/account#account-segui" className={LINK}>
								Modifica cosa segui
							</Link>
						</div>
					</div>
				</div>
			) : (
				<div className="flex h-20 flex-none snap-x snap-mandatory items-center gap-3 overflow-x-auto px-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{items.map((event) => (
						<div key={event.id} className="relative h-[72px] w-[264px] shrink-0 snap-start">
							<MiniEventCard
								event={{
									id: event.id,
									title: event.title,
									category: event.category ?? "",
									imageUrl: event.imageUrl ?? "",
									locationName: event.comune?.name ?? event.locationName ?? "",
									dateStart: event.dateStart,
									dateEnd: event.dateEnd,
								}}
								className="h-full bg-surface pr-8 shadow-[var(--elev-ring)]"
							/>
							<SaveHeart presentation="compact" eventId={event.id} title={event.title} className="absolute bottom-1 right-0" />
						</div>
					))}
				</div>
			)}
		</section>
	);
}
