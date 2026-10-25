import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import { SHARE_DEAD_METADATA } from "@/lib/saved/share";

// L'UNICA pagina di un link morto (D-12, HTTP 404): codice ignoto, malformato,
// disattivato, sostituito, account cancellato, accesso spento. Nessuna prop, nessun
// ramo, nessuna parola che dica quale dei casi e': i contenuti sono uguali per
// costruzione. Non e' il not-found del sito: vale solo sotto /l/.
export const metadata = SHARE_DEAD_METADATA;

const FOCUS_RING =
	"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function SharedListDeadPage() {
	return (
		<>
			<SiteHeader />
			<main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
				<h1
					className="mb-1 font-display text-xl font-semibold leading-[1.2] text-foreground break-words"
					style={{ letterSpacing: "var(--tracking-display)" }}
				>
					Questo link non è disponibile
				</h1>
				<p className="mt-2 text-base text-foreground-secondary">Chi ha condiviso la lista potrebbe averlo disattivato.</p>
				<Link
					href="/"
					className={`mt-6 inline-flex h-12 items-center rounded-pill bg-surface px-4 text-sm font-semibold text-foreground hover:bg-muted-strong ${FOCUS_RING}`}
					style={{ boxShadow: "inset 0 0 0 1px var(--border-soft)" }}
				>
					Scopri gli eventi
				</Link>
			</main>
			<Footer />
		</>
	);
}
