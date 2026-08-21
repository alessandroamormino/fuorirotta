import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeComuneName } from "@/lib/territorial/normalize";

// Autocomplete comuni per il campo Dove della Navbar (UI-02, D-03, D-04).
// Match di prefisso su nome + alias, normalizzato con la stessa funzione della
// cascata di risoluzione territoriale (Fase 6) — non ILIKE/unaccent: il GIN
// index su Comune.aliases accelera containment su array, non un prefix match
// testuale (RESEARCH.md Pitfall 2), e 7.894 righe filtrate in JS sono
// trascurabili. Nessun header Cache-Control: coerente con gli altri 6 route
// handler esistenti, Next 16 non mette in cache i Route Handler GET per default.
export async function GET(request: NextRequest) {
	try {
		const q = request.nextUrl.searchParams.get("q") ?? "";
		const trimmed = q.trim();

		// Early-return prima di qualunque accesso al database (T-09-02): una
		// query vuota o di soli spazi non deve interrogare Postgres.
		if (!trimmed) {
			return NextResponse.json({ results: [] });
		}

		const normalizedQuery = normalizeComuneName(trimmed);

		// Il guard deve stare sulla stringa che il matcher usa davvero: normalizzare
		// "..." produce "" e startsWith("") matcha ogni riga della tabella (CR-01).
		if (!normalizedQuery) {
			return NextResponse.json({ results: [] });
		}

		const rows = await prisma.comune.findMany({
			select: {
				id: true,
				istatCode: true,
				name: true,
				aliases: true,
				provinceName: true,
				regionName: true,
			},
		});

		const matches = rows
			.map((r) => {
				const normalizedName = normalizeComuneName(r.name);
				const exact = normalizedName === normalizedQuery;
				const nameMatch = normalizedName.startsWith(normalizedQuery);
				const aliasMatch = r.aliases.some((a) =>
					normalizeComuneName(a).startsWith(normalizedQuery),
				);
				return nameMatch || aliasMatch ? { ...r, exact } : null;
			})
			.filter((r): r is NonNullable<typeof r> => r !== null)
			.sort((a, b) =>
				a.exact === b.exact ? a.name.localeCompare(b.name) : a.exact ? -1 : 1,
			)
			// slice(0, 8) sempre applicato, anche se `matches` fosse vuoto (T-09-02).
			.slice(0, 8);

		return NextResponse.json({
			results: matches.map((r) => ({
				id: r.id,
				istatCode: r.istatCode,
				name: r.name,
				provinceName: r.provinceName,
				regionName: r.regionName,
			})),
		});
	} catch (error) {
		console.error("[API] Error searching comuni:", error);
		return NextResponse.json(
			{ error: "Failed to search comuni" },
			{ status: 500 },
		);
	}
}
