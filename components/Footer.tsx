import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Piede di pagina minimo (D-13): solo markup statico, nessun hook e nessuna
 * lettura della richiesta, quindi non puo' cambiare gli header di cache delle
 * pagine che lo montano. Nessun anno: in HTML statico invecchierebbe.
 */
const LINK =
	"inline-flex min-h-11 items-center rounded-sm px-2 underline underline-offset-4 hover:text-foreground " +
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function Footer({ className }: { className?: string }) {
	return (
		<footer className={cn("border-t border-border-soft", className)}>
			<div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-2 px-4 py-8 text-sm text-foreground-secondary">
				<span>© Fuorirotta</span>
				<span aria-hidden="true">·</span>
				<nav aria-label="Informazioni legali" className="flex items-center">
					<Link href="/privacy" className={LINK}>
						Privacy
					</Link>
					<Link href="/cookie" className={LINK}>
						Cookie
					</Link>
				</nav>
			</div>
		</footer>
	);
}
