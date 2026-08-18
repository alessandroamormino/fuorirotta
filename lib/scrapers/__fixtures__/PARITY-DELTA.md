# PARITY-DELTA — differenze dichiarate fra `baseline.json` e `baseline-cheerio.json`

Questo file documenta ogni differenza reale fra il riferimento pre-refactor
(`baseline.json`, catturato in `08-01` dal parser a regex) e il riferimento post-refactor
(`baseline-cheerio.json`, catturato in `08-03` dai parser cheerio). Per decisione esplicita
dell'utente (che ha risolto un contrasto fra gli acceptance criteria letterali del piano
`08-03-PLAN.md`), `baseline.json` **non viene mai rigenerato**: resta la fotografia esatta
di cosa faceva davvero il codice a regex, bug incluso. Il confronto vivo usato da
`scripts/parity.ts --compare` e da `npm run check:parity` punta ora a
`baseline-cheerio.json`.

## Conteggio eventi per sorgente

| Sorgente | `baseline.json` (pre-refactor, regex) | `baseline-cheerio.json` (post-refactor, cheerio) | Variazione |
|---|---|---|---|
| `solosagre` | 1 | 10 | **+9** — bug corretto, vedi sotto |
| `inlombardiaCards` | 9 | 9 | 0 — identico |
| `inlombardiaDetail` | 1 oggetto (dettaglio singolo) | 1 oggetto (dettaglio singolo) | 0 sui campi migrati in `08-03`. Campi aggiunti dopo, in `08-G1`: vedi "Aggiornamento 2026-08-14" più sotto |
| `opendata` | 1054 | 1054 | 0 — identico |

## Quali sorgenti sono cambiate e quali no

- **Cambiata: `solosagre`.** Unica sorgente il cui output differisce fra i due riferimenti.
  La differenza è un bug reale del parser a regex corretto dalla migrazione a cheerio
  (SRC-06), non una variazione di cosa viene scaricato dal sito (la paginazione di
  solosagre.it è materia di `08-05`, fuori dal perimetro di questo piano).
- **Non cambiate: `inlombardiaCards`, `inlombardiaDetail`, `opendata`.** Verificato con un
  confronto deep-equal fra i due file JSON (dopo la normalizzazione simmetrica di
  `scripts/parity.ts`: decodifica entità + collasso spazi): i tre oggetti risultano
  **byte-identici** fra `baseline.json` e `baseline-cheerio.json`. `opendata` non passa
  mai da un parser HTML (è trasformazione di JSON), quindi non era comunque interessato
  dalla migrazione a cheerio; è incluso qui solo per completezza del confronto a quattro
  chiavi che l'harness esegue.

## Causa del cambiamento in `solosagre` (1 → 10)

Il parser a regex preesistente usava:

```js
html.match(/<div class="post"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g)
```

Il match lazy `[\s\S]*?` cerca, dopo l'apertura del **primo** `<div class="post">`, la
**prima occorrenza** di tre tag di chiusura `</div>` consecutivi. Nel markup reale di
`solosagre-page1.html` ogni singolo post si chiude con **un solo** `</div>` (non tre): la
sequenza di tre chiusure consecutive non esiste subito dopo il primo post, quindi il match
si estende molto più in basso nel documento, fino a trovare altrove nella pagina (nella
sidebar) tre `</div>` consecutivi. Risultato: un **solo** "post" gigante viene catturato per
l'intera pagina, e siccome l'estrazione per-campo (titolo, date, ecc.) usa `.match()` senza
flag `/g`, restituisce solo la **prima** occorrenza di ciascun campo — cioè solo i dati del
primo evento reale della pagina. I restanti 9 eventi, pur presenti nel markup, non vengono
mai estratti. Questa scoperta è stata fatta e documentata per la prima volta in
`08-01-SUMMARY.md` durante la cattura di `baseline.json` (comportamento preservato fedelmente
in quel piano, per rispettare D-04: dimostrare parità prima di ogni miglioramento).

Misurato empiricamente: il singolo match del regex copre **~30.000 caratteri** su
**51.738 totali** di `solosagre-page1.html` — quasi il 60% della pagina, includendo
contenuto estraneo ai post (sidebar, footer del blocco) invece di fermarsi al singolo
`<div class="post">` che si apriva.

## Evidenza che 10 è il conteggio corretto

Non un'asserzione: tre riscontri indipendenti sulla fixture reale
(`lib/scrapers/__fixtures__/solosagre-page1.html`).

1. **Occorrenze grezze nel markup:**
   ```
   grep -o 'class="post"' lib/scrapers/__fixtures__/solosagre-page1.html | wc -l   →  10
   grep -o 'itemprop="name"' lib/scrapers/__fixtures__/solosagre-page1.html | wc -l →  10
   ```
   Dieci blocchi `<div class="post" itemscope itemtype="https://schema.org/Event">`,
   ciascuno con esattamente un `<span itemprop="name">` — un titolo per post, nessuna
   duplicazione o annidamento.

2. **I 10 titoli distinti estratti dal parser cheerio** (`baseline-cheerio.json`,
   chiave `solosagre`):
   - Sagra degli Gnocchi a Pognana Lario
   - Chiacchiere e Tortelli
   - Sagra delle Sagre di Barzio
   - Sagra degli Scarpinocc
   - Sagra della Brüsadèla
   - Sagra del Marubino
   - Festa di San Bartolomeo e Sagra dei Gnòch
   - Sagra di San Bartolomeo a Monzambano
   - Beer Festival a San Donato Milanese
   - Sagra del Casoncello a Strozza

   Dieci eventi reali e distinti (comuni, date, URL sorgente tutti diversi tra loro),
   non un artefatto di parsing: ogni titolo corrisponde a un `<div class="post">` reale
   e verificabile leggendo `solosagre-page1.html`.

3. **Prova di non-vacuità del gate meccanico** (D-05, `scripts/registry-parity.test.sh`):
   mutare `itemprop="name"` in `itemprop="title"` sull'intera fixture fa sparire tutti e 10
   i titoli (ogni post viene scartato dal filtro `title && date_start`), portando
   `solosagre` da 10 a 0 voci — il confronto contro `baseline-cheerio.json` lo rileva e
   fallisce come atteso. Analogamente, rinominare `class="post"` in `class="postREMOVED"`
   fa sparire l'anchor degli eventi (0 voci, stesso esito). Entrambe le mutazioni
   dimostrano che il gate è capace di fallire, non solo di passare per costruzione.

## Copertura JSON-LD sulla pagina di dettaglio in-lombardia (gap G-08-1, 2026-08-14)

`lib/scrapers/__fixtures__/inlombardia-detail.html` (congelata in `08-01`) non contiene
alcun blocco `<script type="application/ld+json">`: il ramo JSON-LD di
`parseInLombardiaDetail` non era quindi mai esercitato dall'harness di parità.

Prima di congelare una nuova fixture, verificato **dal vivo** se il ramo è ancora
raggiungibile su in-lombardia.it oggi: due pagine di dettaglio reali, diverse da quella
già congelata, scaricate in sequenza rispettando il Crawl-delay di 10s (D-10, T-08-17,
nessuna rete parallela):

- `https://www.in-lombardia.it/evento/53a-marcia-del-po` (200, 293.802 caratteri)
- `https://www.in-lombardia.it/evento/cremona-summer-festival-4` (200, 309.616 caratteri,
  scaricata 10s dopo la prima)

Nessuna delle due contiene `application/ld+json`. Sommate alla fixture già congelata,
sono **3 pagine di dettaglio reali su 3** senza alcun blocco JSON-LD.

**Conclusione onesta: non è stata congelata una fixture JSON-LD sintetica.** Il campione
(3/3) non prova in senso assoluto che il ramo sia morto su ogni pagina del sito, ma è
un'evidenza concreta, non un'ipotesi, che JSON-LD non è (più) il meccanismo con cui
in-lombardia.it espone i dati strutturati degli eventi — quei dati vivono oggi nelle
sezioni `.c-info-bar` (Task 4). Il ramo JSON-LD resta nel codice (migrato a selettori
cheerio nel Task 2 del gap G-08-1, quindi non più intercettato dal gate
`check:no-regex-parsing`), ma è segnalato qui come **candidato a rimozione futura** — una
decisione che comporta togliere codice morto, non aggiungerne, e che questo gap lascia
esplicitamente aperta invece di decidere unilateralmente.

Le stesse due pagine confermano anche, su dati reali indipendenti dalla fixture
congelata, la struttura usata dal Task 4 per `venueName`/`fullAddress`/immagine:
- `53a-marcia-del-po`: sezione "Dove" con solo `.address-line1` ("Borgoforte di Borgo
  Virgilio (MN)"), nessun `.organization` — venueName correttamente `null`, fullAddress
  valorizzato.
- `cremona-summer-festival-4`: sezione "Dove" con entrambi gli elementi separati
  (`.organization` = "Cremona e Crema", `.address-line1` = "Cremona").
- Entrambe le pagine hanno `.c-hero__image` con `background-image` valorizzato (non un
  tag `<img>`), nessuna con un tag `tel:` in Contatti.

## Aggiornamento 2026-08-14 (gap G-08-1): `inlombardiaDetail` arricchito

Questa sezione documenta la differenza fra `baseline-cheerio.json` **prima** di questo
gap (catturato in `08-03`, solo migrazione a cheerio, zero nuovi campi estratti) e
**dopo** (catturato qui, con l'estrazione allargata dalla decisione utente del test 1 di
`08-UAT.md`: "adotta la strada migliore per leggere più informazioni possibili con lo
scraper"). Le tre chiavi `solosagre`, `inlombardiaCards`, `opendata` sono **byte-identiche**
fra le due catture (confronto deep-equal eseguito su entrambi i JSON prima di
sovrascrivere il file); cambia solo `inlombardiaDetail`.

### Conteggio campi valorizzati (su 1 solo oggetto di dettaglio, fixture congelata)

| Campo | Prima (08-03) | Dopo (G-08-1) | Causa |
|---|---|---|---|
| `description` | 1/1 | 1/1 | invariato |
| `latitude` / `longitude` | 1/1 | 1/1 | invariato |
| `venueName` | 0/1 | 1/1 | nuovo: fallback dalla sezione "Dove" (`.organization`) quando JSON-LD non lo fornisce (oggi sempre, vedi sezione precedente) |
| `fullAddress` | 0/1 | 1/1 | nuovo: fallback dalla sezione "Dove" (`.address-line1`) |
| `phone` | 0/1 (regex a finestra di prossimità, per accidente) | 0/1 (selettore reale sulla sezione "Contatti") | stesso risultato, causa corretta — la pagina non ha davvero un telefono |
| `image` (campo nuovo) | non esisteva | 1/1 | nuovo: `.c-hero__image` (background-image CSS), risolto ad URL assoluto |

### Evidenza che i nuovi valori sono corretti (non un'asserzione)

Estrazione diretta via `parseInLombardiaDetail` sulla fixture reale
(`lib/scrapers/__fixtures__/inlombardia-detail.html`):

```json
{
  "venueName": "Castello Sforzesco",
  "fullAddress": "Piazza Castello, Milano",
  "phone": null,
  "image": "https://www.in-lombardia.it/sites/default/files/styles/hero_full_h/public/evento/images/411044/212066/Castello%20ok.jpeg?itok=p2qLU-zs"
}
```

Riscontro indipendente sul markup grezzo della fixture:
- `.c-info-bar__title` "Dove" → `.organization` = "Castello Sforzesco", `.address-line1` =
  "Piazza Castello, Milano" (elementi separati, non uno split di stringa — verificato con
  `$('.c-info-bar__cell-content').find('.c-info-bar__title')`, gli stessi selettori
  `.organization`/`.address-line1` già usati da `parseInLombardiaCards` per le card in
  lista, non inventati per l'occasione).
- `.c-hero__image` ha attributo `style="background-image: url('/sites/default/files/...
  /Castello%20ok.jpeg?itok=p2qLU-zs')"` — stessa immagine (stesso ID `411044/212066`) già
  vista come thumbnail nella card di lista, a conferma che è davvero la foto dell'evento e
  non un artefatto di estrazione.
- `.c-info-bar__title` "Contatti" contiene solo un link "Sito web" (`https://www.yesmilano
  .it/estatealcastello`), zero occorrenze di `tel:` nell'intera fixture (verificato con
  `grep -o "tel:" ... | wc -l` → 0) — `phone: null` è quindi corretto, non un fallimento
  silenzioso.
- Due pagine di dettaglio live indipendenti (sezione precedente) confermano la stessa
  struttura `.c-info-bar`/`.c-hero__image` su eventi diversi, escludendo che sia un caso
  particolare della sola fixture congelata.

### Conferma di non-regressione

- `solosagre` e `opendata`: confronto deep-equal fra `baseline-cheerio.json` prima e dopo
  questo aggiornamento → **invariati** (nessuna riga diversa in nessuno dei due oggetti).
- `inlombardiaCards`: 9/9 card, **invariato** — questo gap tocca solo
  `parseInLombardiaDetail`, mai `parseInLombardiaCards`.
- `bash scripts/registry-parity.test.sh`: verde, incluse entrambe le prove di
  non-vacuità D-05 (rinominare `itemprop="name"`, rimuovere `class="post"`), ancora capaci
  di far fallire il confronto contro il nuovo riferimento.

## Impatto per le fasi successive

Se questo bug era presente anche in produzione da quando `solosagre.ts` è stato scritto, il
numero di eventi `solosagre` effettivamente salvati nel database potrebbe essere stato
drasticamente inferiore a quanto assunto altrove nel progetto — indipendente dal problema di
paginazione (SRC-03) già noto e trattato in `08-05`. Questo piano (08-03) chiude solo la
migrazione del *parsing*: non applica alcuna scrittura a produzione né esegue uno scrape
reale contro il database (vedi `<database_safety>` nel prompt dell'agente).

## Aggiornamento 2026-08-18 — D-16 (Fase 6)

**Righe modificate e perché.** `lib/scrapers/solosagre.ts:275` (`locationName: locationCity || 'Lombardia'`) e `lib/scrapers/opendata.ts:114` (`locationName: item.comune || 'Lombardia'`) scrivono ora `null` invece del letterale `'Lombardia'`. `'Lombardia'` non è un comune: è un'affermazione falsa in un campo che il resolver territoriale della Fase 6 interpreta come nome di comune da cercare. Con `null`, il backfill distingue `no_input` (la sorgente non ha dato il dato) da `unmatched` (l'abbiamo cercato e non risolto) — due problemi diversi con due rimedi diversi (D-16, `.planning/phases/06-territorial-data-model/06-CONTEXT.md`).

**Esito misurato di `npx tsx scripts/parity.ts --compare` subito dopo la modifica:**

```
OK: output normalizzato identico alla baseline (solosagre, inlombardiaCards, inlombardiaDetail)
OK: opendata — differenza dichiarata sul solo campo "description" (T-08-19): 0/1054 eventi con descrizione modificata dalla normalizzazione
```

Confronto **verde**, exit 0. Delta di parità: **zero**.

**Perché il delta è zero — verificato con un conteggio, non solo assunto.** La superficie che `captureAll()` congela per SoloSagre è `parseSoloSagreHtml(...)`, un parser HTML a monte del mapping a `ScrapeResult` in cui vive la riga modificata: la baseline `solosagre` non esercita mai quel ramo, quindi non poteva cambiare. Per OpenData la superficie catturata **è** `transformOpenDataRecords(...)`, che contiene la riga modificata — qui il delta zero dipende dai dati della fixture, non dalla struttura del test. Conteggio di controllo eseguito sulla fixture congelata (`lib/scrapers/__fixtures__/opendata-response.json`, 1054 record): **0 record** hanno `comune` assente o falsy, quindi **0 record** avrebbero mai preso il ramo di fallback. La spiegazione regge.

**Baseline non ricatturata.** `--capture` non è stato eseguito: il confronto era verde, quindi non c'era nessun cambiamento reale da congelare. Ricatturare una baseline invariata avrebbe sostituito un riferimento verificato con uno nuovo senza motivo (T-06-17).

**Conteggi per sorgente, invariati:**

| Sorgente | Prima di D-16 | Dopo D-16 | Variazione |
|---|---|---|---|
| `solosagre` | 10 | 10 | 0 |
| `inlombardiaCards` | 9 | 9 | 0 |
| `inlombardiaDetail` | 1 oggetto | 1 oggetto | 0 |
| `opendata` | 1054 | 1054 | 0 (0 descrizioni cambiate) |

`npm run check:parity` (`scripts/registry-parity.test.sh`) rieseguito dopo la modifica: verde, incluse le sue prove di non-vacuità.
