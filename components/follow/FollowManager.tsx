"use client";

import { useId } from "react";
import { notify } from "@/components/account/NoticeHost";
import CategoryToggles from "@/components/follow/CategoryToggles";
import PlacePicker from "@/components/follow/PlacePicker";
import Button from "@/components/ui/Button";
import { PLACE_CAP, followId, isPlaceKind, type FollowItem } from "@/lib/follows/keys";
import { loadFollows, setFollowed, useFollowList, useFollowsStatus, type FollowResult } from "@/lib/follows/store";

/**
 * Corpo della scheda "Cosa segui" su /account (Fase 23, UI-SPEC Superficie 4).
 * Ogni modifica passa dallo stesso store dei bottoni Segui: subito, con
 * ripristino della sola voce se il server rifiuta.
 */
function report(result: FollowResult): void {
	if (result === "cap") notify(`Hai raggiunto il limite di ${PLACE_CAP} luoghi seguiti`);
	else if (result === "error-follow" || result === "error-unfollow") notify("Non siamo riusciti a salvare. Riprova tra poco.");
}

export default function FollowManager() {
	const labelId = useId();
	const list = useFollowList();
	const status = useFollowsStatus();
	const items = list ?? [];
	const places = items.filter((f) => isPlaceKind(f.kind));
	const followed = new Set(items.map((f) => followId(f.kind, f.key)));
	const selected = new Set(items.filter((f) => f.kind === "category").map((f) => f.key));

	const change = (kind: FollowItem["kind"], key: string, label: string, on: boolean) =>
		void setFollowed(kind, key, label, on).then(report);

	// Senza lista (ancora in arrivo, o caduta) i campi non si usano; l'errore ha il suo ramo sotto.
	const loading = status === "pending" || list === null;

	return (
		<div aria-busy={loading && status !== "error" ? true : undefined}>
			<p className="text-[17px] text-foreground">
				Scegli i posti e le categorie che vuoi ritrovare nella sezione «Per te» della home.
			</p>
			{status === "error" && list === null ? (
				<div className="mt-6">
					<p className="text-sm text-foreground">Non riusciamo a caricare cosa segui. Riprova tra poco.</p>
					<Button variant="secondary" size="sm" className="mt-3" onClick={() => void loadFollows()}>
						Riprova
					</Button>
				</div>
			) : (
				<>
					<div className="mt-6">
						<PlacePicker
							labelId={labelId}
							chipsLabel="Luoghi seguiti"
							chips={places}
							followed={followed}
							capReached={places.length >= PLACE_CAP}
							disabled={loading}
							emptyText={loading ? undefined : "Non segui ancora nessun luogo."}
							onAdd={(item) => change(item.kind, item.key, item.label, true)}
							onRemove={(item) => change(item.kind, item.key, item.label, false)}
						/>
						{loading && (
							<div className="mt-3 flex flex-wrap gap-3" aria-hidden="true">
								{[0, 1, 2].map((i) => (
									<span key={i} className="h-9 w-28 rounded-pill bg-muted-strong" />
								))}
							</div>
						)}
					</div>
					<div className="mt-6">
						<CategoryToggles selected={selected} disabled={loading} onToggle={(name) => change("category", name, name, !selected.has(name))} />
					</div>
					{loading && (
						<p role="status" className="sr-only">
							Caricamento di cosa segui
						</p>
					)}
				</>
			)}
		</div>
	);
}
