import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import SavedList from "@/components/saved/SavedList";

// Guscio STATICO (D-03, ACCT-05): nessuna lettura della richiesta, nessuna
// esportazione di configurazione di rotta. E' la stessa pagina per ogni visitatore;
// la lista personale arriva dal client dopo l'idratazione, quindi la pagina
// non puo' finire in una cache condivisa con i dati di qualcuno.
export const metadata: Metadata = {
	title: "Salvati",
	robots: { index: false },
};

export default function SalvatiPage() {
	return (
		<>
			<SiteHeader />
			<main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
				<h1
					className="mb-4 font-display text-xl font-semibold leading-[1.2] text-foreground"
					style={{ letterSpacing: "var(--tracking-display)" }}
				>
					Salvati
				</h1>
				<SavedList />
			</main>
			<Footer />
		</>
	);
}
