/**
 * Ordinamento dei risultati di ricerca per RILEVANZA rispetto alla finestra
 * cercata, non per dateStart assoluto (follow-up 2026-09-10 al bugfix
 * overlap di app/api/events/route.ts).
 *
 * Misurato sul DB locale: `dateFrom=dateTo=2026-09-10` restituisce 254
 * eventi. Ordinando per dateStart asc, in testa ci finiscono attrazioni
 * come "Gallerie Leonardo da Vinci" (2019-12-09 -> 2029-12-31): l'overlap e'
 * legittimo, ma un dateStart di anni fa le fa sorpassare qualunque evento
 * che accade DAVVERO il 10 settembre, che finisce sepolto in ultima pagina.
 * Il fix e' GREATEST(dateStart, windowStart): un'attrazione aperta dal 2019
 * si clampa al giorno cercato e ordina insieme agli eventi di quel giorno
 * invece che anni prima di loro.
 *
 * Prisma non ha GREATEST nel suo DSL di orderBy, quindi il confronto vive
 * qui in JS invece che in una query — i call site (app/api/events/route.ts)
 * lo applicano dopo un fetch che devono comunque fare per intero (mai
 * paginato lato DB), non e' un fetch aggiuntivo.
 */

export interface DatedEvent {
	id: number;
	dateStart: Date;
}

/** GREATEST(dateStart, windowStart) come istante, per un singolo evento. */
export function windowRelevanceKey(dateStart: Date, windowStart: Date): number {
	return Math.max(dateStart.getTime(), windowStart.getTime());
}

/**
 * Comparator per Array.prototype.sort: ordina per rilevanza clampata alla
 * finestra, pareggio per id (mai per dateStart grezzo — pareggiare sul
 * dateStart originale fra eventi gia' iniziati reintrodurrebbe esattamente
 * il difetto che questo modulo corregge, solo un livello piu' in basso).
 */
export function compareByWindowRelevance(windowStart: Date) {
	const start = windowStart.getTime();
	return (a: DatedEvent, b: DatedEvent): number => {
		const ka = Math.max(a.dateStart.getTime(), start);
		const kb = Math.max(b.dateStart.getTime(), start);
		if (ka !== kb) return ka - kb;
		return a.id - b.id;
	};
}

// ---------------------------------------------------------------------------
// Self-check: `npx tsx lib/eventOrdering.ts`. Guardia a tre condizioni
// (lib/pagination.ts:58, lib/dateWindow.ts, lib/eventStatus.ts:100): un
// `require.main === module` nudo esplode appena il modulo finisce in un
// bundle client. Oggi e' importato solo da app/api/events/route.ts
// (server-only), ma la guardia costa nulla.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
	let failures = 0;
	const assertCheck = (cond: boolean, msg: string) => {
		if (!cond) {
			console.error(`  FAIL: ${msg}`);
			failures++;
		}
	};

	const windowStart = new Date("2026-09-10T00:00:00.000Z");

	// Ancora reale (misurata sopra): un'attrazione aperta dal 2019 e un
	// evento che inizia esattamente il giorno cercato devono clamparsi alla
	// STESSA chiave — non piu' anni di distanza.
	assertCheck(
		windowRelevanceKey(new Date("2019-12-09T00:00:00.000Z"), windowStart) ===
			windowRelevanceKey(new Date("2026-09-10T00:00:00.000Z"), windowStart),
		"un'attrazione del 2019 deve clamparsi alla stessa chiave di un evento che inizia il giorno cercato"
	);

	// Un evento futuro (dateStart dopo la finestra) NON si clampa: resta
	// ordinato dopo, altrimenti ogni ricerca collasserebbe tutto allo stesso
	// giorno.
	assertCheck(
		windowRelevanceKey(new Date("2026-09-15T00:00:00.000Z"), windowStart) >
			windowRelevanceKey(new Date("2026-09-10T00:00:00.000Z"), windowStart),
		"un evento futuro deve ordinare dopo il giorno cercato, mai clamparsi"
	);

	// Il comparator applicato a un mix realistico: il long-runner del 2019 e
	// l'evento-di-oggi finiscono in testa (pareggiati per id), il futuro in
	// coda — l'identico scenario misurato sul DB locale.
	const longRunner: DatedEvent = { id: 5, dateStart: new Date("2019-12-09T00:00:00.000Z") };
	const today: DatedEvent = { id: 2, dateStart: new Date("2026-09-10T00:00:00.000Z") };
	const future: DatedEvent = { id: 1, dateStart: new Date("2026-09-15T00:00:00.000Z") };
	const sorted = [future, longRunner, today].sort(compareByWindowRelevance(windowStart));
	assertCheck(
		JSON.stringify(sorted.map((e) => e.id)) === JSON.stringify([2, 5, 1]),
		`ordine atteso [today(2), longRunner(5), future(1)] per id, ottenuto [${sorted.map((e) => e.id).join(",")}]`
	);

	if (failures > 0) {
		console.error(`[eventOrdering.ts] self-check FALLITO: ${failures} asserzioni non superate`);
		process.exit(1);
	}
	console.log("[eventOrdering.ts] self-check OK");
}
