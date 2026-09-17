/**
 * Due varianti e nient'altro (Fase 15, D-05/D-06): sono state scartate
 * esplicitamente — nessun suggerimento della zona coperta piu' vicina,
 * nessuna raccolta di contatti, nessuna terza variante generica. Reintro-
 * durle di straforo sarebbe una capacita' nuova non decisa.
 *
 * `region-not-covered`: chi cerca una zona che oggi non ha ancora dati
 * (tornare domani non cambia la risposta, serve una fonte nuova).
 * `no-events-for-filters`: chi cerca dove copriamo davvero, ma i filtri
 * (date, raggio) non trovano nulla — un'azione completamente diversa
 * (allargare la ricerca) da un problema completamente diverso.
 *
 * Il testo vive QUI e solo qui: app/[regione]/page.tsx e
 * app/[regione]/[provincia]/page.tsx lo riusano tale e quale.
 */
export type CoverageMessageVariant = "region-not-covered" | "no-events-for-filters";

const COPY: Record<CoverageMessageVariant, string> = {
	"region-not-covered":
		"Non copriamo ancora questa zona: stiamo aggiungendo nuove fonti, torna a trovarci presto.",
	"no-events-for-filters":
		"Nessun evento con questi filtri: prova ad allargare le date o il raggio di ricerca.",
};

interface CoverageMessageProps {
	variant: CoverageMessageVariant;
	/**
	 * Titolo mostrato sopra il testo — tipicamente il nome della zona
	 * cercata (regione o provincia). Facoltativo: un consumatore che mostra
	 * il messaggio dentro un risultato di ricerca puo' ometterlo.
	 */
	title?: string;
}

export default function CoverageMessage({ variant, title }: CoverageMessageProps) {
	return (
		<div className="text-center">
			{title && (
				<h1 className="font-display text-2xl font-semibold text-foreground">{title}</h1>
			)}
			<p className={title ? "mt-3 text-muted-foreground" : "text-muted-foreground"}>
				{COPY[variant]}
			</p>
		</div>
	);
}
