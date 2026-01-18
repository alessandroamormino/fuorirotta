import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const baseUrl = getBaseUrl();

	// Limita la sitemap a un numero ragionevole per evitare risposte troppo grandi.
	// Includiamo eventi recenti/futuri (ultimo mese + futuri).
	const from = new Date();
	from.setDate(from.getDate() - 30);

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
		"http://localhost:3000";
	return raw.replace(/\/$/, "");
}
