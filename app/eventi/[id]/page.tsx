import type { Metadata } from "next";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Event as PrismaEvent } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decodeHtmlEntities } from "@/lib/utils";
import { serializeEvent } from "@/lib/serializeEvent";
import { composeEvent } from "@/lib/dedup/compose";
import { eventDays } from "@/lib/eventDays";
import { isEventOver } from "@/lib/eventStatus";
import { todayInRome } from "@/lib/dateWindow";
import { formatDayRange } from "@/lib/calendar/links";
import { ogCardContent } from "@/lib/og/card";
import { OG_VERSION } from "@/lib/og/brand";
import EventDetailClient from "./EventDetailClient";

const BASE_URL = (
	process.env.NEXT_PUBLIC_SITE_URL ||
	process.env.SITE_URL ||
	"https://fuori-rotta.it"
).replace(/\/$/, "");

// cache() deduplica la query DB tra generateMetadata e il componente pagina.
// DEDUP-04: oltre alla riga, restituisce anche i membri del gruppo (vuoto per
// una riga membro o non fusa), cosi' entrambi i chiamanti possono comporre
// senza una seconda andata al database.
const getEvent = cache(
	async (id: number): Promise<{ event: PrismaEvent | null; members: PrismaEvent[] }> => {
		// include comune (T-12-04, D-8): solo name/provinceCode, mai la riga
		// intera — stessa select ristretta di app/page.tsx. Senza questo
		// include, event.comune e' undefined e la terza briciola di
		// navigazione cadrebbe sul ripiego locationName in silenzio.
		const event = await prisma.event.findUnique({
			where: { id },
			include: { comune: { select: { name: true, provinceCode: true } } },
		});
		if (!event || event.canonicalEventId !== null) {
			return { event, members: [] };
		}
		const members = await prisma.event.findMany({
			where: { canonicalEventId: event.id },
			orderBy: { id: "asc" },
		});
		return { event, members };
	}
);

export async function generateMetadata(
	{ params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
	const { id } = await params;
	const eventId = parseInt(id);

	if (isNaN(eventId)) {
		return { title: "Evento non trovato" };
	}

	const { event, members } = await getEvent(eventId);

	if (!event) {
		return { title: "Evento non trovato" };
	}

	// D-15: per una riga membro il redirect (nel componente pagina, sotto)
	// scatta prima che questi metadati abbiano effetto; per una riga canonica
	// l'id richiesto e' gia' quello canonico. Titolo e descrizione vanno pero'
	// letti dalla riga COMPOSTA (DEDUP-04): altrimenti l'anteprima social
	// mostrerebbe un testo diverso da quello effettivamente in pagina.
	const composedEvent = composeEvent(event, members);

	const title = decodeHtmlEntities(composedEvent.title);
	// Senza descrizione l'anteprima dice quando e dove (UI-SPEC, Copywriting
	// Contract), non una frase uguale per tutti. Il comune viene dalla riga
	// composta (include del getEvent sopra); in sua assenza il luogo scrapato.
	const description = composedEvent.description
		? decodeHtmlEntities(composedEvent.description.replace(/<[^>]*>/g, "")).slice(0, 160)
		: [
				formatDayRange(
					eventDays(composedEvent.dateStart, composedEvent.dateEnd).startDay,
					eventDays(composedEvent.dateStart, composedEvent.dateEnd).endDay,
					todayInRome()
				),
				(composedEvent as { comune?: { name: string } | null }).comune?.name ??
					decodeHtmlEntities(composedEvent.locationName ?? "").trim(),
			]
				.filter(Boolean)
				.join(" \u00b7 ");
	const canonical = `${BASE_URL}/eventi/${eventId}`;

	return {
		title,
		description,
		alternates: { canonical },
		openGraph: {
			title,
			description,
			url: canonical,
			type: "website",
			locale: "it_IT",
			siteName: "Fuorirotta",
			// D-08: con l'immagine della fonte resta quella; senza, la card generata
			// (D-09). Nessun file opengraph-image sotto questa cartella: con la
			// convenzione di file Next ignorerebbe questo campo anche per le fonti.
			images: composedEvent.imageUrl
				? [{ url: composedEvent.imageUrl }]
				: [
						{
							url: `${BASE_URL}/eventi/${eventId}/og?v=${OG_VERSION}`,
							width: 1200,
							height: 630,
							alt: ogCardContent(composedEvent, todayInRome()).alt,
						},
					],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
		},
	};
}

export default async function EventDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const eventId = parseInt(id);
	const { event, members } = isNaN(eventId)
		? { event: null, members: [] }
		: await getEvent(eventId);

	// D-15: una riga membro reindirizza sempre alla canonica. `redirect()` di
	// next/navigation e' la variante TEMPORANEA (mai la variante irreversibile
	// esportata dallo stesso modulo, riservata ai redirect a vita intera): la
	// fusione e' reversibile per progetto (DEDUP-05) e un redirect permanente
	// resterebbe in cache del browser anche dopo l'annullamento della fusione.
	if (event && event.canonicalEventId !== null) {
		redirect(`/eventi/${event.canonicalEventId}`);
	}

	// DEDUP-04: la riga e' canonica (o non fusa), comporla con i suoi membri
	// prima di costruire i metadati strutturati e serializzare per il client.
	const composedEvent = event ? composeEvent(event, members) : null;

	// Costruisce i dati strutturati Schema.org/Event per Google
	const jsonLd = composedEvent
		? {
				"@context": "https://schema.org",
				"@type": "Event",
				name: decodeHtmlEntities(composedEvent.title),
				description: composedEvent.description
					? decodeHtmlEntities(composedEvent.description.replace(/<[^>]*>/g, "")).slice(0, 500)
					: undefined,
				// Giorni di calendario (YYYY-MM-DD, ISO 8601 valido per schema.org):
				// l'istante 23:59:59.999Z dei dati in formato UTC, letto da Google,
				// sarebbe il giorno dopo a Roma.
				startDate: eventDays(composedEvent.dateStart, composedEvent.dateEnd).startDay,
				endDate: composedEvent.dateEnd
					? eventDays(composedEvent.dateStart, composedEvent.dateEnd).endDay
					: undefined,
				url: `${BASE_URL}/eventi/${eventId}`,
				...(composedEvent.imageUrl ? { image: composedEvent.imageUrl } : {}),
				location: composedEvent.locationName
					? {
							"@type": "Place",
							name: decodeHtmlEntities(composedEvent.locationName),
							...(composedEvent.address ? { address: composedEvent.address } : {}),
							...(composedEvent.latitude && composedEvent.longitude
								? {
										geo: {
											"@type": "GeoCoordinates",
											latitude: composedEvent.latitude.toString(),
											longitude: composedEvent.longitude.toString(),
										},
									}
								: {}),
						}
					: undefined,
				organizer: {
					"@type": "Organization",
					name: "Fuorirotta",
					url: BASE_URL,
				},
			}
		: null;

	// Serializza l'evento composto per il client component (Date → string, Decimal → number)
	const serializedEvent = composedEvent ? serializeEvent(composedEvent) : null;

	return (
		<>
			{jsonLd && (
				<script
					type="application/ld+json"
					// JSON.stringify non esegue l'escaping di `<`: un `</script>` dentro un
					// campo scrapato (title, location.name, address, imageUrl — nessuno dei
					// quali viene strippato) chiuderebbe il tag in anticipo. Peggio ancora,
					// decodeHtmlEntities riconverte `&lt;` in `<`, trasformando la forma
					// gia' innocua nel payload. Escapando `<` il vettore si chiude.
					dangerouslySetInnerHTML={{
						__html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
					}}
				/>
			)}
			<EventDetailClient
				initialEvent={serializedEvent}
				// WR-05: "concluso" lo decide il server, una volta: l'orologio del
				// browser nel render darebbe un albero diverso (errore di idratazione di React) se
				// SSR e idratazione stanno a cavallo della mezzanotte di Roma.
				eventOver={composedEvent ? isEventOver(composedEvent.dateStart, composedEvent.dateEnd) : undefined}
				canonicalUrl={isNaN(eventId) ? undefined : `${BASE_URL}/eventi/${eventId}`}
			/>
		</>
	);
}
