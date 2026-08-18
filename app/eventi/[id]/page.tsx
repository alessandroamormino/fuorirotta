import type { Metadata } from "next";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { decodeHtmlEntities } from "@/lib/utils";
import { Event } from "@/lib/types";
import { serializeEvent } from "@/lib/serializeEvent";
import EventDetailClient from "./EventDetailClient";

const BASE_URL = (
	process.env.NEXT_PUBLIC_SITE_URL ||
	process.env.SITE_URL ||
	"https://fuori-rotta.it"
).replace(/\/$/, "");

// cache() deduplica la query DB tra generateMetadata e il componente pagina
const getEvent = cache(async (id: number) => {
	return prisma.event.findUnique({ where: { id } });
});

export async function generateMetadata(
	{ params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
	const { id } = await params;
	const eventId = parseInt(id);

	if (isNaN(eventId)) {
		return { title: "Evento non trovato" };
	}

	const event = await getEvent(eventId);

	if (!event) {
		return { title: "Evento non trovato" };
	}

	const title = decodeHtmlEntities(event.title);
	const description = event.description
		? decodeHtmlEntities(event.description.replace(/<[^>]*>/g, "")).slice(0, 160)
		: "Scopri questo evento su Fuorirotta.";
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
			...(event.imageUrl ? { images: [{ url: event.imageUrl }] } : {}),
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
	const event = isNaN(eventId) ? null : await getEvent(eventId);

	// Costruisce i dati strutturati Schema.org/Event per Google
	const jsonLd = event
		? {
				"@context": "https://schema.org",
				"@type": "Event",
				name: decodeHtmlEntities(event.title),
				description: event.description
					? decodeHtmlEntities(event.description.replace(/<[^>]*>/g, "")).slice(0, 500)
					: undefined,
				startDate: event.dateStart.toISOString(),
				endDate: event.dateEnd?.toISOString(),
				url: `${BASE_URL}/eventi/${eventId}`,
				...(event.imageUrl ? { image: event.imageUrl } : {}),
				location: event.locationName
					? {
							"@type": "Place",
							name: decodeHtmlEntities(event.locationName),
							...(event.address ? { address: event.address } : {}),
							...(event.latitude && event.longitude
								? {
										geo: {
											"@type": "GeoCoordinates",
											latitude: event.latitude.toString(),
											longitude: event.longitude.toString(),
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

	// Serializza l'evento per il client component (Date → string, Decimal → number)
	const serializedEvent = event ? serializeEvent(event) : null;

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
			<EventDetailClient initialEvent={serializedEvent} />
		</>
	);
}
