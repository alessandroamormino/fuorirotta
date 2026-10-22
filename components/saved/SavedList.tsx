"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { applyResolved, readDeviceList } from "@/lib/saved/store";
import type { ResolvedItem, Snap } from "@/lib/saved/snapshot";
import { formatEventRange } from "@/lib/eventStatus";
import { decodeHtmlEntities } from "@/lib/utils";
import SaveHeart from "@/components/saved/SaveHeart";

interface Row {
	ref: number;
	eventId: number | null;
	snap: Snap;
}

/**
 * Lista di /salvati: legge il dispositivo DOPO il mount (lo storage non esiste
 * sul server), chiede al server le istantanee vive e le disegna. L'ora si legge
 * solo dopo la risposta, mai in un render che gira anche sul server.
 */
export default function SavedList() {
	const [rows, setRows] = useState<Row[] | null>(null);

	useEffect(() => {
		const load = async () => {
			const entries = readDeviceList();
			let resolved: ResolvedItem[] = [];
			if (entries.length > 0) {
				const res = await fetch("/api/v1/saved/resolve", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ ids: entries.map((e) => e.id) }),
				});
				resolved = ((await res.json()) as { items: ResolvedItem[] }).items;
				applyResolved(resolved);
			}
			const next: Row[] = [];
			for (const entry of entries) {
				const item = resolved.find((i) => i.ref === entry.id);
				const snap = item?.live ?? entry.snap;
				if (snap) next.push({ ref: entry.id, eventId: item?.eventId ?? null, snap });
			}
			setRows(next);
		};
		void load();
	}, []);

	return (
		<div aria-busy={rows === null}>
			<ul className="flex flex-col gap-4">
				{rows?.map((row) => (
					<li
						key={row.ref}
						className="relative flex items-start gap-2 rounded-lg bg-surface p-4 shadow-[var(--elev-ring)] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-background"
					>
						<div className="min-w-0 flex-1">
							{row.eventId !== null ? (
								<Link
									href={`/eventi/${row.eventId}`}
									className="line-clamp-2 font-display text-base font-semibold leading-[1.2] text-foreground text-balance after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
								>
									{decodeHtmlEntities(row.snap.title)}
								</Link>
							) : (
								<p className="line-clamp-2 font-display text-base font-semibold leading-[1.2] text-foreground text-balance">
									{decodeHtmlEntities(row.snap.title)}
								</p>
							)}
							<p className="mt-1 text-sm text-foreground-secondary">
								{[row.snap.place, formatEventRange(row.snap.dateStart, row.snap.dateEnd)].filter(Boolean).join(" · ")}
							</p>
						</div>
						<SaveHeart eventId={row.ref} title={row.snap.title} presentation="row" className="relative z-10 flex-none" />
					</li>
				))}
			</ul>
		</div>
	);
}
