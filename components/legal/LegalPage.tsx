import SiteHeader from "@/components/SiteHeader";
import Footer from "@/components/Footer";
import Card from "@/components/ui/Card";

/**
 * Guscio delle pagine legali (/privacy, /cookie): componenti server, nessun
 * hook e nessuna lettura della richiesta, cosi' le pagine restano statiche
 * (21-UI-SPEC Superficie 7). Il testo e' contenuto scritto a mano; la data e'
 * una stringa letterale, mai new Date() (in HTML statico invecchierebbe).
 */

const PROSE =
	"[&_p]:mt-4 [&_p]:text-base [&_p]:break-words " +
	"[&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:scroll-mt-24 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:leading-[1.2] " +
	"[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_li]:text-base [&_li]:break-words " +
	"[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a]:break-words";

export function LegalPage({
	title,
	updated,
	index,
	children,
}: {
	title: string;
	updated: string;
	index?: { id: string; label: string }[];
	children: React.ReactNode;
}) {
	return (
		<>
			<SiteHeader />
			<main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12">
				<h1 className="text-xl font-medium leading-[1.2] text-foreground">{title}</h1>
				<p className="mt-2 text-sm text-foreground-secondary">Ultimo aggiornamento: {updated}</p>
				{index && (
					<nav aria-labelledby="indice-pagina" className="mt-6">
						<p id="indice-pagina" className="text-sm font-medium text-foreground">
							In questa pagina
						</p>
						<ul className="mt-2 space-y-1">
							{index.map((entry) => (
								<li key={entry.id} className="text-base">
									<a
										href={`#${entry.id}`}
										className="text-foreground underline underline-offset-4"
									>
										{entry.label}
									</a>
								</li>
							))}
						</ul>
					</nav>
				)}
				<div className={`text-foreground ${PROSE}`}>{children}</div>
			</main>
			<Footer />
		</>
	);
}

/**
 * Elenchi di fatti (fornitori, durate, cookie): un blocco dl in una Card per
 * voce, righe affiancate da sm in su e impilate sotto, cosi' a 320px non c'e'
 * nessuna tabella che scorre di lato. Contenuto d'autore: non esiste lo stato
 * vuoto di un elenco legale.
 */
export function FactList({ items }: { items: { title: string; facts: [string, React.ReactNode][] }[] }) {
	return (
		<>
			{items.map((item) => (
				<Card key={item.title} className="mt-4 p-6">
					<h3 className="break-words text-base font-medium text-foreground">{item.title}</h3>
					<dl className="mt-3 space-y-3">
						{item.facts.map(([label, value]) => (
							<div key={label} className="sm:grid sm:grid-cols-[160px_1fr] sm:gap-4">
								<dt className="text-sm font-medium text-foreground-secondary">{label}</dt>
								<dd className="mt-1 break-words text-base sm:mt-0">{value}</dd>
							</div>
						))}
					</dl>
				</Card>
			))}
		</>
	);
}
