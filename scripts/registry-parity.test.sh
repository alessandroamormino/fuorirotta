#!/usr/bin/env bash
# Harness della prova di parità (SRC-05, D-04, D-05). Nessun framework, nessuna fixture
# generata a runtime: le sei fixture, baseline.json e baseline-cheerio.json sono congelate
# e versionate (08-01 Task 1/2, 08-03 Task 3). Questo script:
#   1. verifica che le sei fixture, baseline.json e baseline-cheerio.json esistano e non
#      siano vuoti
#   2. esegue `tsx scripts/parity.ts --compare` sul codice attuale — deve uscire 0
#      contro il riferimento POST-refactor (`baseline-cheerio.json`, cheerio, 08-03)
#   3. prova di non-vacuità (D-05): muta una copia della fixture e verifica che il
#      confronto sappia fallire — un diff che passa sempre non è una prova
#
# `baseline.json` (riferimento PRE-refactor, parser a regex, bug incluso) resta nel repo
# come documentazione storica ma non viene più letto da `scripts/parity.ts`: vedi
# `lib/scrapers/__fixtures__/PARITY-DELTA.md` per il confronto dichiarato fra i due.
#
# Le mutazioni lavorano SEMPRE su copie in mktemp -d, mai sulle fixture versionate.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
fixtures_dir="${repo_root}/lib/scrapers/__fixtures__"

fail() {
  echo "FAIL: $1"
  exit 1
}

tmp_dirs=()
cleanup() {
  for d in "${tmp_dirs[@]:-}"; do
    [[ -n "${d}" && -d "${d}" ]] && rm -rf "${d}"
  done
}
trap cleanup EXIT

# --- 1. Le sei fixture, baseline.json e baseline-cheerio.json esistono e non sono vuoti -

required_files=(
  "solosagre-page1.html"
  "solosagre-page2.html"
  "solosagre-page3.html"
  "inlombardia-list.html"
  "inlombardia-detail.html"
  "opendata-response.json"
  "baseline.json"
  "baseline-cheerio.json"
)
for f in "${required_files[@]}"; do
  path="${fixtures_dir}/${f}"
  [[ -s "${path}" ]] || fail "fixture mancante o vuota: ${path}"
done
echo "ok  tutte le sei fixture, baseline.json e baseline-cheerio.json esistono e non sono vuoti"

# --- 1b. Nessuna credenziale di terzi dentro le fixture ---------------------
#
# Le fixture sono HTML catturato dai siti sorgente, quindi possono contenere
# chiavi altrui: inlombardia-detail.html conteneva la chiave Google Maps di
# in-lombardia.it dentro un <script src>, che il secret scanning di GitHub ha
# segnalato dopo il push del 2026-08-29. Non era una credenziale del progetto
# (qui si usa Mapbox) e le chiavi JS di Google sono pubbliche per costruzione,
# ma ripubblicare quella di un terzo e' scortese e tiene acceso l'alert.
# Sostituita con un segnaposto; il parsing non ne risente (confronta campi
# estratti, non tag script). Questa asserzione impedisce che una ricattura
# futura la reintroduca in silenzio.
if grep -rqE 'AIza[0-9A-Za-z_-]{35}' "${fixtures_dir}"; then
  fail "Una fixture contiene una chiave API Google (AIza...) catturata dal sito sorgente — va sostituita con un segnaposto prima del commit"
fi
echo "ok  nessuna chiave API Google di terzi dentro le fixture"

# --- 2. Il confronto sul codice attuale deve passare ------------------------------------

if ! (cd "${repo_root}" && npx tsx scripts/parity.ts --compare); then
  fail "npx tsx scripts/parity.ts --compare e' uscito diverso da 0 sul codice attuale — la parità con baseline-cheerio.json e' rotta"
fi
echo "ok  npx tsx scripts/parity.ts --compare passa contro le fixture reali"

# --- 2bis. Paginazione SoloSagre (SRC-03, 08-05) -----------------------------------------
# parseSoloSagreTotalPages/mergeSoloSagrePages verificate su fixture, senza rete: il
# dettaglio dei casi è tutto dentro `scripts/parity.ts --pagination` (D-05 per i casi che
# richiedono una fixture mutata, fatta solo in memoria da quello script).

if ! (cd "${repo_root}" && npx tsx scripts/parity.ts --pagination); then
  fail "npx tsx scripts/parity.ts --pagination e' uscito diverso da 0 — la paginazione di SoloSagre e' rotta"
fi
echo "ok  npx tsx scripts/parity.ts --pagination passa (SRC-03)"

# --- 3. Prova di non-vacuità #1 (D-05): itemprop="name" -> itemprop="title" ------------
# Il titolo sparisce da tutti i post estratti da parseSoloSagreHtml (cheerio, 08-03):
# ciascun post viene scartato dal filtro `title && date_start`, portando `solosagre` da
# 10 voci (baseline-cheerio.json) a 0. Il confronto deve segnalarlo.

tmp1="$(mktemp -d)"
tmp_dirs+=("${tmp1}")
cp "${fixtures_dir}/solosagre-page1.html" "${fixtures_dir}/inlombardia-list.html" \
   "${fixtures_dir}/inlombardia-detail.html" "${fixtures_dir}/opendata-response.json" "${tmp1}/"
perl -pi -e 's/itemprop="name"/itemprop="title"/g' "${tmp1}/solosagre-page1.html"

if (cd "${repo_root}" && npx tsx scripts/parity.ts --compare --fixtures-dir "${tmp1}") >/dev/null 2>&1; then
  fail "D-05 prova 1: il confronto non ha rilevato itemprop=\"name\" mancante — gate vacuo"
fi
echo "ok  D-05 prova 1: rinominare itemprop=\"name\" fa fallire il confronto come atteso"

# --- 4. Prova di non-vacuità #2: l'anchor di ogni post (class="post") sparisce ----------
#
# STORIA (08-01 → 08-03): quando questa prova fu scritta in 08-01, il parser a regex non
# referenziava mai `.postList` (cercava solo `<div class="post"` ovunque nel documento),
# quindi mutare il CONTENITORE `.postList` (come chiedeva il testo letterale del piano di
# allora) era un no-op verificato. Da 08-03 in poi, `parseSoloSagreHtml` usa cheerio con
# `$('.postList')` come anchor strutturale vero (D-07, container-vs-item, vedi
# 08-RESEARCH.md Pattern 3): rimuovere `class="post"` (l'anchor dei singoli eventi, non
# del contenitore) fa scomparire tutti gli eventi pur restando l'anchor del contenitore
# presente — esito legittimo "zero eventi", MA comunque una perdita reale rispetto a
# `baseline-cheerio.json` (10 voci attese), quindi il confronto deve comunque fallire.
# Distinta dalla prova 1: qui sparisce l'anchor dei post stessi, non un campo interno.
tmp2="$(mktemp -d)"
tmp_dirs+=("${tmp2}")
cp "${fixtures_dir}/solosagre-page1.html" "${fixtures_dir}/inlombardia-list.html" \
   "${fixtures_dir}/inlombardia-detail.html" "${fixtures_dir}/opendata-response.json" "${tmp2}/"
perl -pi -e 's/class="post"/class="postREMOVED"/g' "${tmp2}/solosagre-page1.html"

if (cd "${repo_root}" && npx tsx scripts/parity.ts --compare --fixtures-dir "${tmp2}") >/dev/null 2>&1; then
  fail "D-05 prova 2: il confronto non ha rilevato la scomparsa dell'anchor class=\"post\" — gate vacuo"
fi
echo "ok  D-05 prova 2: rimuovere l'anchor class=\"post\" fa fallire il confronto come atteso"

echo "PASS: parità di parsing post-refactor contro baseline-cheerio.json (SRC-05), dimostrata capace di fallire (D-05)"
