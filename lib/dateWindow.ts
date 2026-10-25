// Confini "giorno di calendario" in Europe/Rome, condivisi da /api/events e
// /api/categories per il filtro data (bugfix 2026-09-10).
//
// Le colonne date_start/date_end sono `@db.Timestamp(6)` — timestamp SENZA fuso
// (prisma/schema.prisma:23-24). Prisma/pg confrontano sulle CIFRE del Date passato
// come se fossero UTC, ma gli scraper scrivono mezzanotte locale di Roma: un
// parsing ingenuo (`new Date("2026-09-10")`, che JS legge come mezzanotte UTC)
// sbaglia il confronto di 1-2 ore a seconda dell'ora legale.
//
// Misurato sul DB locale (mai dedotto dal nome della colonna, vedi blocking
// anti-pattern #1): evento id 22720 "Parthenope", un solo giorno di calendario,
// e' date_start=2026-09-01 22:00:00 / date_end=2026-09-02 21:59:59.999 — cioe'
// mezzanotte di Roma del 2 settembre (CEST, UTC+2) scritta come cifre UTC del 1
// settembre sera. Filtrare con `new Date("2026-09-02")` (mezzanotte UTC, non di
// Roma) lo avrebbe escluso.

/** Mezzanotte locale Europe/Rome del giorno "YYYY-MM-DD", come istante UTC. */
export function romeMidnightUTC(dateStr: string): Date {
	const [y, m, d] = dateStr.split("-").map(Number);
	// Stima: mezzanotte UTC dello stesso giorno di calendario.
	const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
	// A che ora locale corrisponde questo istante letto a Roma? La differenza da
	// mezzanotte e' l'offset (CET +1 / CEST +2) da correggere.
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Europe/Rome",
		hour12: false,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	})
		.formatToParts(guess)
		.reduce<Record<string, string>>((acc, p) => {
			if (p.type !== "literal") acc[p.type] = p.value;
			return acc;
		}, {});
	const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
	const romeReadAsUTC = Date.UTC(
		Number(parts.year),
		Number(parts.month) - 1,
		Number(parts.day),
		hour,
		Number(parts.minute),
		Number(parts.second),
	);
	const offsetMs = romeReadAsUTC - guess.getTime();
	return new Date(guess.getTime() - offsetMs);
}

/** Giorno di calendario "YYYY-MM-DD" corrente a Roma (non il fuso del server). */
export function todayInRome(): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(
		new Date(),
	);
}

/**
 * Giorno di calendario successivo a "YYYY-MM-DD". Aritmetica pura su
 * Date.UTC, non risente del fuso: serve a costruire il limite superiore
 * SEMIAPERTO (mezzanotte del giorno dopo), cosi' "dal 10 al 10" copre l'intero
 * 10 invece di un istante solo.
 */
export function nextDateStr(dateStr: string): string {
	const [y, m, d] = dateStr.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/**
 * Inizio della finestra "disponibili": mezzanotte di OGGI a Roma.
 */
export function windowStartToday(): Date {
	return romeMidnightUTC(todayInRome());
}

/**
 * Soglie per la FINE di un evento nella finestra che parte da `windowStart`
 * (mezzanotte di Roma del giorno D). Una fine e' "disponibile" quando il suo
 * ultimo giorno secondo lib/eventDays.ts e' >= D. La regola di eventDays: una
 * fine alle 23:59 UTC e' una fine-giornata in formato UTC e vale la sua data
 * UTC; ogni altra fine vale il suo giorno di Roma. Prisma non sa leggere l'ora
 * di una colonna, quindi la regola diventa due intervalli:
 *  - `dateEnd >= floor` (mezzanotte UTC di D): qualunque formato, ultimo giorno >= D;
 *  - `windowStart <= dateEnd < utcEndOfDayStart` (da mezzanotte di Roma a
 *    D-1 23:59 UTC): solo fini in formato Roma che cadono gia' nel giorno D di
 *    Roma (per esempio una fine a mezzanotte di Roma). Le 23:59 UTC di D-1 ne
 *    restano fuori: sono la fine-giornata UTC del giorno prima.
 *
 * Bugfix 2026-10-25: in produzione in-lombardia, solosagre, opendata, puglia ed
 * emilia-romagna chiudono un evento del 24 a 2026-10-24T23:59:59.999Z. Con la
 * sola soglia `dateEnd >= windowStart` (24T22:00Z) quella fine passava e gli
 * eventi di ieri restavano in lista e in mappa per tutto il giorno dopo, col
 * badge "Concluso". Il self-check sotto confronta questa regola con eventDays
 * minuto per minuto intorno alla mezzanotte, nei due fusi dell'anno.
 */
export function endWindow(windowStart: Date): { floor: Date; utcEndOfDayStart: Date } {
	const romeDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(windowStart);
	const floor = new Date(`${romeDay}T00:00:00.000Z`);
	return { floor, utcEndOfDayStart: new Date(floor.getTime() - 60_000) };
}

/** La stessa regola di availableEventsWhere su un istante, per il self-check. */
function endIsAvailable(end: Date, windowStart: Date): boolean {
	const { floor, utcEndOfDayStart } = endWindow(windowStart);
	return end >= floor || (end >= windowStart && end < utcEndOfDayStart);
}

/**
 * Evento DISPONIBILE = in corso o futuro: la fine cade in uno dei due
 * intervalli di endWindow, oppure (senza dateEnd) dateStart >= inizio
 * finestra, scritto come OR esplicito perche' Prisma non ha COALESCE nei
 * filtri e dateEnd e' nullable.
 *
 * L'unica definizione del progetto. Prima del 2026-10-16 ce n'erano due
 * copie (copertura e mappa) e tre pagine — home, regione, provincia — ancora
 * su `dateStart >= oggi`: una mostra gia' cominciata spariva da quelle pagine
 * mentre lista e mappa la mostravano. Ogni superficie che dice "eventi"
 * passa da qui; le copie in SQL (lib/coverage/liveRegions.ts,
 * lib/saved/resolve.ts e i gate follows-feed e territorial-backfill) usano
 * gli stessi due intervalli.
 */
export function availableEventsWhere(windowStart: Date = windowStartToday()) {
	const { floor, utcEndOfDayStart } = endWindow(windowStart);
	return {
		OR: [
			{ dateEnd: { gte: floor } },
			{ dateEnd: { gte: windowStart, lt: utcEndOfDayStart } },
			{ AND: [{ dateEnd: null }, { dateStart: { gte: windowStart } }] },
		],
	};
}

// ---------------------------------------------------------------------------
// Self-check: `npx tsx lib/dateWindow.ts`
//
// L'aritmetica di fuso sbaglia in silenzio — nessun tipo, nessun lint e nessun
// gate di questo repository vede uno scivolamento di un'ora. E sbaglia per META'
// ANNO: settembre e' CEST (+2), gennaio e' CET (+1). Il bug corretto il
// 2026-09-10 (una ricerca "dal 10 al 10" che non tornava nulla) tornerebbe
// identico, ma solo d'inverno, se questa funzione perdesse la consapevolezza del
// fuso e diventasse un offset fisso.
//
// Le due asserzioni che smascherano un offset fisso sono quelle sui giorni di
// cambio ora: a Roma il giorno in cui entra l'ora legale dura 23 ore e quello in
// cui esce ne dura 25. Un +2 costante le farebbe fallire entrambe.
// La guardia e' quella di lib/pagination.ts:58, nata dal commit 82255eb: un
// `require.main === module` nudo esplode con "module is not defined" appena il
// modulo finisce in un bundle client, e in questa fase e' gia' costato una home
// morta nel browser con tsc, build e curl TUTTI verdi. Oggi dateWindow.ts e'
// importato solo da due route server (/api/events, /api/categories), ma la
// guardia costa nulla e vale per il giorno in cui qualcuno lo importera' da un
// componente client.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- solo nel self-check, mai nel bundle
	const { eventDays } = require("./eventDays") as typeof import("./eventDays");
	let failures = 0;
	const assertCheck = (cond: boolean, msg: string) => {
		if (!cond) {
			console.error(`  FAIL: ${msg}`);
			failures++;
		}
	};
	const iso = (d: Date) => d.toISOString();

	// Ancora misurata sul DB locale, non dedotta: evento 22720 "Parthenope",
	// un solo giorno di calendario, date_start = 2026-09-01 22:00.
	assertCheck(
		iso(romeMidnightUTC("2026-09-02")) === "2026-09-01T22:00:00.000Z",
		`ancora reale (evento 22720): 2026-09-02 a Roma deve valere 2026-09-01T22:00Z, non ${iso(romeMidnightUTC("2026-09-02"))}`
	);

	// Estate CEST (+2) e inverno CET (+1): l'offset NON e' costante.
	assertCheck(
		iso(romeMidnightUTC("2026-09-10")) === "2026-09-09T22:00:00.000Z",
		`estate: 2026-09-10 deve valere 2026-09-09T22:00Z, non ${iso(romeMidnightUTC("2026-09-10"))}`
	);
	assertCheck(
		iso(romeMidnightUTC("2026-01-10")) === "2026-01-09T23:00:00.000Z",
		`inverno: 2026-01-10 deve valere 2026-01-09T23:00Z, non ${iso(romeMidnightUTC("2026-01-10"))}`
	);

	// Giorni di cambio ora 2026 a Roma: entra il 29 marzo, esce il 25 ottobre.
	// A mezzanotte il cambio non e' ancora avvenuto (scatta alle 02:00/03:00
	// locali), quindi la mezzanotte porta ancora l'offset del giorno prima.
	assertCheck(
		iso(romeMidnightUTC("2026-03-29")) === "2026-03-28T23:00:00.000Z",
		`ingresso ora legale: mezzanotte del 29/03 e' ancora CET, deve valere 2026-03-28T23:00Z, non ${iso(romeMidnightUTC("2026-03-29"))}`
	);
	assertCheck(
		iso(romeMidnightUTC("2026-10-25")) === "2026-10-24T22:00:00.000Z",
		`uscita ora legale: mezzanotte del 25/10 e' ancora CEST, deve valere 2026-10-24T22:00Z, non ${iso(romeMidnightUTC("2026-10-25"))}`
	);

	// LE DUE CHE CONTANO: la finestra semiaperta di un giorno normale dura 24h,
	// ma 23h quando entra l'ora legale e 25h quando esce. Un offset fisso le
	// romperebbe entrambe.
	const dayLengthH = (dateStr: string) =>
		(romeMidnightUTC(nextDateStr(dateStr)).getTime() - romeMidnightUTC(dateStr).getTime()) / 3_600_000;
	assertCheck(dayLengthH("2026-09-10") === 24, `giorno normale: 24h attese, ${dayLengthH("2026-09-10")} ottenute`);
	assertCheck(dayLengthH("2026-03-29") === 23, `giorno di ingresso ora legale: 23h attese, ${dayLengthH("2026-03-29")} ottenute`);
	assertCheck(dayLengthH("2026-10-25") === 25, `giorno di uscita ora legale: 25h attese, ${dayLengthH("2026-10-25")} ottenute`);

	// La finestra e' sempre non vuota e ordinata: "dal X al X" copre un giorno
	// intero, mai un istante — il difetto originale.
	for (const d of ["2026-01-01", "2026-03-29", "2026-06-15", "2026-10-25", "2026-12-31"]) {
		assertCheck(
			romeMidnightUTC(nextDateStr(d)).getTime() > romeMidnightUTC(d).getTime(),
			`finestra "dal ${d} al ${d}" non deve essere di larghezza zero`
		);
	}

	// nextDateStr: cambio mese, cambio anno, anno bisestile.
	assertCheck(nextDateStr("2026-01-31") === "2026-02-01", `nextDateStr 31/01 -> ${nextDateStr("2026-01-31")}`);
	assertCheck(nextDateStr("2026-12-31") === "2027-01-01", `nextDateStr 31/12 -> ${nextDateStr("2026-12-31")}`);
	assertCheck(nextDateStr("2028-02-28") === "2028-02-29", `bisestile 28/02/2028 -> ${nextDateStr("2028-02-28")}`);
	assertCheck(nextDateStr("2027-02-28") === "2027-03-01", `non bisestile 28/02/2027 -> ${nextDateStr("2027-02-28")}`);

	// endWindow (bugfix 2026-10-25): la regola deve dire la stessa cosa di
	// eventDays. Finestre del 25/10 (CEST a mezzanotte), del 26/10 (CET) e del
	// 10/01; fini minuto per minuto da 4 ore prima a 4 ore dopo la mezzanotte
	// UTC del giorno, piu' i millisecondi .999 dei due formati reali.
	for (const day of ["2026-10-25", "2026-10-26", "2026-01-10", "2026-03-29"]) {
		const ws = romeMidnightUTC(day);
		const base = new Date(`${day}T00:00:00.000Z`).getTime();
		for (let m = -240; m <= 240; m++) {
			for (const ms of [0, 59_999]) {
				const end = new Date(base + m * 60_000 + ms);
				// Inizio lontano: con inizio == fine eventDays alzerebbe la fine all'inizio.
				const want = eventDays(new Date(base - 10 * 86_400_000), end).endDay >= day;
				assertCheck(endIsAvailable(end, ws) === want, `finestra ${day}, fine ${iso(end)}: eventDays dice ${want ? "dentro" : "fuori"}`);
			}
		}
	}
	// I casi che hanno morso: fine UTC del 24 (il bug) e fine a mezzanotte di
	// Roma del 25 (formato Roma, osservazione di review WR-01).
	const ws25 = romeMidnightUTC("2026-10-25");
	assertCheck(!endIsAvailable(new Date("2026-10-24T23:59:59.999Z"), ws25), "fine UTC del 24 deve restare fuori il 25");
	assertCheck(endIsAvailable(new Date("2026-10-24T22:00:00.000Z"), ws25), "fine a mezzanotte di Roma del 25 deve restare dentro il 25");

	// todayInRome ha la forma attesa ed e' un giorno reale.
	const today = todayInRome();
	assertCheck(/^\d{4}-\d{2}-\d{2}$/.test(today), `todayInRome deve essere YYYY-MM-DD, e' "${today}"`);
	assertCheck(!Number.isNaN(romeMidnightUTC(today).getTime()), `todayInRome ("${today}") deve essere convertibile`);

	if (failures > 0) {
		console.error(`[dateWindow.ts] self-check FALLITO: ${failures} asserzioni non superate`);
		process.exit(1);
	}
	console.log("[dateWindow.ts] self-check OK");
}
