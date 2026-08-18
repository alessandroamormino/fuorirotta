/**
 * Decodifica le entita' HTML in caratteri.
 *
 * La tabella copre cio' che il contenuto scrapato italiano produce davvero:
 * vocali accentate, virgolette tipografiche, trattini, spazi non separabili.
 * Prima ne gestiva 7 e `&nbsp;`/`&egrave;` finivano a schermo cosi' com'erano
 * (visto in UAT sulle descrizioni di in-lombardia). Nessuna dipendenza nuova:
 * per un insieme chiuso di entita' una tabella basta.
 *
 * Un solo passaggio di regex: la versione precedente costruiva una RegExp per
 * ogni voce della tabella dentro un ciclo.
 */
const HTML_ENTITIES: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
	nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", shy: "",
	agrave: "à", egrave: "è", eacute: "é", igrave: "ì", ograve: "ò", ugrave: "ù",
	Agrave: "À", Egrave: "È", Eacute: "É", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
	ccedil: "ç", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä",
	lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
	sbquo: "\u201a", bdquo: "\u201e", laquo: "«", raquo: "»",
	ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022",
	middot: "·", deg: "°", euro: "€", copy: "©", reg: "®", trade: "™",
	frac12: "½", frac14: "¼", times: "×", divide: "÷",
};

export function decodeHtmlEntities(text: string): string {
	return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
		if (body[0] === "#") {
			const code =
				body[1] === "x" || body[1] === "X"
					? parseInt(body.slice(2), 16)
					: parseInt(body.slice(1), 10);
			// Un code point fuori range produrrebbe un carattere di sostituzione:
			// meglio lasciare l'entita' visibile che corrompere il testo in silenzio.
			return Number.isFinite(code) && code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: match;
		}
		// Entita' non in tabella: lasciata intatta, non inventata.
		return HTML_ENTITIES[body] ?? match;
	});
}

/**
 * Join class names, filtering out falsy values.
 * No clsx/tailwind-merge: fixed variant sets don't need class-conflict resolution (D-09).
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
	return classes.filter(Boolean).join(" ");
}

/**
 * Converte HTML scrapato in testo semplice, preservando le interruzioni di paragrafo.
 *
 * Perche' esiste: `in-lombardia` consegna le descrizioni in HTML (1.575 su 1.575
 * contengono tag, 599 anche entita'). Il rendering le stampava come testo, quindi
 * l'utente vedeva `<p>` e `&nbsp;` a schermo. Non si usa dangerouslySetInnerHTML:
 * sarebbe una via d'ingresso XSS da contenuto scrapato (T-07-09). Si converte in
 * testo prima di renderizzarlo come testo.
 *
 * <br> e </p> diventano \n, cosi' il `whitespace-pre-line` gia' presente nel
 * markup rende i paragrafi senza bisogno di altro.
 */
export function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "\u2022 ")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
