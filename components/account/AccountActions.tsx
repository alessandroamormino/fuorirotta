"use client";

import { useRef, useState } from "react";
import { CircleAlert, Download, LogOut, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import * as Dialog from "@/components/ui/Dialog";
import { notify, queueNoticeAfterNavigation } from "@/components/account/NoticeHost";

/**
 * Le tre azioni di /account che non toccano una lista: scarica i dati, esci,
 * elimina. Tutte POST/GET same-origin verso rotte che controllano Origin e
 * sessione (21-05); qui solo il guscio, con gli stati di attesa e di errore.
 * Uscita e cancellazione chiudono con una navigazione COMPLETA verso /: butta
 * via l'intero albero React e lo stato utente in memoria.
 */
const JSON_HEADERS = { "content-type": "application/json" };

/** POST {} a un endpoint della libreria; true se la risposta e' 2xx, false per rete assente o rifiuto. */
async function postEmpty(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { method: "POST", headers: JSON_HEADERS, body: "{}" });
		return res.ok;
	} catch {
		return false;
	}
}

// Nome del file da Content-Disposition; se manca o non ha la forma attesa si costruisce
// lo stesso nome con la data di Roma (D-12).
function exportFileName(disposition: string | null): string {
	const named = disposition?.match(/filename="?([A-Za-z0-9._-]+)"?/)?.[1];
	if (named) return named;
	const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
	return `fuorirotta-dati-${day}.json`;
}

export function ExportButton() {
	const [pending, setPending] = useState(false);
	const busy = useRef(false);

	const download = async () => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		try {
			const res = await fetch("/api/v1/me/export", { cache: "no-store" });
			if (!res.ok) throw new Error(String(res.status));
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = exportFileName(res.headers.get("content-disposition"));
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(url);
		} catch {
			notify("Non siamo riusciti a preparare il file. Riprova.");
		}
		busy.current = false;
		setPending(false);
	};

	return (
		<Button variant="secondary" size="md" loading={pending} onClick={download} className="min-w-48">
			<span className="inline-flex items-center gap-2">
				<Download size={18} aria-hidden="true" />
				Scarica i tuoi dati
			</span>
		</Button>
	);
}

export function SignOutButton() {
	const [pending, setPending] = useState(false);
	const busy = useRef(false);

	const signOut = async () => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		if (await postEmpty("/api/auth/sign-out")) {
			queueNoticeAfterNavigation("signed-out");
			// eslint-disable-next-line @next/next/no-location-assign-relative-destination -- navigazione completa voluta: scarta l'albero React e lo stato utente in memoria
			window.location.assign("/");
			return;
		}
		notify("Non siamo riusciti a uscire. Riprova.");
		busy.current = false;
		setPending(false);
	};

	return (
		<Button variant="secondary" size="md" loading={pending} onClick={signOut} className="min-w-24">
			<span className="inline-flex items-center gap-2">
				<LogOut size={18} aria-hidden="true" />
				Esci
			</span>
		</Button>
	);
}

export function DeleteAccountSection() {
	const [open, setOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const [failed, setFailed] = useState(false);
	const busy = useRef(false);

	const remove = async () => {
		if (busy.current) return;
		busy.current = true;
		setPending(true);
		setFailed(false);
		if (await postEmpty("/api/auth/delete-user")) {
			queueNoticeAfterNavigation("deleted");
			// eslint-disable-next-line @next/next/no-location-assign-relative-destination -- navigazione completa voluta: scarta l'albero React e lo stato utente in memoria
			window.location.assign("/");
			return;
		}
		setFailed(true);
		busy.current = false;
		setPending(false);
	};

	return (
		<Dialog.Root
			open={open}
			onOpenChange={(next) => {
				// Mai chiuso mentre la cancellazione e' in volo.
				if (pending) return;
				setOpen(next);
				if (!next) setFailed(false);
			}}
		>
			<Dialog.Trigger asChild>
				<Button variant="secondary" size="md">
					<span className="inline-flex items-center gap-2">
						<Trash2 size={18} aria-hidden="true" className="text-destructive" />
						Elimina account
					</span>
				</Button>
			</Dialog.Trigger>
			{/* "!" perche' w-full di Dialog.Content viene DOPO w-[calc(...)] nel CSS compilato (21-06). */}
			<Dialog.Content
				className="w-[calc(100%-2rem)]!"
				onEscapeKeyDown={(event) => pending && event.preventDefault()}
				onInteractOutside={(event) => pending && event.preventDefault()}
			>
				<Dialog.Title className="mb-2 text-lg font-medium leading-[1.2] text-foreground">
					Eliminare l&apos;account?
				</Dialog.Title>
				<Dialog.Description className="text-base text-foreground">
					Cancelliamo subito e per sempre account, sessioni e dati. Non si può annullare.
				</Dialog.Description>
				{failed && (
					<p role="alert" className="mt-4 flex items-start gap-2 text-sm text-foreground">
						<CircleAlert size={18} aria-hidden="true" className="mt-px flex-none text-destructive" />
						<span>Non siamo riusciti a eliminare l&apos;account. Riprova.</span>
					</p>
				)}
				{/* Annulla prima: il primo focus va all'azione sicura. */}
				<div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
					<Dialog.Close asChild>
						<Button variant="secondary" size="md" disabled={pending}>
							Annulla
						</Button>
					</Dialog.Close>
					<Button
						variant="destructive"
						size="md"
						loading={pending}
						onClick={remove}
						className="w-full sm:w-auto sm:min-w-60"
					>
						Elimina definitivamente
					</Button>
				</div>
			</Dialog.Content>
		</Dialog.Root>
	);
}
