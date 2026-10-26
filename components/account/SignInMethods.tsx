"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { CircleAlert } from "lucide-react";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { notify } from "@/components/account/NoticeHost";
import AppleLogo from "@/components/account/AppleLogo";

/**
 * Metodi di accesso (D-08, D-10, D-11): una riga per provider, Apple prima di
 * Google. Lo stato collegato arriva dal server (la pagina e' dinamica) e qui
 * resta in useState solo per aggiornare le righe dopo uno scollegamento.
 * Scollega apre una conferma sotto la riga (non un dialogo: e' reversibile) e
 * compare solo se resta un altro metodo davvero usabile: con Apple spento non
 * si offre mai, perche' scollegare Google lascerebbe solo Apple, che non puo'
 * far entrare (D-10; il server resta permissivo, il limite e' dell'interfaccia).
 * Collega fa una navigazione completa verso il provider e torna su /account
 * gia' aggiornata: nessuna sincronizzazione lato client.
 */
type Provider = "apple" | "google";

const NAME: Record<Provider, string> = { apple: "Apple", google: "Google" };

const START_FAILED = "Non siamo riusciti ad avviare il collegamento. Riprova.";
const RATE_LIMITED = "Troppi tentativi, riprova tra qualche minuto";

const CONFIRM_TEXT: Record<Provider, string> = {
	google: "Non potrai più entrare con Google. Il tuo profilo e i tuoi dati restano.",
	apple:
		"Non potrai più entrare con Apple. Il tuo profilo e i tuoi dati restano. Revochiamo anche l'autorizzazione data a Fuorirotta nel tuo ID Apple.",
};

// Better Auth vuole l'id della RIGA di auth_account, non il sub del provider
// (verificato su 1.7.10): lo si legge da list-accounts, che non restituisce token.
async function accountRowId(provider: Provider): Promise<string | null> {
	const res = await fetch("/api/auth/list-accounts");
	if (!res.ok) return null;
	const rows = (await res.json()) as { id: string; providerId: string }[];
	return rows.find((row) => row.providerId === provider)?.id ?? null;
}

export default function SignInMethods({
	linked: initialLinked,
	appleOn,
}: {
	linked: { apple: boolean; google: boolean };
	appleOn: boolean;
}) {
	const [linked, setLinked] = useState(initialLinked);
	// Un'azione alla volta per tutta la card.
	const [pending, setPending] = useState<Provider | null>(null);
	// Pannello di conferma aperto (uno solo), scollegamento in volo e ultimo esito negativo.
	const [open, setOpen] = useState<Provider | null>(null);
	const [unlinking, setUnlinking] = useState(false);
	const [unlinkFailed, setUnlinkFailed] = useState(false);
	// Dopo lo scollegamento il focus passa al nuovo "Collega" della stessa riga:
	// il pulsante esiste solo dopo il render, quindi si ricorda dove andare.
	const focusCollega = useRef<Provider | null>(null);

	// Focus su "Annulla" all'apertura (la scelta sicura).
	useEffect(() => {
		if (open) document.getElementById(`metodi-annulla-${open}`)?.focus();
	}, [open]);

	useEffect(() => {
		if (focusCollega.current) document.getElementById(`metodi-collega-${focusCollega.current}`)?.focus();
		focusCollega.current = null;
	}, [linked]);

	const close = (provider: Provider) => {
		setOpen(null);
		setUnlinkFailed(false);
		document.getElementById(`metodi-scollega-${provider}`)?.focus();
	};

	// Escape chiude, tranne mentre la richiesta e' in volo.
	useEffect(() => {
		if (!open || unlinking) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") close(open);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, unlinking]);

	const unlink = async (provider: Provider) => {
		if (unlinking) return;
		setUnlinking(true);
		setUnlinkFailed(false);
		try {
			const id = await accountRowId(provider);
			const res = id
				? await fetch("/api/auth/unlink-account", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ accountId: id }),
					})
				: null;
			if (res?.ok) {
				setLinked((prev) => ({ ...prev, [provider]: false }));
				setOpen(null);
				focusCollega.current = provider;
				notify(`${NAME[provider]} scollegato`);
			} else {
				setUnlinkFailed(true);
			}
		} catch {
			setUnlinkFailed(true);
		}
		setUnlinking(false);
	};

	const link = async (provider: Provider) => {
		if (pending !== null) return;
		setPending(provider);
		try {
			const res = await fetch("/api/auth/link-social", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					provider,
					callbackURL: `/account?linked=${provider}`,
					errorCallbackURL: `/account?link=${provider}`,
				}),
			});
			if (res.ok) {
				const { url } = (await res.json()) as { url?: string };
				if (url) {
					// Resta in "pending" fino a che il browser parte per il provider.
					window.location.assign(url);
					return;
				}
			}
			notify(res.status === 429 ? RATE_LIMITED : START_FAILED);
		} catch {
			notify(START_FAILED);
		}
		setPending(null);
	};

	// Con l'interruttore spento la riga di Apple c'e' solo se Apple e' gia' collegato (D-04).
	const providers: Provider[] = appleOn || linked.apple ? ["apple", "google"] : ["google"];
	const count = Number(linked.apple) + Number(linked.google);
	const canUnlink = appleOn && count === 2;

	return (
		<Card className="p-0">
			<ul>
				{providers.map((provider, index) => (
					<li key={provider} className={index > 0 ? "border-t border-border-soft" : undefined}>
						<div className="flex items-center gap-4 px-6 py-4">
							<span className="flex-none text-foreground">
								{provider === "apple" ? (
									<AppleLogo size={20} />
								) : (
									<Image src="/images/google-g.svg" width={20} height={20} alt="" />
								)}
							</span>
							<p className="min-w-0 flex-1">
								<span className="block text-base font-medium text-foreground">{NAME[provider]}</span>
								<span className="mt-1 block text-sm text-foreground-secondary">
									{linked[provider] ? "Collegato" : "Non collegato"}
								</span>
							</p>
							{!linked[provider] && (provider !== "apple" || appleOn) && (
								<Button
									id={`metodi-collega-${provider}`}
									variant="secondary"
									size="md"
									aria-label={`Collega ${NAME[provider]}`}
									loading={pending === provider}
									disabled={pending !== null}
									onClick={() => link(provider)}
									className="min-w-24 flex-none"
								>
									Collega
								</Button>
							)}
							{linked[provider] && canUnlink && (
								<Button
									id={`metodi-scollega-${provider}`}
									variant="secondary"
									size="md"
									aria-label={`Scollega ${NAME[provider]}`}
									aria-expanded={open === provider}
									aria-controls={`metodi-conferma-${provider}`}
									disabled={pending !== null || unlinking}
									onClick={() => {
										setUnlinkFailed(false);
										setOpen(open === provider ? null : provider);
									}}
									className="min-w-24 flex-none"
								>
									Scollega
								</Button>
							)}
						</div>
						{open === provider && linked[provider] && canUnlink && (
							<div id={`metodi-conferma-${provider}`} className="px-6 pb-4">
								<p className="text-sm text-foreground">{CONFIRM_TEXT[provider]}</p>
								{unlinkFailed && (
									<p role="alert" className="mt-4 flex items-start gap-2 text-sm text-foreground">
										<CircleAlert size={18} aria-hidden="true" className="mt-px flex-none text-destructive" />
										<span>{`Non siamo riusciti a scollegare ${NAME[provider]}. Riprova.`}</span>
									</p>
								)}
								<div className="mt-4 flex gap-2">
									<Button
										variant="primary"
										size="md"
										loading={unlinking}
										onClick={() => unlink(provider)}
										className="min-w-40"
									>
										{`Scollega ${NAME[provider]}`}
									</Button>
									<Button
										id={`metodi-annulla-${provider}`}
										variant="ghost"
										size="md"
										disabled={unlinking}
										onClick={() => close(provider)}
									>
										Annulla
									</Button>
								</div>
							</div>
						)}
					</li>
				))}
			</ul>
			{count === 1 && (
				<div className="border-t border-border-soft px-6 py-4 text-sm text-foreground-secondary">
					Puoi scollegare un metodo solo se ne resta un altro.
				</div>
			)}
		</Card>
	);
}
