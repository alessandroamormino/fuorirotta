import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getProvinceDirectory } from "@/lib/coverage/liveRegions";
import { comuneChip, provinceChip, regionChip, type PlaceKind } from "@/lib/follows/keys";
import { VALID_REGION_SLUGS } from "@/lib/scrapers/regionSlug";
import { normalizeComuneName } from "@/lib/territorial/normalize";

// Ricerca luoghi da seguire (Fase 23, D-09): regioni, province, comuni. Sorella
// di /api/comuni/search, che non cambia forma (la usano Navbar e check:comuni).
// Pubblica: nessun cookie letto o scritto, nessun log di q (minimizzazione).
// Le etichette le costruisce il server; il client non ne invia mai una.
type Result = { kind: PlaceKind; key: string; label: string; sublabel: string; chip: string };

const KIND_ORDER: Record<PlaceKind, number> = { region: 0, province: 1, comune: 2 };

export async function GET(request: NextRequest) {
	try {
		const trimmed = (request.nextUrl.searchParams.get("q") ?? "").trim();
		if (!trimmed) return NextResponse.json({ results: [] });

		// Il guard sta sulla stringa che il matcher usa davvero (CR-01), prima di ogni query (T-23-06).
		const q = normalizeComuneName(trimmed);
		if (q.length < 2) return NextResponse.json({ results: [] });

		const hits: Array<Result & { exact: boolean }> = [];
		const add = (r: Result, normalizedLabel: string, matched: boolean) => {
			if (matched) hits.push({ ...r, exact: normalizedLabel === q });
		};

		for (const [slug, name] of VALID_REGION_SLUGS) {
			const n = normalizeComuneName(name);
			add({ kind: "region", key: slug, label: name, sublabel: "Regione", chip: regionChip(name) }, n, n.startsWith(q));
		}

		for (const p of await getProvinceDirectory()) {
			const n = normalizeComuneName(p.provinceName);
			add(
				{
					kind: "province",
					key: p.provinceCode,
					label: p.provinceName,
					sublabel: `Provincia · ${VALID_REGION_SLUGS.get(p.regionSlug) ?? p.regionSlug}`,
					chip: provinceChip(p.provinceName),
				},
				n,
				n.startsWith(q),
			);
		}

		const rows = await prisma.comune.findMany({
			select: { istatCode: true, name: true, aliases: true, provinceCode: true, provinceName: true },
		});
		for (const c of rows) {
			const n = normalizeComuneName(c.name);
			add(
				{
					kind: "comune",
					key: c.istatCode,
					label: c.name,
					sublabel: `Comune · provincia di ${c.provinceName}`,
					chip: comuneChip(c.name, c.provinceCode),
				},
				n,
				n.startsWith(q) || c.aliases.some((a) => normalizeComuneName(a).startsWith(q)),
			);
		}

		const results = hits
			.sort(
				(a, b) =>
					Number(b.exact) - Number(a.exact) ||
					KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
					a.label.localeCompare(b.label, "it") ||
					a.key.localeCompare(b.key),
			)
			.slice(0, 8)
			.map((h): Result => ({ kind: h.kind, key: h.key, label: h.label, sublabel: h.sublabel, chip: h.chip }));

		return NextResponse.json({ results });
	} catch {
		// Nessun dettaglio interno nel corpo (T-23-07).
		return NextResponse.json({ error: "Failed to search places" }, { status: 500 });
	}
}
