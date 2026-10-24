"use client";

import { Check, Plus } from "lucide-react";
import { notify } from "@/components/account/NoticeHost";
import { requestSignIn } from "@/components/account/UserStateProvider";
import { noticeName, type PlaceKind } from "@/lib/follows/keys";
import { toggleFollow, useFollowAuth, useIsFollowing } from "@/lib/follows/store";
import { cn } from "@/lib/utils";

/**
 * Pillola "Segui" (PREF-01), isola client nelle pagine pubbliche in cache.
 * Tutto lo stato viene dallo store di modulo: server e primo render del client
 * sono SEMPRE la pillola non seguita, nella scatola definitiva e uguale per
 * tutti (React 418); lo stato seguito compare dopo l'idratazione senza
 * spostare nulla. Il testo visibile e il nome accessibile non cambiano con lo
 * stato: lo porta aria-pressed. Un tocco prima che l'account e la lista siano
 * noti si ignora, senza cambiare nulla alla vista.
 */
interface FollowButtonProps {
	kind: PlaceKind;
	/** ISTAT, sigla o slug: la chiave del follow. */
	followKey: string;
	/** Etichetta del luogo come nei chip ("Lombardia", "Provincia di Bergamo", "Bergamo (BG)"). */
	chip: string;
	/** Testo visibile; di default "Segui". */
	text?: string;
	className?: string;
}

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function FollowButton({ kind, followKey, chip, text, className }: FollowButtonProps) {
	const followed = useIsFollowing(kind, followKey);
	const auth = useFollowAuth();
	// Il flag di build e' inlinato, uguale sul server e sul client; enabled:false lo toglie dopo l'idratazione.
	if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true" || auth.enabled === false) return null;

	const Glyph = followed ? Check : Plus;
	return (
		<button
			type="button"
			onClick={() => {
				if (auth.enabled !== true) return;
				// L'ospite apre l'accesso; ricordare cosa voleva seguire e' del piano 03.
				if (!auth.signedIn) return requestSignIn();
				void toggleFollow(kind, followKey, chip).then((result) => {
					if (result === "cap") notify("Hai raggiunto il limite di 50 luoghi seguiti");
					else if (result === "error-follow") notify(`Non siamo riusciti a seguire ${noticeName(chip)}. Riprova tra poco.`);
					else if (result === "error-unfollow") notify(`Non siamo riusciti a smettere di seguire ${noticeName(chip)}. Riprova tra poco.`);
				});
			}}
			aria-pressed={followed}
			aria-label={`Segui ${noticeName(chip)}`}
			className={cn(
				"inline-flex h-11 max-w-full items-center justify-center gap-2 rounded-pill px-4 text-sm font-semibold transition-colors",
				followed ? "bg-primary text-primary-foreground hover:brightness-90" : "bg-surface text-foreground hover:bg-muted-strong",
				FOCUS_RING,
				className
			)}
			style={followed ? undefined : { boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
		>
			<Glyph size={16} strokeWidth={2} aria-hidden="true" className="shrink-0" />
			<span className="truncate">{text ?? "Segui"}</span>
		</button>
	);
}
