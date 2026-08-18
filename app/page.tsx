import { prisma } from "@/lib/prisma";
import { Event } from "@/lib/types";
import { serializeEvent } from "@/lib/serializeEvent";
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

	// Decimal e Date non attraversano il confine Server -> Client Component.
	const initialEvents: Event[] = rawEvents.map(serializeEvent);

	return <HomeClient initialEvents={initialEvents} initialTotal={total} />;
}
