/**
 * Decode HTML entities to proper characters
 * Handles common entities: &#039; -> ', &amp; -> &, &lt; -> <, &gt; -> >, &quot; -> "
 * Also handles numeric entities like &#123;
 */
export function decodeHtmlEntities(text: string): string {
	const entities: Record<string, string> = {
		'&amp;': '&',
		'&lt;': '<',
		'&gt;': '>',
		'&quot;': '"',
		'&#039;': "'",
		'&#39;': "'",
		'&apos;': "'"
	};

	// Replace named entities
	let decoded = text;
	for (const [entity, char] of Object.entries(entities)) {
		decoded = decoded.replace(new RegExp(entity, 'g'), char);
	}

	// Replace numeric entities (e.g., &#123;)
	decoded = decoded.replace(/&#(\d+);/g, (match, dec) => {
		return String.fromCharCode(parseInt(dec, 10));
	});

	// Replace hex numeric entities (e.g., &#x7B;)
	decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
		return String.fromCharCode(parseInt(hex, 16));
	});

	return decoded;
}

/**
 * Join class names, filtering out falsy values.
 * No clsx/tailwind-merge: fixed variant sets don't need class-conflict resolution (D-09).
 */
export function cn(...classes: (string | false | null | undefined)[]): string {
	return classes.filter(Boolean).join(" ");
}
