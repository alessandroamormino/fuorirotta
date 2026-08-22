import type { Metadata } from "next";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Event as PrismaEvent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decodeHtmlEntities } from "@/lib/utils";
import { Event } from "@/lib/types";
import { serializeEvent } from "@/lib/serializeEvent";
import { composeEvent } from "@/lib/dedup/compose";
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
		const event = await prisma.event.findUnique({ where: { id } });
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
	const description = composedEvent.description
		? decodeHtmlEntities(composedEvent.description.replace(/<[^>]*>/g, "")).slice(0, 160)
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
			...(composedEvent.imageUrl ? { images: [{ url: composedEvent.imageUrl }] } : {}),
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
				startDate: composedEvent.dateStart.toISOString(),
				endDate: composedEvent.dateEnd?.toISOString(),
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
			<EventDetailClient initialEvent={serializedEvent} />
		</>
	);
}
