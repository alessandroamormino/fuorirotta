import { NextRequest, NextResponse } from "next/server";
import { getComposedEvent, canonicalEventUrl } from "@/lib/events/getComposedEvent";
import { buildIcs, calendarFields } from "@/lib/calendar/ics";

const TEXT = "text/plain; charset=utf-8";

// Il file .ics di un evento (CAL-01). Anonimo e cacheable: il handler non
// legge cookie ne' header della richiesta e serve solo campi gia' pubblici
// sulla pagina evento (T-20-14).
export async function GET(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		// Solo cifre, al massimo nove: "12abc" (che parseInt leggerebbe 12) e i
		// valori oltre la colonna int4 non arrivano mai a Prisma (T-20-12).
		if (!/^\d{1,9}$/.test(id)) {
			return new Response("Identificativo non valido", { status: 400, headers: { "content-type": TEXT } });
		}
		const download = request.nextUrl.searchParams.get("download") === "1";

		const result = await getComposedEvent(Number(id));
		if (result.status === "not-found") {
			return new Response("Evento non trovato", { status: 404, headers: { "content-type": TEXT } });
		}
		// 307 (mai 301): la fusione e' reversibile, come in /api/events/[id].
		// Il target nasce dalla colonna canonical_event_id e dal flag gia'
		// interpretato, mai dalla query string ricevuta (T-20-11, T-10-03).
		if (result.status === "member") {
			return NextResponse.redirect(
				new URL(`/api/events/${result.canonicalId}/ics${download ? "?download=1" : ""}`, request.url),
				307
			);
		}

		const { event } = result;
		const body = buildIcs(calendarFields(event, canonicalEventUrl(event.id)), {
			uid: `event-${event.id}@fuori-rotta.it`,
			stamp: event.updatedAt,
		});
		return new Response(body, {
			headers: {
				"content-type": "text/calendar; charset=utf-8",
				// Senza download=1 "inline": Safari su iPhone apre il foglio
				// "Aggiungi al calendario". Nome ASCII dal solo id numerico (T-20-10).
				"content-disposition": `${download ? "attachment" : "inline"}; filename="fuorirotta-${event.id}.ics"`,
				"cache-control": "public, max-age=600",
			},
		});
	} catch (error) {
		console.error("Error building ics:", error);
		return new Response("Errore interno", { status: 500, headers: { "content-type": TEXT } });
	}
}
