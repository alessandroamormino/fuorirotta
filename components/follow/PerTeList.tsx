"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useUserState } from "@/components/account/UserStateProvider";
import EventCard from "@/components/EventCard";
import Button from "@/components/ui/Button";
import type { Event } from "@/lib/types";

/**
 * Lista di /per-te (PREF-05, D-12): la stessa regola del rail, tutte le pagine.
 * Legge il feed privato DOPO l'idratazione (la pagina del server e' uguale per
 * tutti) e tiene il numero di pagina solo nello stato del componente.
 */
const PER_TE_PAGE_SIZE = 12;

type Feed = { items: Event[]; total: number; follows: number };
// `page` e' la pagina a cui appartengono gli elementi: puo' restare indietro rispetto a quella richiesta.
type Loaded = Feed & { page: number };

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const TEXT_LINK = `inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-foreground underline underline-offset-4 ${FOCUS_RING}`;

export default function PerTeList() {
	const { user } = useUserState();
	const signedIn = user !== null;
	const [data, setData] = useState<Loaded | null>(null);
	// Una nuova richiesta = un nuovo oggetto: anche lo stesso numero di pagina riparte (Riprova).
	const [req, setReq] = useState({ page: 1, n: 0 });
	const h1Ref = useRef<HTMLHeadingElement>(null);
	// Il focus si sposta solo se la pagina cambia per mano dell'utente, non al primo caricamento.
	const moveFocus = useRef(false);

	useEffect(() => {
		if (!signedIn) return;
		const controller = new AbortController();
		const offset = (req.page - 1) * PER_TE_PAGE_SIZE;
		fetch(`/api/v1/me/feed?limit=${PER_TE_PAGE_SIZE}&offset=${offset}`, {
			credentials: "same-origin",
			cache: "no-store",
			signal: controller.signal,
		})
			.then(async (res) => {
				const body = res.ok ? ((await res.json()) as Feed) : null;
				if (controller.signal.aborted || !body || !Array.isArray(body.items)) return;
				setData({ ...body, page: req.page });
				if (moveFocus.current) {
					moveFocus.current = false;
					h1Ref.current?.focus({ preventScroll: true });
					h1Ref.current?.closest("main")?.scrollIntoView({ block: "start" });
				}
			})
			.catch(() => {});
		return () => controller.abort();
	}, [signedIn, req]);

	const go = (page: number) => {
		moveFocus.current = true;
		setReq((r) => ({ page, n: r.n + 1 }));
	};

	const pages = data ? Math.ceil(data.total / PER_TE_PAGE_SIZE) : 0;

	return (
		<div>
			<h1
				ref={h1Ref}
				tabIndex={-1}
				className="mb-1 font-display text-xl font-semibold leading-[1.2] text-foreground focus-visible:outline-none"
				style={{ letterSpacing: "var(--tracking-display)" }}
			>
				Per te
			</h1>
			<div className="min-h-11">
				{data && data.total > 0 && (
					<p className="flex min-h-11 flex-wrap items-center text-sm text-foreground-secondary">
						<span>{data.total === 1 ? "1 evento in programma" : `${data.total} eventi in programma`}</span>
						<span aria-hidden="true" className="mx-1">
							·
						</span>
						<Link href="/account#account-segui" className={TEXT_LINK}>
							Modifica cosa segui
						</Link>
					</p>
				)}
			</div>
			{data && data.items.length > 0 && (
				<>
					<div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
						{data.items.map((event) => (
							<EventCard key={event.id} event={event} />
						))}
					</div>
					{pages > 1 && (
						<nav aria-label="Pagine dei risultati" className="mt-8 flex items-center justify-center gap-4">
							<Button variant="secondary" size="icon" aria-label="Pagina precedente" disabled={data.page <= 1} onClick={() => go(data.page - 1)}>
								<ChevronLeft size={18} aria-hidden="true" />
							</Button>
							<span className="text-sm tabular-nums text-foreground-secondary" aria-live="polite">
								Pagina {data.page} di {pages}
							</span>
							<Button variant="secondary" size="icon" aria-label="Pagina successiva" disabled={data.page >= pages} onClick={() => go(data.page + 1)}>
								<ChevronRight size={18} aria-hidden="true" />
							</Button>
						</nav>
					)}
				</>
			)}
		</div>
	);
}
