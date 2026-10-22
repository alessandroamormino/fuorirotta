"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart } from "lucide-react";
import { HEADER_ICON_BOX } from "@/components/account/AccountButton";
import { useSavedCount, useSavedPulse } from "@/lib/saved/store";

/**
 * Cuore della testata verso /salvati (D-03). Sempre presente, con l'accesso
 * acceso o spento, per ospiti e utenti: non legge il flag di build ne' lo stato
 * di sessione. Il punto compare solo dopo l'idratazione (lo snapshot del
 * server e' 0 salvati) e pulsa una volta quando un tocco aggiunge un evento.
 */
export default function SavedNavButton() {
	const pathname = usePathname();
	const count = useSavedCount();
	const pulse = useSavedPulse();
	const current = pathname === "/salvati";

	return (
		<Link
			href="/salvati"
			aria-label="Salvati"
			aria-current={current ? "page" : undefined}
			className={`${HEADER_ICON_BOX} relative border border-border bg-surface text-foreground hover:border-primary/50`}
		>
			<Heart
				size={20}
				aria-hidden="true"
				fill={current ? "currentColor" : "none"}
				className={current ? "text-primary" : undefined}
			/>
			{count > 0 && (
				<span
					key={pulse}
					aria-hidden="true"
					data-saved-dot
					className={`absolute right-1 top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-surface ${
						pulse > 0 ? "animate-[heartPop_var(--motion-base)_var(--ease-standard)] motion-reduce:animate-none" : ""
					}`}
				/>
			)}
		</Link>
	);
}
