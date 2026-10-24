"use client";

import { useEffect } from "react";
import { useUserState } from "@/components/account/UserStateProvider";
import { notify } from "@/components/account/NoticeHost";
import { takeFollowIntent } from "@/lib/follows/intent";
import { noticeName } from "@/lib/follows/keys";
import { loadFollows, setFollowAuth, setFollowed } from "@/lib/follows/store";

/**
 * Ponte a effetto puro fra il Context dell'utente e lo store dei follow: lo
 * store e' un modulo, quindi lo stato dell'accesso gli arriva da qui. Non rende
 * nulla. Una volta per utente (chiave: l'e-mail, lo stato non ha l'id) carica
 * la lista per tutta l'app, poi ripete UNA volta il "Segui" che un ospite aveva
 * toccato prima di accedere (D-01).
 */

// Una sola ripetizione alla volta in questa pagina (come l'unione di SavedSync).
let replaying: Promise<void> | null = null;

async function replayIntent(): Promise<void> {
	const intent = takeFollowIntent();
	if (!intent) return;
	const result = await setFollowed(intent.kind, intent.key, intent.chip, true);
	if (result === "followed") notify(`Ora segui ${noticeName(intent.chip)}`);
	else if (result === "cap") notify("Hai raggiunto il limite di 50 luoghi seguiti");
	else if (result === "error-follow") notify(`Non siamo riusciti a seguire ${noticeName(intent.chip)}. Riprova tra poco.`);
}

export default function FollowSync() {
	const { enabled, user } = useUserState();
	const signedIn = user !== null;
	const userKey = user?.email ?? null;

	useEffect(() => {
		setFollowAuth({ enabled, signedIn });
		if (!userKey) return;
		// Se la lista non si carica l'intento resta (scade in 15 minuti) e riprova al prossimo caricamento.
		void loadFollows().then((loaded) => {
			if (loaded && !replaying) replaying = replayIntent().finally(() => (replaying = null));
		});
	}, [enabled, signedIn, userKey]);

	return null;
}
