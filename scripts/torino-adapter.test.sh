#!/usr/bin/env bash
# Gate dell'adattatore Comune di Torino.
# Tutto sulla fixture salvata (100 record reali, 2026-09-19), mai sulla rete.
# Nessun apostrofo dentro i blocchi npx tsx -e: chiuderebbe la stringa shell.
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

failures=()
fail() { failures+=("$1"); echo "FAIL: $1"; }
ok() { echo "ok  $1"; }

[[ -f lib/scrapers/__fixtures__/torino-events.json ]] || { echo "FAIL: fixture assente"; exit 1; }

# --- S1: self-check dell'adattatore -----------------------------------------
if npx tsx lib/scrapers/torino.ts > /tmp/torino-selfcheck.log 2>&1; then
  ok "S1: self-check verde ($(grep -c '^ok ' /tmp/torino-selfcheck.log) asserzioni)"
else
  fail "S1: self-check rosso — $(grep '^not ok' /tmp/torino-selfcheck.log | head -2 | tr '\n' ' ')"
fi

# --- S2: nessuna regex su HTML ----------------------------------------------
# Il progetto vieta il parsing di markup con espressioni regolari
# (check:no-regex-parsing copre solosagre e inlombardia). Questo adattatore
# legge HTML dentro un campo JSON: la stessa regola vale, e qui e' verificata.
if grep -nE '\.(match(All)?|exec)\(/[^/]*(<|class=)|=\s*/[^/]*(<|class=)' lib/scrapers/torino.ts >/dev/null; then
  fail "S2: lib/scrapers/torino.ts analizza HTML con una regex — si usa cheerio"
else
  ok "S2: nessuna regex applicata al markup, il parsing passa da cheerio"
fi

# --- S3: volume, sede, categorie --------------------------------------------
out="$(npx tsx -e '
import { readFileSync } from "fs"
import { transformTorinoRecords } from "./lib/scrapers/torino"
const fx = JSON.parse(readFileSync("lib/scrapers/__fixtures__/torino-events.json","utf-8"))
const ev = transformTorinoRecords(fx, { dateFrom: "2026-09-19" })
const sede = ev.filter(e => e.locationName && e.address).length
const cat = ev.filter(e => e.category !== null).length
const sporca = ev.filter(e => e.locationName && e.address && e.locationName.includes(e.address)).length
console.log(JSON.stringify({ tot: ev.length, sede, cat, sporca }))
' 2>&1 | grep -E '^\{' | tail -1)"

if [[ -z "${out}" ]]; then
  fail "S3: la trasformazione non ha prodotto output JSON"
else
  g() { node -e "console.log(String(JSON.parse(process.argv[1])['$1']))" "${out}"; }
  tot="$(g tot)"; sede="$(g sede)"; cat_n="$(g cat)"; sporca="$(g sporca)"

  if [[ "${tot}" -ge 30 ]]; then
    ok "S3: ${tot} eventi futuri dalla fixture di 100 record"
  else
    fail "S3: solo ${tot} eventi estratti dalla fixture — il parsing di .entry-date e regredito"
  fi

  if [[ "${sporca}" == "0" ]]; then
    ok "S3: nessun nome di sede ingloba il proprio indirizzo (.entry-address rimossa dal nodo)"
  else
    fail "S3: ${sporca} sedi contengono anche l indirizzo — .entry-address non viene piu rimossa da .entry-location"
  fi

  soglia_sede=$(( tot * 50 / 100 ))
  if [[ "${sede}" -ge "${soglia_sede}" ]]; then
    ok "S3: ${sede}/${tot} eventi con sede e indirizzo (soglia 50%)"
  else
    fail "S3: solo ${sede}/${tot} con sede+indirizzo, sotto il 50%"
  fi

  soglia_cat=$(( tot * 90 / 100 ))
  if [[ "${cat_n}" -ge "${soglia_cat}" ]]; then
    ok "S3: ${cat_n}/${tot} eventi categorizzati (soglia 90%)"
  else
    fail "S3: solo ${cat_n}/${tot} categorizzati, sotto il 90%"
  fi
fi

# --- S4: il tetto esiste ED e' abbastanza ampio ------------------------------
# La sorgente dichiara ~6.750 elementi ma i futuri sono poche decine: senza
# tetto un errore di arresto scaricherebbe l archivio ogni notte.
#
# 2026-09-21: non basta piu' che il tetto ESISTA. Da quando per_page e' sceso a
# 20 (la sorgente va in HTTP 500 sulle risposte grandi) un tetto espresso in
# pagine varrebbe un quinto della portata di prima, e l adattatore si
# fermerebbe dentro il buco misurato perdendo la coda dei futuri — in
# silenzio. Qui si verifica la PORTATA in pubblicazioni, non la presenza di
# una costante. Il 1200 e' scritto a mano: leggerlo dal modulo lo renderebbe
# vero per costruzione.
reach="$(npx tsx -e '
import { TORINO_MAX_PAGES, TORINO_PER_PAGE } from "./lib/scrapers/torino"
console.log(String(TORINO_MAX_PAGES * TORINO_PER_PAGE))
' 2>&1 | grep -E '^[0-9]+$' | tail -1)"

if [[ -z "${reach}" ]]; then
  fail "S4: impossibile leggere la portata da lib/scrapers/torino.ts"
elif [[ "${reach}" -ge 1200 ]]; then
  ok "S4: portata di ${reach} pubblicazioni (soglia 1200)"
else
  fail "S4: portata di sole ${reach} pubblicazioni, sotto le 1200 misurate come necessarie — la coda dei futuri verrebbe persa"
fi

echo ""
if [[ ${#failures[@]} -eq 0 ]]; then
  echo "PASS: gate adattatore Torino (S1 self-check, S2 niente regex su HTML, S3 dati, S4 tetto pagine)"
  exit 0
else
  echo "FAIL: gate adattatore Torino — ${#failures[@]} sezione/i rossa/e"
  exit 1
fi
