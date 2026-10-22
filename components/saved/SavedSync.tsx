"use client";

import { useEffect } from "react";
import { useUserState } from "@/components/account/UserStateProvider";
import { setSavedAuth } from "@/lib/saved/store";

/**
 * Ponte a effetto puro fra il Context dell'utente e lo store dei salvati: lo
 * store e' un modulo letto anche dal popup della mappa (altra radice, nessun
 * provider), quindi lo stato dell'accesso gli arriva da qui e non dal Context.
 * Non rende nulla. I piani 22-03 e 22-04 lo estendono (unione, sincronizzazione).
 */
export default function SavedSync() {
	const { enabled, user } = useUserState();
	const signedIn = user !== null;

	useEffect(() => {
		setSavedAuth({ enabled, signedIn });
	}, [enabled, signedIn]);

	return null;
}
