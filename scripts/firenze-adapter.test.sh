#!/usr/bin/env bash
# Gate dell'adattatore Comune di Firenze.
#
# Tutto sulla fixture salvata in lib/scrapers/__fixtures__/firenze-events.json,
# MAI sulla rete: la sorgente e' una finestra mobile di 30 giorni, quindi
# interrogarla dal vivo renderebbe il gate diverso ogni giorno.
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

failures=()
fail() { failures+=("$1"); echo "FAIL: $1"; }
ok() { echo "ok  $1"; }

fixture="lib/scrapers/__fixtures__/firenze-events.json"
[[ -f "${fixture}" ]] || { echo "FAIL: fixture assente: ${fixture}"; exit 1; }

# --- S1: il self-check dell'adattatore ---------------------------------------
if npx tsx lib/scrapers/firenze.ts > /tmp/firenze-selfcheck.log 2>&1; then
  ok "S1: il self-check di lib/scrapers/firenze.ts e' verde ($(grep -c '^ok ' /tmp/firenze-selfcheck.log) asserzioni)"
else
  fail "S1: self-check rosso — $(grep '^not ok' /tmp/firenze-selfcheck.log | head -2 | tr '\n' ' ')"
fi

# --- S2: soglia di adozione --------------------------------------------------
# Una fonte si adotta se porta volume: sotto questa soglia non vale un
# adattatore da mantenere. 100 e' l'ordine di grandezza dichiarato, non il
# valore osservato arrotondato (stesso criterio di D-02 per l'Alto Adige).
s2="$(npx tsx -e '
import { readFileSync } from "fs"
import { transformFirenzeFeatures } from "./lib/scrapers/firenze"
const fx = JSON.parse(readFileSync("lib/scrapers/__fixtures__/firenze-events.json","utf-8"))
const ev = transformFirenzeFeatures(fx.features, { dateFrom: "2026-09-19" })
const cat = ev.filter(e => e.category !== null).length
const geo = ev.filter(e => e.latitude !== null).length
// String(...) e mai il numero nudo: console.log colora i numeri con ANSI
// quando FORCE_COLOR e impostata, anche senza TTY (difetto gia incontrato: niente apostrofi qui dentro, chiuderebbero la stringa shell).
console.log(JSON.stringify({ tot: ev.length, cat, geo }))
' 2>&1 | grep -E '^\{' | tail -1)"

tot="$(node -e "console.log(String(JSON.parse(process.argv[1]).tot))" "${s2}")"
cat_n="$(node -e "console.log(String(JSON.parse(process.argv[1]).cat))" "${s2}")"
geo_n="$(node -e "console.log(String(JSON.parse(process.argv[1]).geo))" "${s2}")"

if [[ "${tot}" -ge 100 ]]; then
  ok "S2: ${tot} eventi dalla fixture, sopra la soglia di adozione (100)"
else
  fail "S2: solo ${tot} eventi, sotto la soglia di adozione di 100 — la fonte non giustifica un adattatore"
fi

# --- S3: coordinate su tutti -------------------------------------------------
# E' il pregio di questa sorgente rispetto a in-lombardia: nessun geocoding.
# Se un giorno smettesse di portarle, va saputo subito.
if [[ "${geo_n}" == "${tot}" ]]; then
  ok "S3: tutti e ${tot} gli eventi portano coordinate, nessun geocoding necessario"
else
  fail "S3: solo ${geo_n}/${tot} eventi con coordinate — la sorgente ha smesso di fornirle su tutti"
fi

# --- S4: categorizzazione dal titolo ----------------------------------------
soglia=$(( tot * 40 / 100 ))
if [[ "${cat_n}" -ge "${soglia}" ]]; then
  pct=$(node -e "console.log((100*${cat_n}/${tot}).toFixed(1))")
  ok "S4: ${cat_n}/${tot} eventi (${pct}%) categorizzati dal titolo, soglia >= 40%"
else
  fail "S4: solo ${cat_n}/${tot} categorizzati, sotto il 40% — lib/categories/fromTitle.ts e' regredito"
fi

echo ""
if [[ ${#failures[@]} -eq 0 ]]; then
  echo "PASS: gate adattatore Firenze (S1 self-check, S2 adozione, S3 coordinate, S4 categorie)"
  exit 0
else
  echo "FAIL: gate adattatore Firenze — ${#failures[@]} sezione/i rossa/e"
  exit 1
fi
