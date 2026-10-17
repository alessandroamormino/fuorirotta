"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { DISPLAY_NAME_MAX, displayInitial, isValidDisplayName, normalizeDisplayName } from "@/lib/displayName";

/**
 * Profilo (D-07, D-09): cerchio con l'iniziale (mai la foto di Google), nome
 * modificabile, e-mail di sola lettura. Isola client perche' il nome cambia
 * subito dopo il salvataggio; la pagina server le passa i valori gia' pronti,
 * cosi' il primo HTML li contiene gia'.
 */
// Timeout di visualizzazione, non durata di animazione.
const SAVED_MS = 2000;

const NAME_ERROR_INVALID = "Scrivi un nome da 1 a 50 caratteri.";
const NAME_ERROR_SAVE = "Non siamo riusciti a salvare il nome. Riprova.";

export default function ProfileCard({ initialName, email }: { initialName: string; email: string }) {
	const [savedName, setSavedName] = useState(initialName);
	const [value, setValue] = useState(initialName);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [justSaved, setJustSaved] = useState(false);
	// Un secondo invio mentre il primo e' in volo non deve partire (il pulsante e' disabilitato, Invio no).
	const busy = useRef(false);

	useEffect(() => {
		if (!justSaved) return;
		const timer = setTimeout(() => setJustSaved(false), SAVED_MS);
		return () => clearTimeout(timer);
	}, [justSaved]);

	const trimmed = normalizeDisplayName(value);
	const canSave = !saving && trimmed !== "" && trimmed !== savedName;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (busy.current || trimmed === savedName) return;
		if (!isValidDisplayName(value)) {
			setError(NAME_ERROR_INVALID);
			return;
		}
		busy.current = true;
		setSaving(true);
		setError(null);
		try {
			const res = await fetch("/api/v1/me/profile", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ name: trimmed }),
			});
			if (!res.ok) {
				setError(NAME_ERROR_SAVE);
			} else {
				setSavedName(trimmed);
				setValue(trimmed);
				setJustSaved(true);
			}
		} catch {
			// Rete assente: stesso messaggio di un rifiuto del server, il testo dell'utente resta.
			setError(NAME_ERROR_SAVE);
		}
		busy.current = false;
		setSaving(false);
	};

	return (
		<Card className="p-6">
			<div className="flex items-center gap-4">
				<div
					aria-hidden="true"
					className="flex h-16 w-16 flex-none items-center justify-center rounded-full bg-foreground text-xl font-medium text-background"
				>
					{displayInitial(savedName, email)}
				</div>
				<div className="min-w-0">
					<p className="break-words text-base font-medium text-foreground">{savedName}</p>
					<p className="break-all text-sm text-foreground-secondary">{email}</p>
				</div>
			</div>

			<form onSubmit={submit} className="mt-6" noValidate>
				<label htmlFor="account-name" className="mb-2 block text-sm font-medium text-foreground">
					Nome
				</label>
				<div className="flex flex-col gap-2 sm:flex-row">
					<div className="flex-1">
						<Input
							id="account-name"
							name="name"
							size="md"
							className="w-full"
							value={value}
							maxLength={DISPLAY_NAME_MAX}
							autoComplete="name"
							inputMode="text"
							readOnly={saving}
							invalid={error !== null}
							errorMessage={error ?? undefined}
							aria-describedby="account-name-help"
							onChange={(event) => {
								setValue(event.target.value);
								setError(null);
							}}
						/>
					</div>
					<Button type="submit" variant="primary" size="md" loading={saving} disabled={!canSave} className="sm:min-w-24">
						Salva
					</Button>
				</div>
				<p id="account-name-help" className="mt-2 text-sm text-foreground-secondary">
					Da 1 a 50 caratteri.
				</p>
				{/* Sempre montata: la regione deve esistere prima del messaggio perche' venga annunciato. */}
				<div role="status" className="mt-2 min-h-5 text-sm text-foreground">
					{justSaved && (
						<span className="inline-flex items-center gap-2">
							<Check size={18} aria-hidden="true" />
							Nome salvato
						</span>
					)}
				</div>
			</form>

			<div className="mt-6">
				<p className="mb-1 text-sm font-medium text-foreground">Email</p>
				<p className="break-all text-base text-foreground">{email}</p>
				<p className="mt-1 text-sm text-foreground-secondary">Arriva dal tuo account Google e non si può cambiare.</p>
			</div>
		</Card>
	);
}
