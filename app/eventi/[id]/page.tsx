import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { decodeHtmlEntities } from "@/lib/utils";
import EventDetailClient from "./EventDetailClient";

const BASE_URL = (
	process.env.NEXT_PUBLIC_SITE_URL ||
	process.env.SITE_URL ||
	"https://fuori-rotta.it"
).replace(/\/$/, "");

export async function generateMetadata(
	{ params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
	const { id } = await params;
	const eventId = parseInt(id);

	if (isNaN(eventId)) {
		return { title: "Evento non trovato | Fuorirotta" };
	}

	const event = await prisma.event.findUnique({
		where: { id: eventId },
		select: { title: true, description: true, imageUrl: true },
	});

	if (!event) {
		return { title: "Evento non trovato | Fuorirotta" };
	}

	const title = `${decodeHtmlEntities(event.title)} | Fuorirotta`;
	const description = event.description
		? decodeHtmlEntities(event.description.replace(/<[^>]*>/g, "")).slice(0, 160)
		: "Scopri questo evento su Fuorirotta.";
	const canonical = `${BASE_URL}/eventi/${eventId}`;

	return {
		title,
		description,
		alternates: {
			canonical,
		},
		openGraph: {
			title,
			description,
			url: canonical,
			...(event.imageUrl ? { images: [{ url: event.imageUrl }] } : {}),
		},
	};
}

export default function EventDetailPage() {
	return <EventDetailClient />;
}
