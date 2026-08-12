#!/usr/bin/env bash
# Harness della prova di parità pre-refactor (SRC-05, D-04, D-05). Nessun framework,
# nessuna fixture generata a runtime: le sei fixture e baseline.json sono congelate e
# versionate (08-01, Task 1/2). Questo script:
#   1. verifica che le sei fixture e baseline.json esistano e non siano vuoti
#   2. esegue `tsx scripts/parity.ts --compare` sul codice attuale — deve uscire 0
#   3. prova di non-vacuità (D-05): muta una copia della fixture e verifica che il
#      confronto sappia fallire — un diff che passa sempre non è una prova
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

# --- 1. Le sei fixture e baseline.json esistono e non sono vuoti -----------------------

required_files=(
  "solosagre-page1.html"
  "solosagre-page2.html"
  "solosagre-page3.html"
  "inlombardia-list.html"
  "inlombardia-detail.html"
  "opendata-response.json"
  "baseline.json"
)
for f in "${required_files[@]}"; do
  path="${fixtures_dir}/${f}"
  [[ -s "${path}" ]] || fail "fixture mancante o vuota: ${path}"
done
echo "ok  tutte le sei fixture e baseline.json esistono e non sono vuoti"

# --- 2. Il confronto sul codice attuale deve passare ------------------------------------

if ! (cd "${repo_root}" && npx tsx scripts/parity.ts --compare); then
  fail "npx tsx scripts/parity.ts --compare e' uscito diverso da 0 sul codice attuale — la parità con baseline.json e' rotta"
fi
echo "ok  npx tsx scripts/parity.ts --compare passa contro le fixture reali"

# --- 3. Prova di non-vacuità #1 (D-05): itemprop="name" -> itemprop="title" ------------
# Il titolo sparisce dall'unico post che il parser a regex estrae oggi dalla pagina 1
# (parseSoloSagreHtml scarta un post senza titolo): il confronto deve segnalarlo.

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
# DEVIAZIONE DOCUMENTATA dal testo letterale del piano (Task 2C punto 4, che chiede di
# rimuovere l'attributo di classe del CONTENITORE .postList): verificato empiricamente
# che il parser a regex di oggi (parseSoloSagreHtml) non referenzia mai `.postList` — la
# sua regex cerca solo `<div class="post"` ovunque nel documento, indipendentemente da
# qualunque contenitore. Rimuovere la classe di .postList e' quindi un no-op sotto il
# parser attuale (verificato: il confronto risulta identico, non fallisce). Questa e'
# esattamente la fixture-anchor che D-07/SRC-06 introdurra' in 08-03 con cheerio
# (container = $('.postList'), vedi 08-RESEARCH.md Pattern 3) — non esiste ancora oggi.
# La seconda prova di non-vacuità qui rinomina invece l'anchor che il parser DI OGGI usa
# davvero (class="post"), dimostrando che il confronto sa comunque rilevare una perdita
# strutturale reale, distinta dalla prova 1 (che muta un campo dentro un post, non
# l'anchor del post stesso).
tmp2="$(mktemp -d)"
tmp_dirs+=("${tmp2}")
cp "${fixtures_dir}/solosagre-page1.html" "${fixtures_dir}/inlombardia-list.html" \
   "${fixtures_dir}/inlombardia-detail.html" "${fixtures_dir}/opendata-response.json" "${tmp2}/"
perl -pi -e 's/class="post"/class="postREMOVED"/g' "${tmp2}/solosagre-page1.html"

if (cd "${repo_root}" && npx tsx scripts/parity.ts --compare --fixtures-dir "${tmp2}") >/dev/null 2>&1; then
  fail "D-05 prova 2: il confronto non ha rilevato la scomparsa dell'anchor class=\"post\" — gate vacuo"
fi
echo "ok  D-05 prova 2: rimuovere l'anchor class=\"post\" fa fallire il confronto come atteso"

echo "PASS: parità di parsing pre-refactor (SRC-05), dimostrata capace di fallire (D-05)"
