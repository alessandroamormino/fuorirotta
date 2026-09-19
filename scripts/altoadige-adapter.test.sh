#!/usr/bin/env bash
# Gate dell'adattatore Alto Adige (Fase 19, 19-01 Task 2/3): self-check
# dell'adattatore + soglia di adozione D-01/D-02, tutto sulla fixture salvata
# in lib/scrapers/__fixtures__/altoadige-events.json — MAI sulla rete. La
# sezione S3 (categorizzazione D-11/D-12) e' aggiunta dal Task 3 dello
# stesso piano, non da un file separato: l'idioma del progetto e' un gate
# per AREA, non un file per asserzione.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

failures=()
fail() {
  echo "FAIL: $1"
  failures+=("$1")
}
ok() {
  echo "ok  $1"
}

# --- S1: il self-check dell'adattatore (idioma emiliaromagna-adapter.test.sh) ---
# set +e attorno alla cattura: sotto `set -e` un'assegnazione il cui comando
# fallisce farebbe uscire lo script qui, prima di poter leggere status/output
# e stampare il riepilogo — esattamente il caso RED che questo gate deve
# poter osservare senza abortire.
set +e
s1_output="$(npx tsx lib/scrapers/altoadige.ts 2>&1)"
s1_status=$?
set -e

echo "${s1_output}"

if [[ ${s1_status} -ne 0 ]] || grep -q '^FAIL:' <<<"${s1_output}"; then
  fail "S1: il self-check di lib/scrapers/altoadige.ts non e' verde"
else
  ok "S1: il self-check di lib/scrapers/altoadige.ts e' verde"
fi

# --- S2: soglia di adozione D-01/D-02 -----------------------------------------
#
# La soglia e' l'ordine di grandezza ~100 deciso dall'utente in D-02
# (19-CONTEXT.md), scritta QUI e in nessun altro punto del file. Non e'
# COVERAGE_THRESHOLD di lib/coverage/liveRegions.ts: quella dichiara che una
# regione esiste sulla mappa (soglia ~10), questa che una fonte merita un
# adattatore dedicato. Misurato il 2026-09-19: la fixture porta 151 item e
# TUTTI e 151 producono almeno una riga nella finestra 2026-09-19..2027-12-31
# (nessun item della fixture e' "morto" per questa sorgente) — il margine
# sopra 100 e' ampio apposta, cosi' la caduta del gate segnala una fixture
# svuotata, non una fluttuazione naturale.
ADOPTION_THRESHOLD=100

set +e
s2_output="$(npx tsx -e '
(async () => {
  const fs = await import("fs")
  const m = await import("./lib/scrapers/altoadige")
  const envelope = JSON.parse(fs.readFileSync("lib/scrapers/__fixtures__/altoadige-events.json", "utf-8"))
  const items = envelope.items ?? []
  // Stessa finestra fissata in chiaro del self-check del modulo: mai la data
  // odierna implicita, o il conteggio diventerebbe rosso da solo quando il
  // calendario passa (trappola dichiarata nel piano).
  const params = { dateFrom: "2026-09-19", dateTo: "2027-12-31" }
  let itemsWithRows = 0
  for (const item of items) {
    const rows = m.transformAltoAdigeItems([item], params)
    if (rows.length > 0) itemsWithRows++
  }
  // String(itemsWithRows), mai il numero nudo: console.log colora i numeri
  // con codici ANSI quando lo stdout supporta i colori (o FORCE_COLOR e
  // impostata) anche se non e un TTY, una stringa non viene mai colorata.
  console.log(String(itemsWithRows))
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
s2_status=$?
set -e

if [[ ${s2_status} -ne 0 ]]; then
  fail "S2: impossibile contare gli item con almeno una riga — ${s2_output}"
else
  items_with_rows="${s2_output}"
  if [[ "${items_with_rows}" =~ ^[0-9]+$ ]] && [[ "${items_with_rows}" -ge "${ADOPTION_THRESHOLD}" ]]; then
    ok "S2: ${items_with_rows} item della fixture producono almeno una riga (soglia D-02: ${ADOPTION_THRESHOLD})"
  else
    fail "S2: solo ${items_with_rows} item della fixture producono almeno una riga, sotto la soglia D-02 di ${ADOPTION_THRESHOLD}"
  fi
fi

echo ""
if [[ ${#failures[@]} -eq 0 ]]; then
  echo "PASS: gate adattatore Alto Adige (self-check S1, soglia di adozione D-02 S2)"
  exit 0
else
  echo "FAIL: gate adattatore Alto Adige — ${#failures[@]} sezione/i rossa/e"
  exit 1
fi
