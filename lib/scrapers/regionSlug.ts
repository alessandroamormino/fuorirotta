/**
 * Normalizzazione ISTAT -> slug (Fase 15, SRC-04, Pitfall 1 di 15-RESEARCH.md):
 * unica fonte di verita' per "come si scrive una regione".
 *
 * Prima di questa funzione esistevano TRE vocabolari per la stessa regione,
 * mai riconciliati perche' il codice ha sempre avuto una sola regione
 * ("lombardia"), dove i tre coincidevano per caso:
 *  - `comuni.region_name` (ISTAT, con `/` per le doppie denominazioni, es.
 *    "Trentino-Alto Adige/Südtirol")
 *  - lo slug del registry (`SOURCE_META.region`, `events.region`)
 *  - lo slug URL di SoloSagre (es. "trentino-alto-adige")
 *
 * Questa funzione produce lo slug usato da registry ED events.region; non
 * serve una seconda tabella per lo slug SoloSagre perche' e' costruito
 * applicando la STESSA funzione — se divergesse, sarebbe un bug qui, non
 * un secondo caso da gestire altrove.
 *
 * Il modulo resta puro (nessun import di Prisma/cheerio/HTTP): lo importano
 * anche componenti server (app/[regione]/page.tsx) e — potenzialmente —
 * componenti client, quindi nessuna dipendenza pesante ammessa qui (stesso
 * vincolo di lib/scrapers/sources.ts).
 *
 * Verificato dal vivo (curl 200, 2026-09-17, 15-RESEARCH.md Pattern 1/2):
 * piemonte, veneto, emilia-romagna, puglia, trentino-alto-adige,
 * valle-d-aosta, friuli-venezia-giulia, sicilia, sardegna, toscana, lazio
 * (11 regioni, slug prodotto da questa funzione = slug URL SoloSagre
 * osservato).
 *
 * [ASSUMED] non controllate dal vivo contro SoloSagre in quella sessione,
 * rischio basso perche' nomi ISTAT a una parola senza caratteri speciali
 * (15-RESEARCH.md Assumption A1): abruzzo, basilicata, calabria, campania,
 * liguria, marche, molise, umbria. Lombardia resta lo slug storico gia' in
 * produzione (SOURCE_META esistente), invariato da questa funzione.
 */
export function istatRegionToSlug(regionName: string): string {
  return regionName
    .split('/')[0] // "Trentino-Alto Adige/Südtirol" -> "Trentino-Alto Adige"
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // rimuove diacritici (es. Südtirol, gia' tagliato dallo split sopra, ma valido in generale)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  // "Trentino-Alto Adige" -> "trentino-alto-adige"
  // "Valle d'Aosta/Vallée d'Aoste" -> "valle-d-aosta"
  // "Friuli-Venezia Giulia" -> "friuli-venezia-giulia"
}

/**
 * I 20 `region_name` ISTAT reali, verificati dal vivo il 2026-09-17 con
 * `SELECT DISTINCT region_name FROM comuni ORDER BY region_name` sul
 * Postgres locale (20/20 righe, nessuna sorpresa). Le regioni italiane sono
 * stabili a livello amministrativo (a differenza delle province, vedi
 * Pitfall 4 di 15-RESEARCH.md sulla Sardegna) — un elenco statico e' quindi
 * sicuro, non una scorciatoia rischiosa.
 *
 * Costante letterale e non una query a `comuni` a ogni richiesta: T-15-03
 * (mitigazione DoS su `app/[regione]/page.tsx`) richiede che uno slug
 * sconosciuto esca con `notFound()` SENZA round-trip al database — un
 * confronto contro un Set in memoria, calcolato una sola volta al caricamento
 * del modulo, e' l'unico modo di garantirlo per costruzione.
 */
const ISTAT_REGION_NAMES = [
  'Abruzzo',
  'Basilicata',
  'Calabria',
  'Campania',
  'Emilia-Romagna',
  'Friuli-Venezia Giulia',
  'Lazio',
  'Liguria',
  'Lombardia',
  'Marche',
  'Molise',
  'Piemonte',
  'Puglia',
  'Sardegna',
  'Sicilia',
  'Toscana',
  'Trentino-Alto Adige/Südtirol',
  'Umbria',
  "Valle d'Aosta/Vallée d'Aoste",
  'Veneto'
] as const

/**
 * Slug -> nome di visualizzazione ISTAT, calcolata una sola volta al
 * caricamento del modulo applicando `istatRegionToSlug` a
 * `ISTAT_REGION_NAMES` — l'unica fonte da cui derivare l'insieme chiuso
 * degli slug regione validi (T-15-03).
 */
export const VALID_REGION_SLUGS: ReadonlyMap<string, string> = new Map(
  ISTAT_REGION_NAMES.map((regionName) => [istatRegionToSlug(regionName), regionName])
)
