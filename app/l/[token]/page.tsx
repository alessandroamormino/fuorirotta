import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarX } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { authEnabled } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { categoryVisual } from "@/lib/categories/visuals";
import { formatEventRange } from "@/lib/eventStatus";
import { decodeHtmlEntities } from "@/lib/utils";
import { SHARE_DEAD_METADATA, SHARE_TOKEN, listSharedEvents } from "@/lib/saved/share";

// Pagina pubblica di un link di condivisione (Fase 24). DINAMICA di proposito: senza
// questa riga una pagina senza API dinamiche puo' essere conservata dopo il primo
// render, e un link disattivato continuerebbe a rispondere (revoca non immediata).
// Nessun loading.tsx e nessun Suspense sopra la ricerca: avviare lo stream fissa lo
// stato a 200 e ogni link morto smetterebbe di essere un 404. Nessuna lettura di
// cookie, header o query, e mai il codice nei log.
export const dynamic = "force-dynamic";

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const DESCRIPTION = "Gli eventi in arrivo salvati su Fuorirotta.";

// cache() fa girare la ricerca una volta per richiesta, per generateMetadata e per la pagina.
const getShared = cache(async (token: string) => {
	if (!authEnabled() || !SHARE_TOKEN.test(token)) return null;
	const link = await prisma.shareLink.findUnique({
		where: { token },
		// Solo il nome: mai email, foto o id dell'utente.
		select: { userId: true, showName: true, user: { select: { name: true } } },
	});
	if (!link) return null;
	return {
		title: link.showName ? `I salvati di ${link.user.name}` : "Eventi salvati",
		events: await listSharedEvents(link.userId),
	};
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
	const shared = await getShared((await params).token);
	if (!shared) return SHARE_DEAD_METADATA;
	return {
		title: shared.title,
		description: DESCRIPTION,
		robots: { index: false, follow: false },
		referrer: "no-referrer",
		openGraph: { type: "website", locale: "it_IT", siteName: "Fuorirotta", title: shared.title, description: DESCRIPTION },
		twitter: { card: "summary", title: shared.title, description: DESCRIPTION },
	};
}

export default async function SharedListPage({ params }: { params: Promise<{ token: string }> }) {
	const shared = await getShared((await params).token);
	if (!shared) notFound();
	const { title, events } = shared;
	// Una sola stringa: un solo nodo di testo nell'HTML (React inserirebbe marcatori di commento).
	const summary = `${events.length} ${events.length === 1 ? "evento" : "eventi"} in arrivo`;

	return (
		<>
			<SiteHeader />
			<main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
				<h1
					className="mb-1 font-display text-xl font-semibold leading-[1.2] text-foreground break-words"
					style={{ letterSpacing: "var(--tracking-display)" }}
				>
					{title}
				</h1>
				{events.length > 0 ? (
					<>
						<p className="text-sm text-foreground-secondary">{summary}</p>
						<ul aria-label="Eventi in arrivo" className="mt-6 flex flex-col gap-4">
							{events.map((event) => {
								// Stessa resa del titolo di /salvati.
								const lower = event.title.toLowerCase();
								const text = decodeHtmlEntities(lower.charAt(0).toUpperCase() + lower.slice(1));
								const Icon = event.category !== null ? categoryVisual(event.category).Icon : null;
								return (
									<li
										key={event.id}
										className="relative rounded-lg bg-surface p-4 shadow-[var(--elev-ring)] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-background"
									>
										<Link
											href={`/eventi/${event.id}`}
											prefetch={false}
											className="line-clamp-2 font-display text-base font-semibold leading-[1.2] text-balance text-foreground after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
										>
											{text}
										</Link>
										<p className="mt-1 text-sm text-foreground-secondary">
											{[event.place, formatEventRange(event.dateStart, event.dateEnd)].filter(Boolean).join(" · ")}
										</p>
										{Icon && event.category !== null && (
											<p className="mt-2 inline-flex items-center gap-2 text-sm text-foreground-secondary">
												<Icon size={16} aria-hidden="true" />
												{event.category}
											</p>
										)}
									</li>
								);
							})}
						</ul>
					</>
				) : (
					<div className="mt-6 flex flex-col items-center rounded-lg bg-surface p-6 text-center shadow-[var(--elev-ring)]">
						<CalendarX size={32} className="text-muted-foreground" aria-hidden="true" />
						<p className="mt-2 text-base font-semibold text-foreground">Al momento non ci sono eventi in arrivo in questa lista</p>
						<p className="mt-2 text-base text-foreground-secondary">
							{"Riprova più avanti: la lista si aggiorna quando chi l'ha condivisa salva nuovi eventi."}
						</p>
						<Link
							href="/"
							className={`mt-4 inline-flex h-12 items-center rounded-pill bg-surface px-4 text-sm font-semibold text-foreground hover:bg-muted-strong ${FOCUS_RING}`}
							style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
						>
							Scopri gli eventi
						</Link>
					</div>
				)}
			</main>
			<Footer />
		</>
	);
}
