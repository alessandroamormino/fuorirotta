import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { getLiveRegions } from "@/lib/coverage/liveRegions";

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

	// ROLL-05/D-10: solo le regioni sopra la stessa soglia di copertura di
	// lib/coverage/liveRegions.ts entrano in sitemap — nessuna soglia
	// duplicata qui. Ordinate alfabeticamente per slug: due chiamate
	// consecutive su dati invariati devono produrre lo stesso documento
	// (un Set non garantisce un ordine stabile fra chiamate).
	const liveRegionSlugs = [...(await getLiveRegions())].sort((a, b) => a.localeCompare(b));

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
		...liveRegionSlugs.map((slug) => ({
			url: `${baseUrl}/${slug}`,
			lastModified: new Date(),
			changeFrequency: "daily" as const,
			priority: 0.6,
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
