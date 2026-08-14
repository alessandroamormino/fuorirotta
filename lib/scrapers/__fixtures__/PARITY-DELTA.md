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
| `inlombardiaDetail` | 1 oggetto (dettaglio singolo) | 1 oggetto (dettaglio singolo) | 0 — identico |
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

## Impatto per le fasi successive

Se questo bug era presente anche in produzione da quando `solosagre.ts` è stato scritto, il
numero di eventi `solosagre` effettivamente salvati nel database potrebbe essere stato
drasticamente inferiore a quanto assunto altrove nel progetto — indipendente dal problema di
paginazione (SRC-03) già noto e trattato in `08-05`. Questo piano (08-03) chiude solo la
migrazione del *parsing*: non applica alcuna scrittura a produzione né esegue uno scrape
reale contro il database (vedi `<database_safety>` nel prompt dell'agente).
