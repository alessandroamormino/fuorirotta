import { prisma } from "@/lib/prisma";
import { Event } from "@/lib/types";
import HomeClient from "./HomeClient";

export const revalidate = 300; // Rivalidate ogni 5 minuti

export default async function Home() {
	const now = new Date();
	now.setHours(0, 0, 0, 0);

	const [rawEvents, total] = await Promise.all([
		prisma.event.findMany({
			where: { dateStart: { gte: now } },
			orderBy: { dateStart: "asc" },
			take: 12,
		}),
		prisma.event.count({
			where: { dateStart: { gte: now } },
		}),
	]);

	// Converti Decimal e Date in tipi primitivi serializzabili per il client component
	const initialEvents = rawEvents.map((e) => ({
		...e,
		latitude: e.latitude ? parseFloat(e.latitude.toString()) : null,
		longitude: e.longitude ? parseFloat(e.longitude.toString()) : null,
		dateStart: e.dateStart.toISOString(),
		dateEnd: e.dateEnd?.toISOString() ?? null,
		createdAt: e.createdAt.toISOString(),
		updatedAt: e.updatedAt.toISOString(),
	})) as unknown as Event[];

	return <HomeClient initialEvents={initialEvents} initialTotal={total} />;
}
