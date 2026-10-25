"use client";

import { useId, useRef, useState } from "react";
import { CircleAlert, X } from "lucide-react";
import * as Dialog from "@/components/ui/Dialog";
import Button from "@/components/ui/Button";
import { notify } from "@/components/account/NoticeHost";
import PlacePicker from "@/components/follow/PlacePicker";
import CategoryToggles from "@/components/follow/CategoryToggles";
import { loadFollows, useFollowList } from "@/lib/follows/store";
import { PLACE_CAP, followId, type FollowItem } from "@/lib/follows/keys";

/**
 * Finestra di benvenuto (Fase 23, PREF-03, UI-SPEC Superficie 3). Le scelte
 * vivono solo qui dentro e si applicano con "Fatto", in una richiesta sola insieme
 * al segno "vista". Salta, X, Escape e clic fuori significano tutti Salta: nessuna
 * scelta, solo il segno. Niente e' selezionato in partenza e nessun consenso si salva.
 */
const post = (places: readonly FollowItem[], categories: readonly string[]) =>
	fetch("/api/v1/me/onboarding", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			places: places.map(({ kind, key }) => ({ kind, key })),
			categories,
		}),
	});

export default function OnboardingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
	const labelId = useId();
	const stored = useFollowList() ?? [];
	const [picks, setPicks] = useState<FollowItem[]>([]);
	const [categories, setCategories] = useState<ReadonlySet<string>>(new Set());
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<"generic" | "cap" | null>(null);
	const content = useRef<HTMLDivElement>(null);
	const opener = useRef<Element | null>(null);

	// Chi segue gia' un luogo (ad esempio dal Segui che ha portato all'accesso) lo vede "Già seguito" e conta per il tetto.
	const followed = new Set([...stored, ...picks].map((f) => followId(f.kind, f.key)));
	const capReached = stored.filter((f) => f.kind !== "category").length + picks.length >= PLACE_CAP;

	// Salta, X, Escape e clic fuori: solo il segno "vista". Se non si salva, la finestra si chiude lo stesso e si riofferisce alla visita dopo.
	const dismiss = () => {
		if (saving) return;
		void post([], []).catch(() => {});
		onClose();
	};

	const save = async () => {
		setSaving(true);
		setError(null);
		try {
			const res = await post(picks, [...categories]);
			if (!res.ok) {
				setError(res.status === 409 ? "cap" : "generic");
				setSaving(false);
				return;
			}
		} catch {
			setError("generic");
			setSaving(false);
			return;
		}
		await loadFollows();
		onClose();
		if (picks.length + categories.size > 0) notify("Preferenze salvate");
	};

	return (
		<Dialog.Root open={open} onOpenChange={(next) => !next && dismiss()}>
			{/* "!" come in SignInDialog: w-full di Dialog.Content vince sul calc nel CSS compilato. */}
			<Dialog.Content
				ref={content}
				tabIndex={-1}
				className="w-[calc(100%-2rem)]! space-y-6"
				// Il primo focus sul contenitore, non nel campo: sul telefono la tastiera non deve coprire il testo ancora da leggere.
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					opener.current = document.activeElement;
					content.current?.focus();
				}}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
				}}
				// In volo non si chiude. Con la lista dei risultati aperta il primo Escape la chiude soltanto (la gestisce PlacePicker): Radix ascolta in cattura sul documento e arriverebbe prima.
				onEscapeKeyDown={(event) => {
					if (saving || (event.target instanceof HTMLElement && event.target.hasAttribute("data-picker-open"))) event.preventDefault();
				}}
				onPointerDownOutside={(event) => {
					if (saving) event.preventDefault();
				}}
			>
				<Dialog.Title className="text-lg font-semibold leading-[1.2] text-foreground font-display">Cosa vuoi seguire?</Dialog.Title>
				<Dialog.Description className="text-sm text-foreground-secondary">
					Scegli i posti e le categorie che ti interessano: li ritrovi in «Per te» nella home. Puoi cambiare tutto quando vuoi dal tuo account.
				</Dialog.Description>
				<PlacePicker
					labelId={labelId}
					chipsLabel="Luoghi scelti"
					chips={picks}
					followed={followed}
					capReached={capReached}
					disabled={saving}
					onAdd={(item) => setPicks((p) => [...p, item])}
					onRemove={(item) => setPicks((p) => p.filter((c) => followId(c.kind, c.key) !== followId(item.kind, item.key)))}
				/>
				<CategoryToggles
					selected={categories}
					disabled={saving}
					onToggle={(name) =>
						setCategories((s) => {
							const next = new Set(s);
							if (!next.delete(name)) next.add(name);
							return next;
						})
					}
				/>
				{error && (
					<div role="alert" className="flex items-start gap-2 text-sm text-foreground">
						<CircleAlert size={18} aria-hidden="true" className="mt-px shrink-0 text-destructive" />
						{error === "cap" ? "Hai raggiunto il limite di 50 luoghi seguiti" : "Non siamo riusciti a salvare le tue scelte. Riprova."}
					</div>
				)}
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button variant="ghost" size="md" disabled={saving} onClick={dismiss}>
						Salta
					</Button>
					<Button variant="primary" size="md" className="sm:min-w-24" loading={saving} onClick={() => void save()}>
						Fatto
					</Button>
				</div>
				{/* Dopo il corpo nell'ordine del DOM: il primo focus non finisce sulla X. */}
				<Dialog.Close asChild>
					<button
						type="button"
						aria-label="Chiudi"
						disabled={saving}
						className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-foreground hover:bg-muted-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
					>
						<X size={20} aria-hidden="true" />
					</button>
				</Dialog.Close>
			</Dialog.Content>
		</Dialog.Root>
	);
}
