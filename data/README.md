# Dataset territoriali (Fase 6)

Provenienza, licenza e data di scarico di ogni file sotto `data/`, scritto
**prima** che i dati entrassero nel repository (checkpoint bloccante del
Task 1 di `06-03-PLAN.md`). Nessun dataset con licenza non dichiarata o non
verificabile entra qui — vedi la sezione "Sorgente scartata" in fondo.

## `Elenco-comuni-italiani.xlsx`

- **Cosa contiene:** anagrafica ufficiale dei comuni italiani — codice ISTAT,
  denominazione, provincia, regione, ripartizione geografica.
- **Fonte:** ISTAT — https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.xlsx
  (pagina di riferimento: https://www.istat.it/classificazione/codici-dei-comuni-delle-province-e-delle-regioni/)
- **Licenza:** Creative Commons Attribuzione 4.0 (CC BY 4.0) — dichiarata su
  https://www.istat.it/it/note-legali ("Salvo diversa indicazione, tutti i
  contenuti pubblicati su questo sito sono soggetti alla licenza Creative
  Commons – Attribuzione – versione 4.0."), verificata in questa sessione con
  link diretto a `creativecommons.org/licenses/by/4.0/deed.it`.
- **Data di scarico:** 2026-08-18
- **Rigenerazione:**
  `curl -o data/Elenco-comuni-italiani.xlsx https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.xlsx`
- **Uso:** `npx tsx scripts/seed-comuni.ts --istat data/Elenco-comuni-italiani.xlsx [...]`

## `Variazioni-amministrative-e-territoriali-dei-comuni-Anni-1991-2025.xlsx`

- **Cosa contiene:** **non** un elenco riga-per-riga di variazioni di codice
  (rinomini, fusioni, riassegnazioni provinciali con codice-prima/codice-dopo)
  come assunto in fase di ricerca (RESEARCH.md Assumption A3). Ispezionato con
  `--inspect` in questa sessione: e' una tabella di **statistiche aggregate**
  — conteggi di variazioni per tipologia, regione e periodo (es. "Piemonte:
  17 fusioni, 1 scorporo, ... nel periodo 1991-2025"), su 5 fogli per
  intervallo di anni. Nessun codice ISTAT individuale compare nel file.
- **Fonte:** ISTAT — https://www.istat.it/wp-content/uploads/2024/09/Variazioni-amministrative-e-territoriali-dei-comuni-Anni-1991-2025.xlsx
- **Licenza:** CC BY 4.0 (stessa dichiarazione di cui sopra)
- **Data di scarico:** 2026-08-18
- **Uso:** nessuno — tenuto sotto `data/` solo per trasparenza di cosa e'
  stato ispezionato e scartato. Il flag `--reconcile` di `scripts/seed-comuni.ts`
  **non** legge questo file: legge un CSV a due colonne
  (`istat_code_old,istat_code_new`), perche' questo xlsx non porta il dato
  necessario. Vedi `scripts/__fixtures__/istat-reconciliation-fixture.csv`
  (fixture sintetica, non dati reali) e `06-03-SUMMARY.md` per la decisione
  completa.

## `coordinate-wikidata.csv`

- **Cosa contiene:** `istat_code,latitude,longitude` — punto del centro
  abitato/municipio di ogni comune (D-10), **non** il baricentro del confine
  comunale. Verificato su Milano (`45.466944,9.190000`, area del Duomo) e su
  comuni valtellinesi allungati.
- **Fonte:** Wikidata, query SPARQL sull'endpoint pubblico
  `https://query.wikidata.org/sparql` — entita' con `wdt:P31 wd:Q747074`
  (comune italiano), `wdt:P635` (codice ISTAT), `wdt:P625` (coordinata).
- **Licenza:** CC0 1.0 Universal (dominio pubblico) —
  https://www.wikidata.org/wiki/Wikidata:Licensing
- **Data di scarico:** 2026-08-18
- **Copertura:** 7.835 comuni su 7.894 dell'elenco ISTAT hanno una coordinata
  (59 comuni ne sono privi — dichiarato e riportato in `06-03-SUMMARY.md`,
  mai taciuto ne' inventato).
- **Rigenerazione:** `npx tsx scripts/fetch-wikidata-territorial.ts`
- **Uso:** `npx tsx scripts/seed-comuni.ts --istat <path> --coordinates data/coordinate-wikidata.csv`

## `comuni-aliases.csv`

- **Cosa contiene:** `istat_code,alias` — nomi ufficiali alternativi
  (bilingue/trilingue) per i comuni che ne hanno uno registrato su Wikidata.
  Costruito da `wdt:P1448` (nome ufficiale) e `wdt:P1705` (native label), **non**
  `rdfs:label` (che in tedesco restituisce esonimi come "Mailand" per Milano,
  non nomi statutari). Forme combinate tipo `"Pfalzen / Falzes"` sono state
  divise in due righe. L'alias uguale al nome italiano del comune e' escluso.
- **Fonte:** Wikidata, stesso endpoint SPARQL di cui sopra.
- **Licenza:** CC0 1.0 Universal — https://www.wikidata.org/wiki/Wikidata:Licensing
- **Data di scarico:** 2026-08-18
- **Copertura:** 541 alias per un sottoinsieme dei comuni con P1448/P1705
  registrato (in prevalenza Alto Adige/Südtirol — Bozen, Meran, Brixen,
  Sterzing, Pfalzen, ecc. — nessun dato inventato: un comune senza alias su
  Wikidata resta senza riga in questo file, non riempito a intuito).
- **Rigenerazione:** `npx tsx scripts/fetch-wikidata-territorial.ts`
- **Uso:** `npx tsx scripts/seed-comuni.ts --aliases data/comuni-aliases.csv`

## Sorgente scartata: `opendatasicilia/comuni-italiani`

Repository GitHub candidato per le coordinate del municipio, **scartato** al
checkpoint del Task 1: `LICENSE.md` risponde 404, nessun file di licenza nel
repository, nessuna dichiarazione trovata nel README (1153 byte totali) o
altrove. Per i termini di default di GitHub un repository senza licenza
esplicita e' "tutti i diritti riservati": i suoi dati non sono entrati e non
entreranno in questo repository. Wikidata (CC0) copre lo stesso bisogno con
licenza verificata.
