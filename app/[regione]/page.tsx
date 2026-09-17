import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLiveRegions } from "@/lib/coverage/liveRegions";
import { VALID_REGION_SLUGS } from "@/lib/scrapers/regionSlug";
import { serializeEvent } from "@/lib/serializeEvent";
import { Event } from "@/lib/types";
import EventCard from "@/components/EventCard";

const BASE_URL = (
	process.env.NEXT_PUBLIC_SITE_URL ||
	process.env.SITE_URL ||
	"https://fuori-rotta.it"
).replace(/\/$/, "");

type RegionPageData =
	| { displayName: string; isLive: false; events: Event[] }
	| { displayName: string; isLive: true; events: Event[] };

// cache() deduplica fra generateMetadata e il componente pagina (stesso
// pattern di app/eventi/[id]/page.tsx). T-15-03: il controllo dello slug
// contro VALID_REGION_SLUGS e' in memoria, PRIMA di qualunque query — uno
// slug sconosciuto esce con notFound() senza alcun round-trip al database.
const getRegionData = cache(async (regione: string): Promise<RegionPageData | null> => {
	const displayName = VALID_REGION_SLUGS.get(regione);
	if (!displayName) return null;

	const liveRegions = await getLiveRegions();
	if (!liveRegions.has(regione)) {
		return { displayName, isLive: false, events: [] };
	}

	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);

	// ROLL-06: eventi futuri canonici della regione, ordinati per data
	// crescente e, a parita' di data, per id crescente.
	const rows = await prisma.event.findMany({
		where: { region: regione, dateStart: { gte: today }, canonicalEventId: null },
		orderBy: [{ dateStart: "asc" }, { id: "asc" }],
		include: { comune: { select: { name: true, provinceCode: true } } },
	});

	return { displayName, isLive: true, events: rows.map(serializeEvent) };
});

export async function generateMetadata(
	{ params }: { params: Promise<{ regione: string }> }
): Promise<Metadata> {
	const { regione } = await params;
	const data = await getRegionData(regione);
	if (!data) return { title: "Pagina non trovata" };

	const canonical = `${BASE_URL}/${regione}`;

	// D-11: 200 + noindex per una regione reale ma non ancora coperta, MAI
	// 404 e MAI redirect — l'URL resta stabile prima e dopo l'accensione.
	if (!data.isLive) {
		return {
			title: `${data.displayName} — in arrivo su Fuorirotta`,
			alternates: { canonical },
			robots: { index: false, follow: true },
		};
	}

	return {
		title: `Eventi in ${data.displayName} — Fuorirotta`,
		description: `Sagre, feste e manifestazioni in ${data.displayName}, aggiornate ogni giorno.`,
		alternates: { canonical },
	};
}

export default async function RegionePage({
	params,
}: {
	params: Promise<{ regione: string }>;
}) {
	const { regione } = await params;
	const data = await getRegionData(regione);

	// T-15-03: slug non appartenente all'insieme chiuso ISTAT -> 404.
	if (!data) notFound();

	if (!data.isLive) {
		// D-05/D-06: messaggio esplicito e nient'altro, nessun suggerimento di
		// regione vicina, nessuna raccolta email. Il testo definitivo e il
		// componente condiviso con la ricerca per raggio arrivano in
		// 15-04-PLAN.md — qui basta la variante "regione non coperta".
		return (
			<main className="mx-auto max-w-3xl px-4 py-16 text-center">
				<h1 className="font-display text-2xl font-semibold text-foreground">
					{data.displayName}
				</h1>
				<p className="mt-3 text-muted-foreground">
					Non copriamo ancora questa regione: stiamo aggiungendo nuove fonti,
					torna a trovarci presto.
				</p>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-6xl px-4 py-8">
			<h1 className="font-display text-2xl font-semibold text-foreground">
				Eventi in {data.displayName}
			</h1>
			<p className="mt-1 text-muted-foreground">
				{data.events.length} {data.events.length === 1 ? "evento in programma" : "eventi in programma"}
			</p>
			<div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
				{data.events.map((event) => (
					<EventCard key={event.id} event={event} />
				))}
			</div>
		</main>
	);
}
