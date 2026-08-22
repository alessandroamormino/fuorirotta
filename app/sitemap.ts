import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

// Force dynamic rendering to avoid database queries during build
export const dynamic = 'force-dynamic';
// Cache the sitemap for 1 hour
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const baseUrl = getBaseUrl();

	// Limita la sitemap a un numero ragionevole per evitare risposte troppo grandi.
	// Includiamo eventi recenti/futuri (ultimo mese + futuri).
	const from = new Date();
	from.setDate(from.getDate() - 30);

	// DEDUP-01: solo id canonici. Un URL verso una riga membro finirebbe su un
	// redirect 307 (D-15) e metterebbe l'URL indicizzato in contraddizione col
	// canonical dichiarato dalla pagina stessa.
	const events = await prisma.event.findMany({
		select: {
			id: true,
			updatedAt: true,
			dateStart: true,
		},
		where: {
			dateStart: {
				gte: from,
			},
			canonicalEventId: null,
		},
		orderBy: {
			dateStart: "asc",
		},
		take: 5000,
	});

	return [
		{
			url: `${baseUrl}/`,
			lastModified: new Date(),
			changeFrequency: "daily",
			priority: 1,
		},
		...events.map((event) => ({
			url: `${baseUrl}/eventi/${event.id}`,
			lastModified: event.updatedAt,
			changeFrequency: "daily" as const,
			priority: 0.7,
		})),
	];
}

function getBaseUrl() {
	const raw =
		process.env.NEXT_PUBLIC_SITE_URL ||
		process.env.SITE_URL ||
		"https://fuori-rotta.it";
	return raw.replace(/\/$/, "");
}
