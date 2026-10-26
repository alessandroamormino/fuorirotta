"use client";

import { useState } from "react";
import Image from "next/image";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { notify } from "@/components/account/NoticeHost";
import AppleLogo from "@/components/account/AppleLogo";

/**
 * Metodi di accesso (D-08, D-10, D-11): una riga per provider, Apple prima di
 * Google. Lo stato collegato arriva dal server (la pagina e' dinamica) e qui
 * resta in useState solo per aggiornare le righe dopo uno scollegamento.
 * Collega fa una navigazione completa verso il provider e torna su /account
 * gia' aggiornata: nessuna sincronizzazione lato client.
 */
type Provider = "apple" | "google";

const NAME: Record<Provider, string> = { apple: "Apple", google: "Google" };

const START_FAILED = "Non siamo riusciti ad avviare il collegamento. Riprova.";
const RATE_LIMITED = "Troppi tentativi, riprova tra qualche minuto";

export default function SignInMethods({
	linked: initialLinked,
	appleOn,
}: {
	linked: { apple: boolean; google: boolean };
	appleOn: boolean;
}) {
	const [linked] = useState(initialLinked);
	// Un'azione alla volta per tutta la card.
	const [pending, setPending] = useState<Provider | null>(null);

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

	return (
		<Card className="p-0">
			<ul>
				{providers.map((provider, index) => (
					<li
						key={provider}
						className={`flex items-center gap-4 px-6 py-4 ${index > 0 ? "border-t border-border-soft" : ""}`}
					>
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
