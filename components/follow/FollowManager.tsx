"use client";

import { useId } from "react";
import { notify } from "@/components/account/NoticeHost";
import PlacePicker from "@/components/follow/PlacePicker";
import { PLACE_CAP, followId, isPlaceKind, type FollowItem } from "@/lib/follows/keys";
import { setFollowed, useFollowList, type FollowResult } from "@/lib/follows/store";

/**
 * Corpo della scheda "Cosa segui" su /account (Fase 23, UI-SPEC Superficie 4).
 * Ogni modifica passa dallo stesso store dei bottoni Segui: subito, con
 * ripristino della sola voce se il server rifiuta.
 */
export const SAVE_FAILED = "Non siamo riusciti a salvare. Riprova tra poco.";

export function reportResult(result: FollowResult): void {
	if (result === "cap") notify(`Hai raggiunto il limite di ${PLACE_CAP} luoghi seguiti`);
	else if (result === "error-follow" || result === "error-unfollow") notify(SAVE_FAILED);
}

export default function FollowManager() {
	const labelId = useId();
	const list = useFollowList() ?? [];
	const places = list.filter((f) => isPlaceKind(f.kind));
	const followed = new Set(list.map((f) => followId(f.kind, f.key)));

	const change = (item: FollowItem, on: boolean) => void setFollowed(item.kind, item.key, item.label, on).then(reportResult);

	return (
		<div>
			<p className="text-[17px] text-foreground">
				Scegli i posti e le categorie che vuoi ritrovare nella sezione «Per te» della home.
			</p>
			<div className="mt-6">
				<PlacePicker
					labelId={labelId}
					chipsLabel="Luoghi seguiti"
					chips={places}
					followed={followed}
					capReached={places.length >= PLACE_CAP}
					emptyText="Non segui ancora nessun luogo."
					onAdd={(item) => change(item, true)}
					onRemove={(item) => change(item, false)}
				/>
			</div>
		</div>
	);
}
