import { prisma } from "@/lib/prisma";
import { Event } from "@/lib/types";
import { serializeEvent } from "@/lib/serializeEvent";
import { composeEvent, groupMembersByCanonical } from "@/lib/dedup/compose";
import HomeClient from "./HomeClient";

export const revalidate = 300; // Rivalidate ogni 5 minuti

export default async function Home() {
	const now = new Date();
	now.setHours(0, 0, 0, 0);

	// DEDUP-01: su ENTRAMBE le chiamate del Promise.all, non su una sola.
	// Filtrarne una sola sarebbe la peggiore delle combinazioni: lista
	// corretta e conteggio gonfio, o viceversa (stesso rischio gia' evitato
	// da /api/events in 10-02).
	const [rawEvents, total] = await Promise.all([
		prisma.event.findMany({
			where: { dateStart: { gte: now }, canonicalEventId: null },
			orderBy: { dateStart: "asc" },
			take: 12,
		}),
		prisma.event.count({
			where: { dateStart: { gte: now }, canonicalEventId: null },
		}),
	]);

	// DEDUP-04: compone i campi delle 12 schede in evidenza con lo stesso
	// schema a due query gia' usato da /api/events (una query membri per il
	// lotto, mai una per riga). Array vuoto -> nessuna seconda query.
	let composedEvents = rawEvents;
	if (rawEvents.length > 0) {
		const canonicalIds = rawEvents.map((e) => e.id);
		const members = await prisma.event.findMany({
			where: { canonicalEventId: { in: canonicalIds } },
			orderBy: { id: "asc" },
		});
		const membersByCanonical = groupMembersByCanonical(members);
		composedEvents = rawEvents.map((e) =>
			composeEvent(e, membersByCanonical.get(e.id) ?? [])
		);
	}

	// Decimal e Date non attraversano il confine Server -> Client Component.
	const initialEvents: Event[] = composedEvents.map(serializeEvent);

	return <HomeClient initialEvents={initialEvents} initialTotal={total} />;
}
