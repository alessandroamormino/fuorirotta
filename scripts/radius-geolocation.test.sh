#!/usr/bin/env bash
# Gate del filtro per distanza e della posizione utente (segnalazione UAT
# mobile 2026-09-19: "da Erba, raggio 20 km, compaiono eventi di Brescia").
#
# La causa non era la formula della distanza ne' la precisione del GPS, ed e'
# questo il motivo per cui un gate serve: il difetto era una CORSA, e una
# corsa non si vede rileggendo la funzione che sembra colpevole.
#
#   /api/events applica il filtro solo dentro `if (lat && lng && radius)`.
#   app/HomeClient.tsx pero' spediva i tre parametri solo quando
#   `userLocation` era gia' noto — e con un getCurrentPosition senza timeout,
#   al primo caricamento e a OGNI ritorno dal dettaglio (dove HomeClient si
#   rimonta e userLocation riparte da null mentre il raggio viene
#   ripristinato da sessionStorage) i tre parametri cadevano INSIEME.
#   Il server rispondeva con l'intera regione, la pillola continuava a dire
#   "20 km", e appena la posizione arrivava le card si etichettavano da sole
#   con "62 km" dentro una ricerca da 20.
#
# Tre sezioni, nessun dev server, nessun database: due sulla sorgente, una
# sulla formula.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

failures=()
fail() { failures+=("$1"); echo "FAIL: $1"; }
ok() { echo "ok  $1"; }

home_client="app/HomeClient.tsx"
api_route="app/api/events/route.ts"
for f in "${home_client}" "${api_route}" lib/territorial/distance.ts; do
  [[ -f "${f}" ]] || { echo "FAIL: file atteso assente: ${f}"; exit 1; }
done

# --- S1: la forma che perdeva il raggio non puo' tornare ---------------------
#
# `} else if (userLocation) {` era l'intero difetto: nessun ramo per "raggio
# chiesto, posizione assente", quindi quel caso finiva nel nulla insieme al
# filtro. Il gate cerca la FORMA, non il nome della variabile: `userLocation`
# resta legittimo ovunque altro nel file.
if grep -nE '\}[[:space:]]*else[[:space:]]+if[[:space:]]*\([[:space:]]*userLocation[[:space:]]*\)' "${home_client}" >/dev/null; then
  fail "S1: ${home_client} e' tornato a 'else if (userLocation)' — quel ramo lascia cadere lat/lng/radius insieme quando la posizione non c'e' ancora, e la ricerca per raggio gira sull'intera regione"
else
  ok "S1: nessun ramo 'else if (userLocation)' — il caso 'raggio chiesto, posizione assente' ha un percorso proprio"
fi

# Il percorso proprio deve esistere davvero, non essere solo assente il
# vecchio: la ricerca per raggio attende il fix prima di partire.
if grep -nE 'filters\.radius[[:space:]]*\?[[:space:]]*await requestUserLocation\(\)' "${home_client}" >/dev/null; then
  ok "S1: una ricerca per raggio senza posizione attende requestUserLocation() invece di partire senza filtro"
else
  fail "S1: ${home_client} non attende piu' la posizione prima di una ricerca per raggio — il filtro tornerebbe a cadere in silenzio"
fi

# E quando la posizione davvero non arriva, lo stato lo DICHIARA: una lista
# non filtrata presentata come "entro N km" e' il difetto, non il rimedio.
if grep -q 'radiusUnfiltered' "${home_client}"; then
  ok "S1: esiste lo stato che dichiara 'risultati non filtrati per distanza'"
else
  fail "S1: ${home_client} non dichiara piu' il caso 'raggio chiesto ma non applicato' — l'intera regione tornerebbe a passare per 'quello che c'e' entro N km'"
fi

# --- S2: getCurrentPosition con un timeout finito ----------------------------
#
# Senza opzioni il default e' timeout infinito: la finestra in cui S1 mordeva
# non si chiudeva mai da sola. Il gate pretende che le opzioni ci siano e che
# il timeout sia un numero finito, non che valga un valore preciso.
geo_timeout="$(grep -oE 'timeout:[[:space:]]*[0-9_]+' "${home_client}" | head -1 | grep -oE '[0-9_]+' | tr -d '_' || true)"
if [[ -n "${geo_timeout}" ]] && [[ "${geo_timeout}" -gt 0 ]] && [[ "${geo_timeout}" -le 30000 ]]; then
  ok "S2: getCurrentPosition ha un timeout finito (${geo_timeout}ms), non l'attesa infinita del default"
else
  fail "S2: ${home_client} non passa un timeout finito a getCurrentPosition — senza, 'raggio chiesto, posizione non ancora arrivata' resta uno stato senza uscita"
fi

# --- S3: il predicato del server e' quello giusto, e lo dimostra sul caso ----
#
# Erba -> Brescia e' il caso della segnalazione. Se la distanza calcolata
# fosse davvero <= 20 km il difetto sarebbe nella formula, non nei parametri:
# questa sezione e' cio' che ha escluso quell'ipotesi, e resta qui perche' la
# escluda ancora se qualcuno tocca haversine.
s3_output="$(npx tsx -e '
import { calculateDistanceKm } from "./lib/territorial/distance"
// Centri comunali, fonte ISTAT/OSM, arrotondati a 4 decimali.
const erba = { lat: 45.8103, lng: 9.2244 }
const brescia = { lat: 45.5416, lng: 10.2118 }
const d = calculateDistanceKm(erba.lat, erba.lng, brescia.lat, brescia.lng)
// String(...) e mai il numero nudo: console.log colora i numeri con codici
// ANSI quando FORCE_COLOR e impostata, anche senza un TTY, e il regex a
// valle fallirebbe su un valore corretto (difetto gia incontrato in 19-01).
// Nessun apostrofo in questo blocco: e dentro una stringa shell fra apici
// singoli, e un apostrofo la chiuderebbe a meta.
console.log(JSON.stringify({ km: Math.round(d) }))
' 2>&1)"

s3_km="$(node -e "const d=JSON.parse(process.argv[1]); console.log(String(d.km))" "${s3_output}" 2>/dev/null || true)"
if [[ ! "${s3_km}" =~ ^[0-9]+$ ]]; then
  fail "S3: impossibile misurare Erba->Brescia — ${s3_output}"
elif [[ "${s3_km}" -gt 20 ]]; then
  ok "S3: Erba->Brescia = ${s3_km} km, fuori da un raggio di 20 km — il predicato 'distance <= radiusKm' di ${api_route} escluderebbe l'evento SE i parametri gli arrivassero (che e' il punto di S1)"
else
  fail "S3: Erba->Brescia misura ${s3_km} km, dentro i 20 — allora il difetto sarebbe nella formula haversine, non nei parametri: rileggere lib/territorial/distance.ts prima di toccare altro"
fi

# Il predicato del server esiste ancora nella forma su cui S3 ragiona.
if grep -nE 'return distance <= radiusKm' "${api_route}" >/dev/null; then
  ok "S3: ${api_route} filtra ancora con 'distance <= radiusKm'"
else
  fail "S3: ${api_route} non contiene piu' 'return distance <= radiusKm' — il ragionamento di questa sezione non descrive piu' il codice"
fi

echo ""
if [[ ${#failures[@]} -eq 0 ]]; then
  echo "PASS: gate raggio + geolocalizzazione (S1 parametri, S2 timeout, S3 formula)"
  exit 0
else
  echo "FAIL: gate raggio + geolocalizzazione — ${#failures[@]} sezione/i rossa/e"
  exit 1
fi
