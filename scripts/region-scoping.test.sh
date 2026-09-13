#!/usr/bin/env bash
# Gate SCHED-01 (D-01/D-02/D-03/D-04): contratto HTTP 400/404/401 di
# /api/cron/scrape?region=, filtro per regione, raggruppamento per host,
# stabilita' dell'ordine di getRegions(). Nessun framework.
#
# S1/S2 sono unita' pure (nessun server, nessuna rete). S3/S4/S5 usano un dev
# server Next effimero con Postgres locale (D-17, scripts/dev-db.sh), stesso
# idioma di scripts/comuni-search.test.sh (NEXT_TEST_DIST_DIR, wait_for_port).
# S6 e' un'asserzione di sorgente (grep), nessun server richiesto. S7 (non-
# regressione di app/api/scrape/route.ts) e' aggiunta dal Task 2 di 14-01.
#
# Il gate non esercita MAI il ramo 202 della route: quel ramo farebbe partire
# uno scrape reale verso la rete (in-lombardia.it costa >=53 minuti misurati,
# 08-05-SUMMARY.md). Solo i rami 400/404/401 sono esercitati qui.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
port="${REGION_SCOPING_TEST_PORT:-39894}"
secret="region-scoping-test-secret"
test_dist_dir=".next-region-scoping-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

tmp_dir="$(mktemp -d)"
server_pid=""

fail() {
  echo "FAIL: $1"
  exit 1
}

wait_for_port() {
  local target_port="$1"
  local attempts=0
  while ! (exec 3<>"/dev/tcp/127.0.0.1/${target_port}") 2>/dev/null; do
    exec 3>&- 2>/dev/null || true
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 150 ]]; then
      fail "porta ${target_port} non ha risposto entro il timeout"
    fi
    sleep 0.1
  done
  exec 3>&- 2>/dev/null || true
}

stop_server() {
  if [[ -n "${server_pid}" ]]; then
    # `next dev` spawna processi figli non sempre raggiungibili da un semplice
    # kill sul pid del comando: pkill -P prova a fermare l'albero, lsof sulla
    # porta e' la rete di sicurezza se un figlio e' sopravvissuto comunque.
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
    lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

cleanup() {
  stop_server
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

# --- S1: unita' pure — getSourcesByRegion / getRegions -----------------------
s1_output="$(npx tsx -e '
(async () => {
  const m = await import("./lib/scrapers/runner")
  const lomb = m.getSourcesByRegion("lombardia").map((e) => e.id)
  if (lomb.join(",") !== "solosagre,opendata_lombardia,in-lombardia") {
    throw new Error("getSourcesByRegion(\"lombardia\") = " + lomb.join(","))
  }
  const molise = m.getSourcesByRegion("molise")
  if (molise.length !== 0) {
    throw new Error("getSourcesByRegion(\"molise\") non vuoto: " + molise.length)
  }
  const regions = m.getRegions()
  if (JSON.stringify(regions) !== JSON.stringify(["lombardia"])) {
    throw new Error("getRegions() = " + JSON.stringify(regions))
  }
})().catch((err) => { console.error("FAIL: " + err.message); process.exit(1) })
' 2>&1)" && s1_code=0 || s1_code=$?
if [[ "${s1_code}" -ne 0 ]]; then
  fail "S1 (getSourcesByRegion/getRegions): ${s1_output}"
fi
echo "S1 OK: getSourcesByRegion filtra per regione, getRegions() = ['lombardia'] senza duplicati"

# --- S2: unita' pura — groupSourcesByHost ------------------------------------
s2_output="$(npx tsx -e '
(async () => {
  const m = await import("./lib/scrapers/runner")
  const { SOURCE_REGISTRY } = await import("./lib/scrapers/registry")

  const synthetic = [
    { id: "a", url: "https://host-a.example/x" },
    { id: "b", url: "https://host-a.example/y" },
    { id: "c", url: "https://host-b.example/z" }
  ]
  const grouped = m.groupSourcesByHost(synthetic)
  if (grouped.length !== 2) {
    throw new Error("atteso 2 gruppi su hostname sintetici, ottenuto " + grouped.length)
  }
  if (grouped[0].length !== 2 || grouped[1].length !== 1) {
    throw new Error("dimensione gruppi inattesa: " + grouped.map((g) => g.length).join(","))
  }

  const real = m.groupSourcesByHost(SOURCE_REGISTRY)
  if (real.length !== 3) {
    throw new Error("registry reale lombardo atteso 3 gruppi (host distinti), ottenuto " + real.length)
  }
})().catch((err) => { console.error("FAIL: " + err.message); process.exit(1) })
' 2>&1)" && s2_code=0 || s2_code=$?
if [[ "${s2_code}" -ne 0 ]]; then
  fail "S2 (groupSourcesByHost): ${s2_output}"
fi
echo "S2 OK: due entry sullo stesso host in un solo gruppo, host diversi in gruppi separati; registry reale = 3 gruppi"

# --- Dev server effimero per S3/S4/S5, Postgres locale reale (D-17) ---------
export CRON_SECRET="${secret}"
bash scripts/dev-db.sh npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# --- S3: region assente -> 400, nessuno scrape avviato -----------------------
resp3="${tmp_dir}/resp3.json"
http_code3="$(curl -s -o "${resp3}" -w '%{http_code}' --max-time 15 -X POST \
  -H "Authorization: Bearer ${secret}" \
  "http://127.0.0.1:${port}/api/cron/scrape")"
[[ "${http_code3}" == "400" ]] || fail "S3: atteso 400 senza region, ottenuto ${http_code3} (body: $(cat "${resp3}" 2>/dev/null))"
echo "S3 OK: POST /api/cron/scrape autenticata senza 'region' risponde 400"

# --- S4: region sconosciuta -> 404 con elenco regioni note -------------------
resp4="${tmp_dir}/resp4.json"
http_code4="$(curl -s -o "${resp4}" -w '%{http_code}' --max-time 15 -X POST \
  -H "Authorization: Bearer ${secret}" \
  "http://127.0.0.1:${port}/api/cron/scrape?region=molise")"
[[ "${http_code4}" == "404" ]] || fail "S4: atteso 404 con region=molise, ottenuto ${http_code4} (body: $(cat "${resp4}" 2>/dev/null))"
node -e "
  const body = require('${resp4}');
  if (!Array.isArray(body.availableRegions) || !body.availableRegions.includes('lombardia')) {
    throw new Error('availableRegions non contiene lombardia: ' + JSON.stringify(body));
  }
" || fail "S4: il corpo del 404 non elenca le regioni note (D-03)"
echo "S4 OK: POST /api/cron/scrape?region=molise (sconosciuta) risponde 404 con l'elenco delle regioni note"

# --- S5: nessuna Authorization -> 401 PRIMA della validazione di region -----
# Non-regressione Fase 5: l'autenticazione precede la validazione della
# regione. Se l'ordine si invertisse, una richiesta senza credenziali ma con
# region valida risponderebbe 202 (avviando uno scrape reale) invece di 401.
resp5="${tmp_dir}/resp5.json"
http_code5="$(curl -s -o "${resp5}" -w '%{http_code}' --max-time 15 -X POST \
  "http://127.0.0.1:${port}/api/cron/scrape?region=lombardia")"
[[ "${http_code5}" == "401" ]] || fail "S5: atteso 401 senza Authorization (region=lombardia valida), ottenuto ${http_code5} (body: $(cat "${resp5}" 2>/dev/null))"
echo "S5 OK: POST /api/cron/scrape?region=lombardia senza Authorization risponde 401 (auth precede la validazione di region)"

stop_server

# --- S6: asserzione di sorgente — nessun file sotto app/ importa il barrel --
# runAllScrapers non e' piu' riesportata dal barrel lib/scrapers/index.ts, e
# app/api/cron/scrape/route.ts non la nomina piu' (usa runRegion). Non
# controlliamo app/api/events/route.ts: quel chiamante (refresh da traffico,
# D-08) resta esplicitamente aperto fino a 14-05 (vedi 14-01-SUMMARY.md e
# 14-02-PLAN.md riga 229-230) — importa direttamente da './runner', mai dal
# barrel, quindi il barrel resta comunque chiuso.
if grep -n "runAllScrapers" lib/scrapers/index.ts | grep -vE '^\s*[0-9]+:\s*//' >/dev/null; then
  fail "S6: lib/scrapers/index.ts nomina ancora runAllScrapers fuori da un commento"
fi
if grep -n "runAllScrapers" app/api/cron/scrape/route.ts | grep -vE '^\s*[0-9]+:\s*//' >/dev/null; then
  fail "S6: app/api/cron/scrape/route.ts nomina ancora runAllScrapers fuori da un commento"
fi
echo "S6 OK: il barrel lib/scrapers/index.ts non riesporta runAllScrapers, app/api/cron/scrape/route.ts usa runRegion"

echo "PASS: contratto di scoping per regione (SCHED-01, D-01/D-02/D-03/D-04)"
exit 0
