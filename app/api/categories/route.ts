import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CANONICAL_CATEGORIES, orderCategories } from "@/lib/categories/taxonomy";
import { romeMidnightUTC, todayInRome } from "@/lib/dateWindow";

export async function GET() {
	try {
		// DEDUP-01 + D-09: la faccetta non deve mai dichiarare piu' eventi di
		// quanti la lista poi ne mostri. /api/events, chiamato senza dateFrom
		// (il caso che questa faccetta accompagna), usa oggi-a-Roma come inizio
		// finestra E semantica di OVERLAP (bugfix 2026-09-10, lib/dateWindow.ts,
		// app/api/events/route.ts): un evento conta se non e' ancora finito
		// prima di oggi, non solo se INIZIA oggi. Replicare qui esattamente la
		// stessa soglia e lo stesso OR su dateEnd e' cio' che tiene le due
		// risposte d'accordo (Rule 1: senza, il conteggio non includerebbe gli
		// eventi in corso che la lista di default ora mostra, o viceversa
		// includerebbe piu' del total). Una sola query raggruppata sostituisce
		// la vecchia forma N+1 (un findMany distinct + un count per valore).
		const windowStart = romeMidnightUTC(todayInRome());
		const grouped = await prisma.event.groupBy({
			by: ["canonicalCategory"],
			where: {
				canonicalEventId: null,
				OR: [
					{ dateEnd: { gte: windowStart } },
					{ AND: [{ dateEnd: null }, { dateStart: { gte: windowStart } }] },
				],
			},
			_count: true,
		});

		const countsByName = new Map<string, number>(
			grouped.map((row) => [row.canonicalCategory, row._count])
		);

		// Merge OBBLIGATORIO su CANONICAL_CATEGORIES, non un'ottimizzazione: la
		// query sopra restituisce solo i bucket con righe, quindi senza questo
		// merge una categoria a conteggio zero sparirebbe dalla risposta — e per
		// D-11 il bucket Altro a conteggio zero e' esattamente il segnale di
		// deriva che questa fase deve tenere visibile.
		const categoriesWithCount = CANONICAL_CATEGORIES.map((name) => ({
			name,
			count: countsByName.get(name) ?? 0,
		}));

		// Ordine deciso qui, non dal client: conteggio decrescente, pareggio
		// alfabetico, Altro sempre ultima — cosi' la riga dei chip non si
		// rimescola fra due refetch della stessa risposta.
		return NextResponse.json(orderCategories(categoriesWithCount));
	} catch (error) {
		console.error("Error fetching categories:", error);
		return NextResponse.json(
			{ error: "Failed to fetch categories" },
			{ status: 500 }
		);
	}
}
