import { prisma } from "@/lib/prisma";
import { Event } from "@/lib/types";
import { serializeEvent } from "@/lib/serializeEvent";
import { composeEvent, groupMembersByCanonical } from "@/lib/dedup/compose";
import HomeClient from "./HomeClient";
import { availableEventsWhere, windowStartToday } from "@/lib/dateWindow";

export const revalidate = 300; // Rivalidate ogni 5 minuti

export default async function Home() {
	// Le 12 schede dell'HTML devono essere le STESSE della prima pagina che
	// HomeClient chiede a /api/events senza filtri: disponibili (in corso o
	// futuri, lib/dateWindow.ts) nell'ordine di compareByWindowRelevance, dove
	// un evento conta da max(dateStart, oggi). Prima qui era `dateStart >= oggi`
	// in ordine di data: le mostre in corso mancavano, e la lista cambiava
	// sotto gli occhi al primo fetch.
	//
	// /api/events ordina in JS dopo aver letto TUTTE le righe; qui bastano due
	// query da 12, perche' quell'ordine si spezza in due blocchi: prima gli
	// eventi con chiave = oggi (gia' iniziati, o che iniziano a mezzanotte di
	// oggi) per id, poi quelli che iniziano dopo, per data e id.
	//
	// DEDUP-01: canonicalEventId: null su tutte e tre le query, non su una
	// sola — lista corretta e conteggio gonfio, o viceversa, sarebbe la peggiore
	// delle combinazioni (stesso rischio gia' evitato da /api/events in 10-02).
	const windowStart = windowStartToday();
	const available = { canonicalEventId: null, ...availableEventsWhere(windowStart) };
	// include comune (T-12-04): solo name/provinceCode, mai la riga intera.
	const include = { comune: { select: { name: true, provinceCode: true } } } as const;
	const [fromToday, later, total] = await Promise.all([
		prisma.event.findMany({
			where: { ...available, dateStart: { lte: windowStart } },
			orderBy: { id: "asc" },
			take: 12,
			include,
		}),
		prisma.event.findMany({
			where: { ...available, dateStart: { gt: windowStart } },
			orderBy: [{ dateStart: "asc" }, { id: "asc" }],
			take: 12,
			include,
		}),
		prisma.event.count({ where: available }),
	]);
	const rawEvents = [...fromToday, ...later].slice(0, 12);

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
		// `comune` non e' un COMPOSABLE_FIELDS: composeEvent lo lascia sempre
		// invariato dalla riga canonica (spread interno), lo stesso pattern di
		// cast di withComposedFields in app/api/events/route.ts.
		composedEvents = rawEvents.map(
			(e) => composeEvent(e, membersByCanonical.get(e.id) ?? []) as typeof e
		);
	}

	// Decimal e Date non attraversano il confine Server -> Client Component.
	const initialEvents: Event[] = composedEvents.map(serializeEvent);

	return <HomeClient initialEvents={initialEvents} initialTotal={total} />;
}
