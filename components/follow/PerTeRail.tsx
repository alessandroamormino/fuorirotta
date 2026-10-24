"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useUserState } from "@/components/account/UserStateProvider";
import MiniEventCard from "@/components/map/MiniEventCard";
import SaveHeart from "@/components/saved/SaveHeart";
import { setPerTeHint } from "@/lib/follows/hint";
import { followId } from "@/lib/follows/keys";
import { useFollowList } from "@/lib/follows/store";
import type { Event } from "@/lib/types";

/**
 * Rail "Per te" in cima alla lista della home (PREF-05, D-11). Vive nel riquadro
 * riservato `.per-te-slot` (HomeClient): la pagina del server non sa nulla
 * dell'utente, questo componente chiede il feed privato dopo l'idratazione.
 * Server e primo render del client sono `null`, uguali per tutti (React 418).
 * La radice e' alta quanto il riquadro, `--per-te-h`, in ogni stato: cosi'
 * niente dentro puo' spostare le card sotto.
 */
const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type Feed = { items: Event[]; total: number; follows: number };

const subscribeNever = () => () => {};

export default function PerTeRail() {
	// false sul server e nel primo render, true dopo l'idratazione.
	const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
	const { user } = useUserState();
	const list = useFollowList();
	const signedIn = user !== null;
	// Cambia solo quando cambia COSA si segue, non l'etichetta che il server rifinisce dopo un PUT.
	const signature = useMemo(() => (list ? list.map((f) => followId(f.kind, f.key)).join("|") : null), [list]);
	const hasFollows = signedIn && signature !== null && signature !== "";
	const [feed, setFeed] = useState<Feed | null>(null);

	useEffect(() => {
		if (!hasFollows) return;
		// Un dispositivo nuovo apre il riquadro da qui; uno gia' noto lo ha aperto lo script nel <head>.
		setPerTeHint(true);
		const controller = new AbortController();
		fetch("/api/v1/me/feed?limit=10", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
			.then((res) => (res.ok ? (res.json() as Promise<Feed>) : null))
			.then((data) => {
				if (data && Array.isArray(data.items)) setFeed(data);
			})
			.catch(() => {});
		return () => controller.abort();
	}, [hasFollows, signature]);

	if (!mounted || !hasFollows || !feed || feed.items.length === 0) return null;

	return (
		<section aria-labelledby="per-te-titolo" className="flex h-[var(--per-te-h)] flex-col pb-6">
			<div className="flex h-11 flex-none items-center justify-between gap-3">
				<h2
					id="per-te-titolo"
					className="font-display text-lg font-semibold leading-[1.2] text-foreground"
					style={{ letterSpacing: "var(--tracking-display)" }}
				>
					Per te
				</h2>
				<Link
					href="/per-te"
					className={`inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-foreground underline underline-offset-4 ${FOCUS_RING}`}
				>
					Vedi tutti
				</Link>
			</div>
			<div className="flex h-20 flex-none snap-x snap-mandatory items-center gap-3 overflow-x-auto px-1 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
				{feed.items.map((event) => (
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
		</section>
	);
}
