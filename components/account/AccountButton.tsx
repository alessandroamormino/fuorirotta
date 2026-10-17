"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User } from "lucide-react";
import { displayInitial } from "@/lib/displayName";
import { useUserState } from "./UserStateProvider";

/**
 * Icona della persona accanto al toggle del tema (D-01). Server e primo render
 * client mostrano sempre l'ospite; l'iniziale arriva dopo la richiesta di stato,
 * nella STESSA scatola da 40/44px, cosi' lo scambio non sposta nulla.
 * Senza il flag di build il pulsante non esiste nell'HTML.
 */
const BOX =
	"flex flex-none h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full shadow-sm transition-colors " +
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function AccountButton() {
	const { enabled, user, openSignIn } = useUserState();
	const pathname = usePathname();

	if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true" || enabled === false) return null;

	if (user) {
		return (
			<Link
				href="/account"
				aria-label="Il tuo account"
				aria-current={pathname === "/account" ? "page" : undefined}
				className={`${BOX} bg-foreground text-background text-sm font-medium`}
			>
				{displayInitial(user.name, user.email)}
			</Link>
		);
	}

	return (
		<button
			type="button"
			aria-haspopup="dialog"
			aria-label="Accedi"
			onClick={openSignIn}
			className={`${BOX} border border-border bg-surface text-foreground hover:border-primary/50`}
		>
			<User size={20} aria-hidden="true" />
		</button>
	);
}
