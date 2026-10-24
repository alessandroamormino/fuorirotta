"use client";

import { useEffect, useState } from "react";
import { useUserState } from "@/components/account/UserStateProvider";
import OnboardingDialog from "@/components/follow/OnboardingDialog";
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
// La finestra di benvenuto si offre una volta sola per caricamento di pagina (mai riaperta dopo Salta, nemmeno se il segno non si salva).
let offered = false;
// Pagine dove non compare mai: sono gia' il luogo dell'accesso o testi legali.
const ONBOARDING_SKIP_PATHS = ['/accedi', '/privacy', '/cookie'];

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
	const [onboarding, setOnboarding] = useState(false);

	useEffect(() => {
		setFollowAuth({ enabled, signedIn });
		if (!userKey) return;
		// Se la lista non si carica l'intento resta (scade in 15 minuti) e riprova al prossimo caricamento.
		void loadFollows().then(async (loaded) => {
			if (!loaded) return;
			if (!replaying) replaying = replayIntent().finally(() => (replaying = null));
			await replaying;
			// Dopo la ripetizione: un luogo appena seguito e' gia' nella lista quando la finestra si apre.
			if (!loaded.onboarded && enabled && !offered && !ONBOARDING_SKIP_PATHS.includes(window.location.pathname)) {
				offered = true;
				setOnboarding(true);
			}
		});
	}, [enabled, signedIn, userKey]);

	return onboarding ? <OnboardingDialog open onClose={() => setOnboarding(false)} /> : null;
}
