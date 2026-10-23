"use client";

import { useEffect } from "react";
import { useUserState } from "@/components/account/UserStateProvider";
import { notify } from "@/components/account/NoticeHost";
import { clearDeviceSaves, loadAccountIds, markAccountReady, readDeviceList, setSavedAuth } from "@/lib/saved/store";

/**
 * Ponte a effetto puro fra il Context dell'utente e lo store dei salvati: lo
 * store e' un modulo letto anche dal popup della mappa (altra radice, nessun
 * provider), quindi lo stato dell'accesso gli arriva da qui e non dal Context.
 * Non rende nulla. Al primo caricamento con l'accesso fatto unisce la lista del
 * dispositivo nell'account (AUTH-09) e solo dopo carica gli id e sblocca /salvati.
 */

// Una sola unione alla volta in questa pagina: un secondo effetto attende la stessa promessa.
let merging: Promise<void> | null = null;

type Merged = { added?: number; overCap?: number };

const postMerge = (entries: ReturnType<typeof readDeviceList>) =>
	fetch("/api/v1/me/saved/merge", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ items: entries.map(({ id, savedAt, snap }) => ({ id, savedAt, snap })) }),
	});

async function mergeDeviceList(): Promise<void> {
	const entries = readDeviceList();
	if (entries.length === 0) return;
	let added = 0;
	let overCap = 0;
	let rejected = 0;
	try {
		const res = await postMerge(entries);
		if (res.ok) {
			const j = (await res.json()) as Merged;
			added = j.added ?? 0;
			overCap = j.overCap ?? 0;
			// Solo gli id mandati, solo dopo il 2xx: un invio perso si ripete senza danni (idempotente).
			clearDeviceSaves(entries.map((e) => e.id));
		} else if (res.status === 400) {
			// 400 = rifiuto definitivo (un valore che il database non accetta): ritentare lo stesso
			// corpo non servirebbe mai. Una voce per volta: le buone entrano, la guasta si scarta.
			for (const e of entries) {
				const one = await postMerge([e]);
				if (one.ok) {
					const j = (await one.json()) as Merged;
					added += j.added ?? 0;
					overCap += j.overCap ?? 0;
					clearDeviceSaves([e.id]);
				} else if (one.status === 400) {
					rejected += 1;
					clearDeviceSaves([e.id]);
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
	if (overCap > 0) notify("Hai raggiunto il limite di 500 eventi salvati");
	else if (added === 1) notify("1 evento aggiunto ai salvati");
	else if (added > 1) notify(`${added} eventi aggiunti ai salvati`);
	else if (rejected > 0) notify("Alcuni eventi salvati su questo dispositivo non si sono potuti aggiungere");
}

export default function SavedSync() {
	const { enabled, user } = useUserState();
	const signedIn = user !== null;
	const userKey = user?.email ?? null;

	useEffect(() => {
		setSavedAuth({ enabled, signedIn });
		if (!userKey) return;
		// Una volta per utente: setSavedAuth svuota gli id al cambio di modo, il caricamento li rimette.
		void (async () => {
			merging ??= mergeDeviceList().finally(() => {
				merging = null;
			});
			await merging;
			await loadAccountIds();
			markAccountReady();
		})();
	}, [enabled, signedIn, userKey]);

	return null;
}
