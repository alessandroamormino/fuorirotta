import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getLiveProvinces, getProvinceDirectory, type ProvinceRef } from "@/lib/coverage/liveRegions";
import { VALID_REGION_SLUGS } from "@/lib/scrapers/regionSlug";
import { serializeEvent } from "@/lib/serializeEvent";
import { Event } from "@/lib/types";
import EventCard from "@/components/EventCard";
import Breadcrumb from "@/components/Breadcrumb";
import CoverageMessage from "@/components/CoverageMessage";

const BASE_URL = (
	process.env.NEXT_PUBLIC_SITE_URL ||
	process.env.SITE_URL ||
	"https://fuori-rotta.it"
).replace(/\/$/, "");

type ProvincePageData =
	| { regionName: string; province: ProvinceRef; isLive: false; events: Event[] }
	| { regionName: string; province: ProvinceRef; isLive: true; events: Event[] };

// cache() deduplica fra generateMetadata e il componente pagina (stesso
// contratto di app/[regione]/page.tsx e app/eventi/[id]/page.tsx). T-15-03:
// lo slug regione si valida PRIMA di qualunque query, contro l'insieme
// chiuso in memoria — solo dopo si interroga la directory delle province
// (getProvinceDirectory, letta dalla tabella comuni) per verificare che lo
// slug provincia appartenga davvero a QUELLA regione, non a un'altra.
const getProvinceData = cache(
	async (regione: string, provincia: string): Promise<ProvincePageData | null> => {
		const regionName = VALID_REGION_SLUGS.get(regione);
		if (!regionName) return null;

		const directory = await getProvinceDirectory();
		const province = directory.find(
			(p) => p.regionSlug === regione && p.provinceSlug === provincia
		);
		// Una provincia lombarda sotto /puglia/ non e' una pagina spenta, e'
		// un URL sbagliato: notFound(), mai il messaggio di copertura.
		if (!province) return null;

		const liveProvinces = await getLiveProvinces();
		if (!liveProvinces.has(province.provinceCode)) {
			return { regionName, province, isLive: false, events: [] };
		}

		const today = new Date();
		today.setUTCHours(0, 0, 0, 0);

		// ROLL-06: eventi futuri canonici della provincia, ordinati per data
		// crescente e, a parita' di data, per id crescente (stesso contratto
		// della pagina regione).
		const rows = await prisma.event.findMany({
			where: {
				comune: { provinceCode: province.provinceCode },
				dateStart: { gte: today },
				canonicalEventId: null,
			},
			orderBy: [{ dateStart: "asc" }, { id: "asc" }],
			include: { comune: { select: { name: true, provinceCode: true } } },
		});

		return { regionName, province, isLive: true, events: rows.map(serializeEvent) };
	}
);

export async function generateMetadata(
	{ params }: { params: Promise<{ regione: string; provincia: string }> }
): Promise<Metadata> {
	const { regione, provincia } = await params;
	const data = await getProvinceData(regione, provincia);
	if (!data) return { title: "Pagina non trovata" };

	const canonical = `${BASE_URL}/${regione}/${provincia}`;

	// D-11: 200 + noindex per una provincia reale ma non ancora coperta, MAI
	// 404 e MAI redirect — stesso contratto della pagina regione, un livello
	// sotto. Niente "Fuorirotta" nel titolo: RootLayout applica gia' il
	// template "%s | Fuorirotta".
	if (!data.isLive) {
		return {
			title: `${data.province.provinceName} — in arrivo`,
			alternates: { canonical },
			robots: { index: false, follow: true },
		};
	}

	return {
		title: `Eventi in provincia di ${data.province.provinceName}`,
		description: `Sagre, feste e manifestazioni in provincia di ${data.province.provinceName} (${data.regionName}), aggiornate ogni giorno.`,
		alternates: { canonical },
	};
}

export default async function ProvinciaPage({
	params,
}: {
	params: Promise<{ regione: string; provincia: string }>;
}) {
	const { regione, provincia } = await params;
	const data = await getProvinceData(regione, provincia);

	// T-15-03: slug regione non ISTAT, o provincia che non appartiene a
	// QUELLA regione -> 404. Mai redirect.
	if (!data) notFound();

	const breadcrumbItems = [
		{ name: "Fuorirotta", href: "/" },
		{ name: data.regionName, href: `/${regione}` },
		{ name: data.province.provinceName },
	];

	// Stesso pattern di escaping di app/eventi/[id]/page.tsx (righe 138-149):
	// JSON.stringify non esegue l'escaping di `<`, e un titolo di evento
	// scrapato ostile potrebbe chiudere il tag <script> in anticipo.
	const breadcrumbLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Fuorirotta", item: BASE_URL },
			{ "@type": "ListItem", position: 2, name: data.regionName, item: `${BASE_URL}/${regione}` },
			{
				"@type": "ListItem",
				position: 3,
				name: data.province.provinceName,
				item: `${BASE_URL}/${regione}/${provincia}`,
			},
		],
	};

	if (!data.isLive) {
		// D-05/D-06: il testo vive in CoverageMessage, un punto solo, riusato
		// identico dalla pagina regione.
		return (
			<main className="mx-auto max-w-3xl px-4 py-16">
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(breadcrumbLd).replace(/</g, "\\u003c"),
					}}
				/>
				<Breadcrumb items={breadcrumbItems} />
				<CoverageMessage variant="region-not-covered" title={data.province.provinceName} />
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-6xl px-4 py-8">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{
					__html: JSON.stringify(breadcrumbLd).replace(/</g, "\\u003c"),
				}}
			/>
			<Breadcrumb items={breadcrumbItems} />
			<h1 className="font-display text-2xl font-semibold text-foreground">
				Eventi in provincia di {data.province.provinceName}
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
