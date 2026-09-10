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
