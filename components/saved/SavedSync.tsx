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

async function mergeDeviceList(): Promise<void> {
	const entries = readDeviceList();
	if (entries.length === 0) return;
	try {
		const res = await fetch("/api/v1/me/saved/merge", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ items: entries.map(({ id, savedAt, snap }) => ({ id, savedAt, snap })) }),
		});
		if (!res.ok) return; // la lista resta sul dispositivo: riprova al prossimo caricamento
		const { added, overCap } = (await res.json()) as { added?: number; overCap?: number };
		// Solo gli id mandati, solo dopo il 2xx: un invio perso si ripete senza danni (idempotente).
		clearDeviceSaves(entries.map((e) => e.id));
		if (typeof overCap === "number" && overCap > 0) notify("Hai raggiunto il limite di 500 eventi salvati");
		else if (added === 1) notify("1 evento aggiunto ai salvati");
		else if (typeof added === "number" && added > 1) notify(`${added} eventi aggiunti ai salvati`);
	} catch {
		// Rete assente: la lista resta, si riprova al prossimo caricamento.
	}
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
