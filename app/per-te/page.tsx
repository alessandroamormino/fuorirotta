import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import PerTeList from "@/components/follow/PerTeList";

// Guscio STATICO come /salvati (D-12): nessuna lettura della richiesta, nessuna
// esportazione di configurazione di rotta. E' la stessa pagina per ogni visitatore;
// la lista personale arriva dal client dopo l'idratazione, quindi nessuna cache
// condivisa puo' contenere i dati di qualcuno.
export const metadata: Metadata = {
	title: "Per te",
	robots: { index: false },
};

export default function PerTePage() {
	// Il flag di build e' inlinato: senza accesso la rotta non esiste (404).
	if (process.env.NEXT_PUBLIC_AUTH_ENABLED !== "true") notFound();
	return (
		<>
			<SiteHeader />
			<main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-12">
				<PerTeList />
			</main>
			<Footer />
		</>
	);
}
