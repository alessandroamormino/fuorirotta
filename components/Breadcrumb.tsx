import Link from "next/link";

export interface BreadcrumbItem {
	name: string;
	/** Assente per l'ultimo elemento: e' la pagina corrente, non un link. */
	href?: string;
}

/**
 * Nav visibile (Fase 15, ROLL-06): il JSON-LD BreadcrumbList vive in ogni
 * pagina chiamante (app/[regione]/page.tsx, app/[regione]/[provincia]/
 * page.tsx), non qui — l'escaping dello script inline e' un dettaglio della
 * singola pagina (stesso pattern di app/eventi/[id]/page.tsx), e i controlli
 * di verifica cercano quella stringa nel file della pagina stessa. Questo
 * componente resta solo la parte visibile e riusabile.
 */
export default function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
	return (
		<nav aria-label="Percorso di navigazione" className="mb-4 text-sm text-muted-foreground">
			<ol className="flex flex-wrap items-center gap-1.5">
				{items.map((item, i) => (
					<li key={item.name} className="flex items-center gap-1.5">
						{i > 0 && (
							<span aria-hidden="true" className="text-border">
								/
							</span>
						)}
						{item.href ? (
							<Link href={item.href} className="hover:text-foreground">
								{item.name}
							</Link>
						) : (
							<span className="text-foreground" aria-current="page">
								{item.name}
							</span>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}
