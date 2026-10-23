"use client";

import { useEffect } from "react";
import { useUserState } from "@/components/account/UserStateProvider";
import { loadFollows, setFollowAuth } from "@/lib/follows/store";

/**
 * Ponte a effetto puro fra il Context dell'utente e lo store dei follow: lo
 * store e' un modulo, quindi lo stato dell'accesso gli arriva da qui. Non rende
 * nulla. Una volta per utente (chiave: l'e-mail, lo stato non ha l'id) carica
 * la lista per tutta l'app.
 */
export default function FollowSync() {
	const { enabled, user } = useUserState();
	const signedIn = user !== null;
	const userKey = user?.email ?? null;

	useEffect(() => {
		setFollowAuth({ enabled, signedIn });
		if (userKey) void loadFollows();
	}, [enabled, signedIn, userKey]);

	return null;
}
