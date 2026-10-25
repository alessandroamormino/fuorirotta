"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
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
const SURFACE = "rounded-lg bg-surface shadow-[var(--elev-ring)]";
const TEXT_LINK = `inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-foreground underline underline-offset-4 ${FOCUS_RING}`;

export default function PerTeList() {
	const { enabled, user, openSignIn } = useUserState();
	const signedIn = user !== null;
	const [data, setData] = useState<Loaded | null>(null);
	// Errore di rete o 5xx dell'ultima richiesta; la pagina precedente, se c'e', resta in vista.
	const [failed, setFailed] = useState(false);
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
				if (controller.signal.aborted) return;
				if (!body || !Array.isArray(body.items)) {
					setFailed(true);
					return;
				}
				// I follow sono cambiati altrove e la pagina non esiste piu': si ripiega sull'ultima.
				if (body.items.length === 0 && body.total > 0 && req.page > 1) {
					setReq((r) => ({ page: Math.ceil(body.total / PER_TE_PAGE_SIZE), n: r.n + 1 }));
					return;
				}
				setData({ ...body, page: req.page });
				if (moveFocus.current) {
					moveFocus.current = false;
					h1Ref.current?.focus({ preventScroll: true });
					h1Ref.current?.closest("main")?.scrollIntoView({ block: "start" });
				}
			})
			.catch(() => {
				if (!controller.signal.aborted) setFailed(true);
			});
		return () => controller.abort();
	}, [signedIn, req]);

	const go = (page: number) => {
		moveFocus.current = true;
		setFailed(false);
		setReq((r) => ({ page, n: r.n + 1 }));
	};
	const retry = () => {
		setFailed(false);
		setReq((r) => ({ page: r.page, n: r.n + 1 }));
	};

	const pages = data ? Math.ceil(data.total / PER_TE_PAGE_SIZE) : 0;
	const pending = enabled === null || (signedIn && data === null && !failed);

	const errorBlock = (
		<div className={`p-6 text-center ${SURFACE}`}>
			<p className="text-base text-foreground-secondary">Non riusciamo a caricare Per te. Riprova tra poco.</p>
			<Button variant="secondary" size="sm" className="mt-4" onClick={retry}>
				Riprova
			</Button>
		</div>
	);

	let content: ReactNode = null;
	if (pending) {
		content = (
			<>
				<p role="status" className="sr-only">
					Caricamento di Per te
				</p>
				<div aria-hidden="true" className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{[0, 1, 2].map((i) => (
						<div key={i} className={`h-64 ${SURFACE}`} />
					))}
				</div>
			</>
		);
	} else if (enabled === false) {
		content = <EmptyBlock heading="Per te non è disponibile" cta={{ label: "Torna agli eventi", href: "/" }} />;
	} else if (!signedIn) {
		content = (
			<EmptyBlock
				heading="Gli eventi nei posti che segui"
				body="Accedi, scegli i posti e le categorie che ti interessano e li ritrovi qui, su tutti i tuoi dispositivi."
				action={
					<Button variant="primary" size="md" className="mt-4" aria-haspopup="dialog" onClick={openSignIn}>
						Accedi
					</Button>
				}
			/>
		);
	} else if (!data) {
		content = errorBlock;
	} else if (data.follows === 0) {
		content = (
			<EmptyBlock
				heading="Non segui ancora niente"
				body="Scegli i posti e le categorie che ti interessano: qui compariranno gli eventi in arrivo."
				cta={{ label: "Scegli cosa seguire", href: "/account#account-segui" }}
			/>
		);
	} else if (data.total === 0) {
		content = (
			<EmptyBlock
				heading="Niente in arrivo nei posti che segui"
				body="Prova a seguire altri posti o altre categorie."
				cta={{ label: "Modifica cosa segui", href: "/account#account-segui" }}
			/>
		);
	} else {
		content = (
			<>
				<div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{data.items.map((event) => (
						<EventCard key={event.id} event={event} />
					))}
				</div>
				{failed && <div className="mt-8">{errorBlock}</div>}
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
		);
	}

	// La riga del riepilogo tiene sempre la sua altezza: il titolo non salta fra uno stato e l'altro.
	const showSummary = !pending && signedIn && data !== null && data.follows > 0 && data.total > 0;

	return (
		<div aria-busy={pending}>
			<h1
				ref={h1Ref}
				tabIndex={-1}
				className="mb-1 font-display text-xl font-semibold leading-[1.2] text-foreground focus-visible:outline-none"
				style={{ letterSpacing: "var(--tracking-display)" }}
			>
				Per te
			</h1>
			<div className="min-h-11">
				{showSummary && data && (
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
			{content}
		</div>
	);
}

function EmptyBlock({
	heading,
	body,
	cta,
	action,
}: {
	heading: string;
	body?: string;
	cta?: { label: string; href: string };
	action?: ReactNode;
}) {
	return (
		<div className={`mt-6 flex flex-col items-center p-6 text-center ${SURFACE}`}>
			<Sparkles size={32} className="text-muted-foreground" aria-hidden="true" />
			<p className="mt-2 text-base font-semibold text-foreground">{heading}</p>
			{body && <p className="mt-2 text-base text-foreground-secondary">{body}</p>}
			{action}
			{cta && (
				<Link
					href={cta.href}
					className={`mt-4 inline-flex h-12 items-center rounded-pill bg-surface px-4 text-sm font-semibold text-foreground hover:bg-muted-strong ${FOCUS_RING}`}
					style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
				>
					{cta.label}
				</Link>
			)}
		</div>
	);
}
