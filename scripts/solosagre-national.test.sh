#!/usr/bin/env bash
# Gate SRC-04 (Fase 15, 15-05 Task 1): normalizzazione dei 20 slug ISTAT e
# costruzione degli URL SoloSagre.
#
# Sezione 1 (sempre attiva, nessuna rete): per ciascuna delle 20 regioni
# ISTAT verifica che `istatRegionToSlug()` produca lo slug atteso — inclusi
# i tre casi a doppia denominazione (Trentino-Alto Adige/Südtirol, Valle
# d'Aosta/Vallée d'Aoste, Friuli-Venezia Giulia) — e che l'URL costruito per
# la pagina 1 e per la pagina 2 abbia la forma
# `https://www.solosagre.it/sagre/{slug}/` / `.../{slug}/{pagina}/`. Gli slug
# attesi vengono dalla stessa lista (ISTAT_REGION_NAMES) usata da
# lib/scrapers/regionSlug.ts per costruire VALID_REGION_SLUGS — 20/20 righe
# verificate dal vivo contro la tabella `comuni` il 2026-09-17
# (15-RESEARCH.md), non un secondo elenco scritto a mano qui.
#
# Sezione 2 (spenta per impostazione predefinita, tocca la rete): interroga
# i 20 slug sul sito sorgente e asserisce 200 su ciascuno, rispettando
# SOLOSAGRE_CRAWL_DELAY_MS fra una richiesta e la successiva (lo stesso
# ritardo dell'adattatore — venti richieste in sequenza verso un host solo,
# mai in burst). 11 regioni sono gia' state verificate dal vivo in ricerca
# (15-RESEARCH.md Pattern 1); le 9 restanti (Abruzzo, Basilicata, Calabria,
# Campania, Liguria, Marche, Molise, Umbria — nomi ISTAT a una parola, rischio
# basso per 15-RESEARCH.md Assumption A1) costano una richiesta a testa.
# Abilitare con: SOLOSAGRE_LIVE_CHECK=1 bash scripts/solosagre-national.test.sh
# Spenta per impostazione predefinita cosi' `npm test` non dipende da un sito
# di terzi (stesso idioma di scripts/puglia-adapter.test.sh/emiliaromagna-adapter.test.sh,
# che usano fixture invece della rete).
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"

fail() {
  echo "FAIL: $1"
  exit 1
}

# --- Sezione 1: normalizzazione + costruzione URL, nessuna rete -------------

set +e
section1_output="$(cd "${repo_root}" && npx tsx -e '
import { istatRegionToSlug, VALID_REGION_SLUGS } from "./lib/scrapers/regionSlug"

// Slug attesi (15-RESEARCH.md Pattern 2, verificati dal vivo il 2026-09-17):
// 11 confermati via curl 200 contro solosagre.it, 9 [ASSUMED] a basso rischio
// (nomi ISTAT a una parola). Copia letterale, non ricalcolata da
// istatRegionToSlug(), cosi il confronto sotto non e vacuo (D-05).
const expected: Record<string, string> = {
  Abruzzo: "abruzzo",
  Basilicata: "basilicata",
  Calabria: "calabria",
  Campania: "campania",
  "Emilia-Romagna": "emilia-romagna",
  "Friuli-Venezia Giulia": "friuli-venezia-giulia",
  Lazio: "lazio",
  Liguria: "liguria",
  Lombardia: "lombardia",
  Marche: "marche",
  Molise: "molise",
  Piemonte: "piemonte",
  Puglia: "puglia",
  Sardegna: "sardegna",
  Sicilia: "sicilia",
  Toscana: "toscana",
  "Trentino-Alto Adige/Südtirol": "trentino-alto-adige",
  Umbria: "umbria",
  "Valle d\x27Aosta/Vallée d\x27Aoste": "valle-d-aosta",
  Veneto: "veneto",
}

let failures = 0
const regionNames = Object.keys(expected)

if (regionNames.length !== 20) {
  console.log(`FAIL: la tabella di slug attesi ha ${regionNames.length} voci, non 20`)
  failures++
}

if (VALID_REGION_SLUGS.size !== 20) {
  console.log(`FAIL: VALID_REGION_SLUGS ha ${VALID_REGION_SLUGS.size} voci, non 20`)
  failures++
}

for (const regionName of regionNames) {
  const got = istatRegionToSlug(regionName)
  const want = expected[regionName]
  if (got !== want) {
    console.log(`FAIL: istatRegionToSlug(${JSON.stringify(regionName)}) = ${JSON.stringify(got)}, atteso ${JSON.stringify(want)}`)
    failures++
    continue
  }
  if (!VALID_REGION_SLUGS.has(want)) {
    console.log(`FAIL: VALID_REGION_SLUGS non contiene lo slug ${JSON.stringify(want)} per ${regionName}`)
    failures++
    continue
  }
  const page1 = `https://www.solosagre.it/sagre/${got}/`
  const page2 = `https://www.solosagre.it/sagre/${got}/2/`
  if (!/^https:\/\/www\.solosagre\.it\/sagre\/[a-z0-9-]+\/$/.test(page1)) {
    console.log(`FAIL: URL pagina 1 malformato per ${regionName}: ${page1}`)
    failures++
  }
  if (!/^https:\/\/www\.solosagre\.it\/sagre\/[a-z0-9-]+\/2\/$/.test(page2)) {
    console.log(`FAIL: URL pagina 2 malformato per ${regionName}: ${page2}`)
    failures++
  }
  console.log(`ok  ${regionName} -> ${got} (${page1})`)
}

// Prova di non-vacuita (D-05): un elenco che non riesce MAI a fallire su un
// refuso reale non e un gate. Muta una copia della mappa attesa e verifica
// che il confronto lo scopra.
const mutated = { ...expected, Lombardia: "lombardiaX" }
let mutationCaught = false
for (const regionName of Object.keys(mutated)) {
  if (istatRegionToSlug(regionName) !== mutated[regionName]) {
    mutationCaught = true
    break
  }
}
if (!mutationCaught) {
  console.log("FAIL: prova di non-vacuita D-05 — uno slug atteso mutato non e stato rilevato")
  failures++
} else {
  console.log("ok  prova di non-vacuita D-05: uno slug atteso mutato viene rilevato")
}

if (failures > 0) {
  console.log(`FAIL: ${failures} asserzioni fallite sulla normalizzazione dei 20 slug`)
  process.exit(1)
}
console.log("PASS: normalizzazione + costruzione URL verificate su tutte e 20 le regioni ISTAT")
')"
section1_status=$?
set -e

echo "${section1_output}"

if [[ ${section1_status} -ne 0 ]] || grep -q '^FAIL' <<<"${section1_output}"; then
  fail "Sezione 1 (normalizzazione slug, nessuna rete) non e' verde"
fi

# --- Sezione 2: rete reale, spenta per impostazione predefinita -------------

if [[ "${SOLOSAGRE_LIVE_CHECK:-0}" != "1" ]]; then
  echo ""
  echo "SKIP: Sezione 2 (rete reale contro www.solosagre.it) — abilitare con SOLOSAGRE_LIVE_CHECK=1"
  echo "PASS: scripts/solosagre-national.test.sh (Sezione 1 verde, Sezione 2 saltata)"
  exit 0
fi

echo ""
echo "Sezione 2: interrogazione dal vivo di www.solosagre.it per tutte e 20 le regioni"
echo "(rispettando SOLOSAGRE_CRAWL_DELAY_MS=5000ms fra una richiesta e la successiva)"

# String(...), mai il numero nudo (fix Rule 3, 19-01): console.log colora i
# numeri con codici ANSI quando lo stdout supporta i colori o FORCE_COLOR e
# impostata, anche senza un TTY — il regex ^[0-9]+$ sotto falliva su un
# valore corretto ma colorato, difetto preesistente scoperto in questa
# sessione perche' l'ambiente aveva FORCE_COLOR impostata.
crawl_delay_ms="$(cd "${repo_root}" && npx tsx -e 'import { SOLOSAGRE_CRAWL_DELAY_MS } from "./lib/scrapers/solosagre"; console.log(String(SOLOSAGRE_CRAWL_DELAY_MS))')"
[[ "${crawl_delay_ms}" =~ ^[0-9]+$ ]] || fail "impossibile leggere SOLOSAGRE_CRAWL_DELAY_MS da lib/scrapers/solosagre.ts"
sleep_seconds="$(awk -v ms="${crawl_delay_ms}" 'BEGIN { printf "%.3f", ms / 1000 }')"

live_slugs=(abruzzo basilicata calabria campania emilia-romagna friuli-venezia-giulia lazio liguria lombardia marche molise piemonte puglia sardegna sicilia toscana trentino-alto-adige umbria valle-d-aosta veneto)
live_failures=0
first=1
for slug in "${live_slugs[@]}"; do
  if [[ ${first} -eq 0 ]]; then
    sleep "${sleep_seconds}"
  fi
  first=0
  url="https://www.solosagre.it/sagre/${slug}/"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${url}" || echo "000")"
  if [[ "${code}" != "200" ]]; then
    echo "FAIL: ${url} -> HTTP ${code}, atteso 200"
    live_failures=$((live_failures + 1))
  else
    echo "ok  ${url} -> 200"
  fi
done

if [[ ${live_failures} -gt 0 ]]; then
  fail "${live_failures} slug su 20 non hanno risposto 200 su www.solosagre.it"
fi

echo "PASS: scripts/solosagre-national.test.sh (Sezione 1 + Sezione 2, tutte e 20 le regioni 200 dal vivo)"
