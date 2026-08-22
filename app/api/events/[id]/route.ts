import { NextRequest, NextResponse } from "next/server";
import { serializeEvent } from "@/lib/serializeEvent";
import { prisma } from "@/lib/prisma";
import { composeEvent } from "@/lib/dedup/compose";

export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const eventId = parseInt(id);

		if (isNaN(eventId)) {
			return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
		}

		const event = await prisma.event.findUnique({
			where: { id: eventId },
		});

		if (!event) {
			return NextResponse.json({ error: "Event not found" }, { status: 404 });
		}

		// D-15: una riga membro reindirizza sempre alla canonica, con un redirect
		// TEMPORANEO (307, mai 301/308): la fusione e' reversibile per progetto
		// (DEDUP-05) e un redirect permanente resterebbe in cache del browser
		// anche dopo l'annullamento della fusione. Il target e' un intero letto
		// dalla colonna canonical_event_id, concatenato in un percorso RELATIVO
		// risolto contro request.url — mai un valore proveniente da query string
		// o header (T-10-03, redirect aperto). Non puo' innescare un ciclo:
		// nessuna riga membro punta a un'altra riga membro (il passo di dedup
		// assegna sempre la radice MIN(id)), invariante verificata a ogni
		// esecuzione dalla sezione S5 di scripts/dedup.test.sh (T-10-12).
		if (event.canonicalEventId !== null) {
			return NextResponse.redirect(
				new URL(`/api/events/${event.canonicalEventId}`, request.url),
				307
			);
		}

		// DEDUP-04: la riga e' canonica, comporla con i suoi membri prima di
		// serializzare. Per un evento non fuso `members` e' vuoto e composeEvent
		// restituisce la riga invariata.
		const members = await prisma.event.findMany({
			where: { canonicalEventId: event.id },
			orderBy: { id: "asc" },
		});
		const composedEvent = composeEvent(event, members);

		return NextResponse.json(serializeEvent(composedEvent));
	} catch (error) {
		console.error("Error fetching event:", error);
		return NextResponse.json(
			{ error: "Failed to fetch event" },
			{ status: 500 }
		);
	}
}
