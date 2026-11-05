"use client";

import { useEffect } from "react";
import { useUserState } from "@/components/account/UserStateProvider";
import { notify } from "@/components/account/NoticeHost";
import { clearVisitedDevice, loadVisitedIds, readVisitedDevice, resetVisitedIds } from "@/lib/visited/store";

/**
 * Ponte a effetto puro fra l'accesso e lo store dei visitati, gemello di SavedSync.
 * Non rende nulla. Prima dell'accesso non manda niente a nessuna rotta /api/v1/me
 * (T-27.1-24). Al primo caricamento con l'accesso fatto unisce la lista del browser
 * nell'account (D-07) e solo dopo carica gli id.
 */

// Una sola unione alla volta in questa pagina: un secondo effetto attende la stessa promessa.
let merging: Promise<void> | null = null;

type Merged = { added?: number; overCap?: number };

const postMerge = (entries: ReturnType<typeof readVisitedDevice>) =>
	fetch("/api/v1/me/visited/merge", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ items: entries }),
	});

async function mergeDeviceList(): Promise<void> {
	const entries = readVisitedDevice();
	if (entries.length === 0) return;
	let added = 0;
	let overCap = 0;
	try {
		const res = await postMerge(entries);
		if (res.ok) {
			const j = (await res.json()) as Merged;
			added = j.added ?? 0;
			overCap = j.overCap ?? 0;
			// Solo gli id mandati, solo dopo il 2xx: un invio perso si ripete senza danni (idempotente).
			clearVisitedDevice(entries.map((e) => e.id));
		} else if (res.status === 400) {
			// 400 = rifiuto definitivo: ritentare lo stesso corpo non servirebbe. Una voce per volta:
			// le buone entrano, la guasta si scarta (stessa regola dei salvati).
			for (const e of entries) {
				const one = await postMerge([e]);
				if (one.ok) {
					const j = (await one.json()) as Merged;
					added += j.added ?? 0;
					overCap += j.overCap ?? 0;
					clearVisitedDevice([e.id]);
				} else if (one.status === 400) {
					clearVisitedDevice([e.id]);
				} else {
					break; // 401/5xx: non e' colpa della voce, il resto riprova al prossimo caricamento
				}
			}
		} else {
			return; // 5xx / sessione: la lista resta sul dispositivo e riprova al prossimo caricamento
		}
	} catch {
		// Rete assente: la lista resta, si riprova al prossimo caricamento.
	}
	if (overCap > 0) notify("Hai raggiunto il limite di 500 eventi visitati. Rimuovine qualcuno per aggiungerne altri.");
	else if (added === 1) notify("1 evento aggiunto ai visitati");
	else if (added > 1) notify(`${added} eventi aggiunti ai visitati`);
}

export default function VisitedSync() {
	const { user } = useUserState();
	const userKey = user?.email ?? null;

	useEffect(() => {
		// Cambio di utente (anche l'uscita): gli id dell'altro non restano.
		resetVisitedIds();
		if (!userKey) return;
		void (async () => {
			merging ??= mergeDeviceList().finally(() => {
				merging = null;
			});
			await merging;
			await loadVisitedIds();
		})();
	}, [userKey]);

	return null;
}
