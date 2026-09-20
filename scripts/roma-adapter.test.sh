#!/usr/bin/env bash
# Gate dell'adattatore Comune di Roma.
# Tutto sulle fixture salvate (pagina lista + una scheda multi-sede, reali,
# 2026-09-20), mai sulla rete.
# Nessun apostrofo dentro i blocchi npx tsx -e: chiuderebbe la stringa shell.
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

failures=()
fail() { failures+=("$1"); echo "FAIL: $1"; }
ok() { echo "ok  $1"; }

[[ -f lib/scrapers/__fixtures__/roma-events.html ]] || { echo "FAIL: fixture lista assente"; exit 1; }
[[ -f lib/scrapers/__fixtures__/roma-detail.html ]] || { echo "FAIL: fixture scheda assente"; exit 1; }

# --- S1: self-check dell'adattatore -----------------------------------------
if npx tsx lib/scrapers/roma.ts > /tmp/roma-selfcheck.log 2>&1; then
  ok "S1: self-check verde ($(grep -c '^ok ' /tmp/roma-selfcheck.log) asserzioni)"
else
  fail "S1: self-check rosso — $(grep '^not ok' /tmp/roma-selfcheck.log | head -2 | tr '\n' ' ')"
fi

# --- S2: nessuna regex su HTML ----------------------------------------------
# Il progetto vieta il parsing di markup con espressioni regolari
# (check:no-regex-parsing copre solosagre e inlombardia). Questo adattatore
# legge JavaScript inline dentro una pagina HTML: il markup passa da cheerio,
# le regex vedono solo il testo dello script.
if grep -nE '\.(match(All)?|exec)\(/[^/]*(<|class=)|=\s*/[^/]*(<|class=)' lib/scrapers/roma.ts >/dev/null; then
  fail "S2: lib/scrapers/roma.ts analizza HTML con una regex — si usa cheerio"
else
  ok "S2: nessuna regex applicata al markup, il parsing passa da cheerio"
fi

# --- S3: volume, indirizzi, coordinate, multi-sede --------------------------
out="$(npx tsx -e '
import { readFileSync } from "fs"
import { parseRomaCalendar, transformRomaRecords, parseRomaDetail, applyRomaDetail } from "./lib/scrapers/roma"
const lista = readFileSync("lib/scrapers/__fixtures__/roma-events.html", "utf-8")
const scheda = readFileSync("lib/scrapers/__fixtures__/roma-detail.html", "utf-8")
const ev = transformRomaRecords(parseRomaCalendar(lista), { dateFrom: "2026-09-20" })
const ind = ev.filter(e => e.address).length
const cat = ev.filter(e => e.category !== null).length
const sporchi = ev.filter(e => e.address && e.title.includes(e.address)).length
const det = parseRomaDetail(scheda)
const sedi = ev.filter(e => e.sourceUrl && e.sourceUrl.indexOf("operacamion") >= 0)
const uniti = sedi.map(e => applyRomaDetail(e, det))
const punti = new Set(uniti.map(e => e.latitude + "," + e.longitude)).size
const senzaPunto = uniti.filter(e => e.latitude === null).length
console.log(JSON.stringify({ tot: ev.length, ind, cat, sporchi, marker: det.markers.length, sedi: sedi.length, punti, senzaPunto }))
' 2>&1 | grep -E '^\{' | tail -1)"

if [[ -z "${out}" ]]; then
  fail "S3: la trasformazione non ha prodotto output JSON"
else
  g() { node -e "console.log(String(JSON.parse(process.argv[1])['$1']))" "${out}"; }
  tot="$(g tot)"; ind="$(g ind)"; cat_n="$(g cat)"; sporchi="$(g sporchi)"
  marker="$(g marker)"; sedi="$(g sedi)"; punti="$(g punti)"; senza="$(g senzaPunto)"

  if [[ "${tot}" -ge 30 ]]; then
    ok "S3: ${tot} eventi futuri dal calendario inline della pagina lista"
  else
    fail "S3: solo ${tot} eventi estratti — la lettura di var events e regredita"
  fi

  if [[ "${sporchi}" == "0" ]]; then
    ok "S3: nessun titolo si porta appresso il proprio indirizzo"
  else
    fail "S3: ${sporchi} titoli contengono ancora l indirizzo — il taglio sul doppio spazio non funziona"
  fi

  soglia_ind=$(( tot * 90 / 100 ))
  if [[ "${ind}" -ge "${soglia_ind}" ]]; then
    ok "S3: ${ind}/${tot} eventi con indirizzo (soglia 90%)"
  else
    fail "S3: solo ${ind}/${tot} con indirizzo, sotto il 90%"
  fi

  # Soglia bassa di proposito: qui la scheda non e' ancora stata letta, quindi
  # la categoria puo' venire solo dal ripiego sul titolo. Le categorie vere
  # (i group dei marker) entrano con applyRomaDetail — sull ingest reale del
  # 2026-09-20 portavano la copertura da 21/37 a 37/37.
  soglia_cat=$(( tot * 50 / 100 ))
  if [[ "${cat_n}" -ge "${soglia_cat}" ]]; then
    ok "S3: ${cat_n}/${tot} categorizzati dal solo titolo, prima della scheda (soglia 50%)"
  else
    fail "S3: solo ${cat_n}/${tot} categorizzati dal titolo, sotto il 50%"
  fi

  if [[ "${marker}" -ge 5 ]]; then
    ok "S3: ${marker} marker letti dalla scheda multi-sede"
  else
    fail "S3: solo ${marker} marker dalla scheda — le coordinate non si leggono piu"
  fi

  # La trappola del multi-sede: una scheda sola, sei luoghi. Senza aggancio
  # per indirizzo tutti gli eventi finirebbero sullo stesso punto della mappa.
  if [[ "${senza}" == "0" && "${punti}" == "${sedi}" ]]; then
    ok "S3: ${sedi} sedi della stessa scheda, ${punti} coordinate distinte"
  else
    fail "S3: ${sedi} sedi ma ${punti} coordinate distinte (${senza} senza punto) — l aggancio per indirizzo e rotto"
  fi
fi

# --- S4: il tetto di schede esiste ------------------------------------------
# Se la sorgente cambiasse filtro e il calendario portasse l archivio, senza
# tetto si scaricherebbero migliaia di pagine in una notte.
if grep -qE 'ROMA_MAX_DETAIL_PAGES = [0-9]+' lib/scrapers/roma.ts; then
  ok "S4: esiste un tetto di schede ($(grep -oE 'ROMA_MAX_DETAIL_PAGES = [0-9]+' lib/scrapers/roma.ts | head -1))"
else
  fail "S4: nessun tetto di schede di dettaglio"
fi

# --- S5: il dettaglio saltato non cancella dati -----------------------------
# Un evento il cui dettaglio non viene scaricato DEVE portare detailSkipped,
# altrimenti saveEvents azzera descrizione e coordinate gia' salvate.
if grep -q 'detailSkipped: true' lib/scrapers/roma.ts; then
  ok "S5: gli eventi con dettaglio saltato sono marcati detailSkipped"
else
  fail "S5: nessun detailSkipped — un refresh incrementale cancellerebbe descrizioni e coordinate"
fi

echo ""
if [[ ${#failures[@]} -eq 0 ]]; then
  echo "PASS: gate adattatore Roma (S1 self-check, S2 niente regex su HTML, S3 dati, S4 tetto schede, S5 dettaglio saltato)"
  exit 0
else
  echo "FAIL: gate adattatore Roma — ${#failures[@]} sezione/i rossa/e"
  exit 1
fi
