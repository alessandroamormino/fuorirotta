/**
 * Coppie reali di eventi, estratte a mano dal Postgres locale di sviluppo
 * (`fuorirotta_dev`, snapshot 2026-08-21) ed etichettate leggendo i titoli:
 * `merge` se sono lo stesso evento fisico raccontato da due sorgenti diverse,
 * `no_merge` altrimenti (D-11).
 *
 * Nessuna coppia qui e' sintetica: le grafie di in-lombardia, opendata_lombardia
 * e solosagre — maiuscole tutte diverse, numeri di edizione formattati in modo
 * diverso, apostrofi dritti o tipografici — non si inventano a tavolino. Sono
 * proprio queste variazioni reali che tarano e difendono la soglia di
 * similarita' (10-03) e che intercettano le trappole di DEDUP-02: titoli
 * formulaici (es. "Castagnata", "Mercatini di Natale") identici in comuni
 * diversi, che non devono MAI fondersi.
 *
 * `eventId` e' puramente informativo — serve solo a risalire alla riga del
 * database durante una diagnosi. Non va mai usato per interrogare il database:
 * gli id sono autoincrement e differiscono fra l'ambiente locale e produzione
 * (vedi il commento su `comuneId` in lib/types.ts).
 *
 * Il modo corretto di reagire a un falso positivo scoperto in produzione e'
 * aggiungere qui la coppia reale che lo dimostra, mai abbassare la soglia in
 * lib/dedup/config.ts per farla sparire.
 */

export type DedupFixtureRow = {
  eventId: number;
  title: string;
  comuneId: number | null;
  dateStart: string;
  source: string;
};

export type DedupFixturePair = {
  label: string;
  a: DedupFixtureRow;
  b: DedupFixtureRow;
  expected: "merge" | "no_merge";
  why: string;
};

export const DEDUP_FIXTURES: DedupFixturePair[] = [
  // --- Famiglia 1: duplicati certi (titolo normalizzato identico, stesso
  // comune, stessa data, sorgenti diverse). 9 gruppi misurati sul dataset
  // locale al 2026-08-21. -----------------------------------------------------
  {
    label: "energy2run-cancano",
    a: { eventId: 2410, title: "Energy2Run Cancano", comuneId: 1712, dateStart: "2026-08-29", source: "in-lombardia" },
    b: { eventId: 815, title: "ENERGY2RUN CANCANO", comuneId: 1712, dateStart: "2026-08-29", source: "opendata_lombardia" },
    expected: "merge",
    why: "Stesso titolo a meno di maiuscole, stesso comune (1712, Cancano) e stessa data: e' la stessa gara raccontata da due sorgenti.",
  },
  {
    label: "in-bocca-al-luppolo",
    a: { eventId: 2227, title: "In bocca al luppolo", comuneId: 7122, dateStart: "2026-08-20", source: "in-lombardia" },
    b: { eventId: 945, title: "IN BOCCA AL LUPPOLO", comuneId: 7122, dateStart: "2026-08-20", source: "opendata_lombardia" },
    expected: "merge",
    why: "Stesso titolo a meno di maiuscole, stesso comune (7122, Colico) e stessa data: stessa sagra della birra.",
  },
  {
    label: "notte-bianca-delle-emozioni",
    a: { eventId: 2081, title: "Notte Bianca delle Emozioni", comuneId: 1892, dateStart: "2026-09-18", source: "in-lombardia" },
    b: { eventId: 624, title: "NOTTE BIANCA DELLE EMOZIONI", comuneId: 1892, dateStart: "2026-09-18", source: "opendata_lombardia" },
    expected: "merge",
    why: "Stesso titolo a meno di maiuscole, stesso comune e stessa data: stesso evento.",
  },
  {
    label: "sagra-del-gorgonzola-a-lomello",
    a: { eventId: 2415, title: "Sagra del Gorgonzola a Lomello", comuneId: 2372, dateStart: "2026-08-27", source: "in-lombardia" },
    b: { eventId: 1063, title: "Sagra del Gorgonzola a Lomello", comuneId: 2372, dateStart: "2026-08-27", source: "solosagre" },
    expected: "merge",
    why: "Titolo identico carattere per carattere, stesso comune (2372, Lomello) e stessa data: duplicato certo citato nel contesto di fase.",
  },
  {
    label: "sagra-del-luccio-in-salsa",
    a: { eventId: 782, title: "SAGRA DEL LUCCIO IN SALSA", comuneId: 2623, dateStart: "2026-09-03", source: "opendata_lombardia" },
    b: { eventId: 1071, title: "Sagra del Luccio in Salsa", comuneId: 2623, dateStart: "2026-09-03", source: "solosagre" },
    expected: "merge",
    why: "Stesso titolo a meno di maiuscole, stesso comune e stessa data: duplicato certo.",
  },
  {
    label: "sagra-della-brusadela",
    a: { eventId: 2240, title: "Sagra della Brüsadèla", comuneId: 2419, dateStart: "2026-08-22", source: "in-lombardia" },
    b: { eventId: 906, title: "SAGRA DELLA BRUSADELA", comuneId: 2419, dateStart: "2026-08-22", source: "opendata_lombardia" },
    expected: "merge",
    why: "Stesso titolo a meno di accenti e maiuscole (il gruppo ha in realta' tre righe, anche solosagre id 1058), stesso comune e stessa data: il caso di prova canonico di DEDUP-03.",
  },
  {
    label: "sonica-festival-2026",
    a: { eventId: 2327, title: "Sonica festival 2026", comuneId: 7144, dateStart: "2026-08-26", source: "in-lombardia" },
    b: { eventId: 888, title: "SONICA FESTIVAL 2026", comuneId: 7144, dateStart: "2026-08-26", source: "opendata_lombardia" },
    expected: "merge",
    why: "Stesso titolo a meno di maiuscole, stesso comune e stessa data: duplicato certo.",
  },
  {
    label: "trail-grigne-sud",
    a: { eventId: 2801, title: "Trail Grigne sud", comuneId: 7144, dateStart: "2026-09-25", source: "in-lombardia" },
    b: { eventId: 544, title: "TRAIL GRIGNE SUD", comuneId: 7144, dateStart: "2026-09-25", source: "opendata_lombardia" },
    expected: "merge",
    why: "Stesso titolo a meno di maiuscole, stesso comune e stessa data: duplicato certo.",
  },
  {
    label: "valle-dei-segni-wine-trail",
    a: { eventId: 3116, title: "Valle dei Segni Wine Trail", comuneId: 2157, dateStart: "2026-10-22", source: "in-lombardia" },
    b: { eventId: 343, title: "VALLE DEI SEGNI WINE TRAIL", comuneId: 2157, dateStart: "2026-10-22", source: "opendata_lombardia" },
    expected: "merge",
    why: "Stesso titolo a meno di maiuscole, stesso comune e stessa data: duplicato certo.",
  },

  // --- Famiglia 2: trappole di DEDUP-02. Titolo normalizzato identico ma NON
  // lo stesso evento: comuni diversi, oppure stesso comune ma giorno diverso,
  // oppure una delle due righe senza comune (D-07). ---------------------------
  {
    label: "mercatini-di-natale-comuni-diversi",
    a: { eventId: 176, title: "MERCATINI DI NATALE", comuneId: 1392, dateStart: "2026-11-28", source: "opendata_lombardia" },
    b: { eventId: 196, title: "MERCATINI DI NATALE", comuneId: 1698, dateStart: "2026-11-21", source: "opendata_lombardia" },
    expected: "no_merge",
    why: "Titolo formulaico (14 comuni distinti lo usano nel dataset locale): stesso titolo ma comuni diversi (1392 vs 1698) e date diverse. Trappola classica di DEDUP-02.",
  },
  {
    label: "castagnata-comuni-diversi",
    a: { eventId: 407, title: "CASTAGNATA", comuneId: 1439, dateStart: "2026-10-10", source: "opendata_lombardia" },
    b: { eventId: 299, title: "CASTAGNATA", comuneId: 1645, dateStart: "2026-10-30", source: "opendata_lombardia" },
    expected: "no_merge",
    why: "Titolo formulaico (14 comuni distinti): stesso titolo ma comuni diversi (1439 vs 1645). Trappola di DEDUP-02.",
  },
  {
    label: "festa-d-autunno-comuni-diversi",
    a: { eventId: 312, title: "FESTA D'AUTUNNO", comuneId: 2165, dateStart: "2026-10-24", source: "opendata_lombardia" },
    b: { eventId: 381, title: "FESTA D'AUTUNNO", comuneId: 2263, dateStart: "2026-10-16", source: "opendata_lombardia" },
    expected: "no_merge",
    why: "Titolo formulaico (7 comuni distinti): stesso titolo ma comuni diversi (2165 vs 2263). Trappola di DEDUP-02.",
  },
  {
    label: "concerto-di-natale-stesso-comune-giorno-diverso",
    a: { eventId: 51, title: "CONCERTO DI NATALE", comuneId: 2222, dateStart: "2026-12-18", source: "opendata_lombardia" },
    b: { eventId: 44, title: "CONCERTO DI NATALE", comuneId: 2222, dateStart: "2026-12-19", source: "opendata_lombardia" },
    expected: "no_merge",
    why: "Titolo identico e stesso comune (2222), ma giorni diversi (18 e 19 dicembre): due serate distinte, non la stessa occorrenza. D-06 richiede stesso date_start::date, non un intervallo.",
  },
  {
    label: "festa-di-fine-estate-senza-comune",
    a: { eventId: 2638, title: "Festa di fine estate", comuneId: null, dateStart: "2026-09-12", source: "in-lombardia" },
    b: { eventId: 834, title: "FESTA DI FINE ESTATE", comuneId: 1709, dateStart: "2026-08-28", source: "opendata_lombardia" },
    expected: "no_merge",
    why: "Titolo formulaico e una delle due righe non ha comuneId risolto: D-07 impone di non fondere mai in questo caso, a prescindere dalla somiglianza del titolo — senza prossimita' verificabile la condizione congiunta di DEDUP-02 non e' soddisfatta.",
  },

  // --- Famiglia 3: coppie vicine alla soglia. Stesso comune, stesso giorno,
  // sorgenti diverse, titolo diverso: sono queste a tarare la soglia in 10-03.
  {
    label: "val-di-corteno-bike-experience",
    a: { eventId: 676, title: "VAL DI CORTENO BIKE EXPERIENCE", comuneId: 2156, dateStart: "2026-09-11", source: "opendata_lombardia" },
    b: { eventId: 2623, title: "Valdicorteno bike experience", comuneId: 2156, dateStart: "2026-09-11", source: "in-lombardia" },
    expected: "merge",
    why: "Stesso comune (2156, Corteno Golgi) e stesso giorno; il titolo differisce solo per spaziatura del toponimo (\"Val di Corteno\" vs \"Valdicorteno\"): stessa gara ciclistica.",
  },
  {
    label: "mostra-del-bitto",
    a: { eventId: 375, title: "119^ MOSTRA DEL BITTO", comuneId: 1686, dateStart: "2026-10-16", source: "opendata_lombardia" },
    b: { eventId: 3029, title: "Mostra del Bitto 2026", comuneId: 1686, dateStart: "2026-10-16", source: "in-lombardia" },
    expected: "merge",
    why: "Stesso comune (1686, Morbegno) e stesso giorno; una sorgente antepone il numero di edizione, l'altra pospone l'anno: stessa fiera.",
  },
  {
    label: "sagra-del-salame-d-oca-di-mortara",
    a: { eventId: 556, title: "SAGRA DEL SALAME D'OCA DI MORTARA", comuneId: 2394, dateStart: "2026-09-24", source: "opendata_lombardia" },
    b: { eventId: 2862, title: "Sagra del Salame d’Oca e Palio di Mortara", comuneId: 2394, dateStart: "2026-09-24", source: "in-lombardia" },
    expected: "merge",
    why: "Stesso comune (2394, Mortara) e stesso giorno; la seconda sorgente aggiunge \"e Palio\" al nome ufficiale della manifestazione: stesso evento descritto in modo piu' completo.",
  },
  {
    label: "sulzano-street-food-vs-music-festival",
    a: { eventId: 950, title: "SULZANO STREET FOOD FESTIVAL", comuneId: 2276, dateStart: "2026-08-20", source: "opendata_lombardia" },
    b: { eventId: 2242, title: "Sulzano Music Festival", comuneId: 2276, dateStart: "2026-08-20", source: "in-lombardia" },
    expected: "no_merge",
    why: "Stesso comune (2276, Sulzano) e stesso giorno, ma sono due manifestazioni distinte che condividono solo il toponimo nel titolo (street food contro un festival musicale): la coppia che decide la soglia, perche' e' insieme molto simile e realmente distinta.",
  },
  {
    label: "sagra-del-marubino",
    a: { eventId: 956, title: "20^ EDIZIONE SAGRA DEL MARUBINO", comuneId: 2504, dateStart: "2026-08-19", source: "opendata_lombardia" },
    b: { eventId: 3761, title: "20° Sagra del Marubino", comuneId: 2504, dateStart: "2026-08-19", source: "in-lombardia" },
    expected: "merge",
    why: "Stesso comune (2504, Casteldidone) e stesso giorno; stesso numero di edizione (20) scritto in due modi diversi (\"20^ EDIZIONE\" vs \"20°\"): stessa sagra.",
  },
  {
    label: "sagra-dell-offella",
    a: { eventId: 510, title: "SAGRA DELL'OFFELLA", comuneId: 2400, dateStart: "2026-10-01", source: "opendata_lombardia" },
    b: { eventId: 2933, title: "Sagra dell'Offella di Parona 2026", comuneId: 2400, dateStart: "2026-10-01", source: "in-lombardia" },
    expected: "merge",
    why: "Stesso comune (2400, Parona) e stesso giorno; la seconda sorgente specifica il toponimo e l'anno gia' impliciti nella prima: stessa sagra.",
  },
  {
    label: "festa-del-rifugio-scoggione-vs-triathlon",
    a: { eventId: 830, title: "FESTA DEL RIFUGIO SCOGGIONE", comuneId: 7122, dateStart: "2026-08-29", source: "opendata_lombardia" },
    b: { eventId: 2367, title: "5° olympic triathlon Colico 24^ edizione", comuneId: 7122, dateStart: "2026-08-29", source: "in-lombardia" },
    expected: "no_merge",
    why: "Stesso comune (7122, Colico) e stesso giorno ospitano piu' eventi indipendenti quel giorno (una festa di rifugio e una gara di triathlon): titoli senza alcuna somiglianza semantica al di la' della localita' condivisa.",
  },
];
