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
  // Fase 15 (15-05-PLAN.md, SoloSagre nazionale): "molise" NON e piu un
  // esempio valido di regione assente dal registry — con SoloSagre
  // generalizzato a tutte e venti le regioni ISTAT, molise ha ora una sua
  // entry. Questa asserzione era congelata a "molise" da quando SoloSagre
  // copriva solo la Lombardia: un identificativo che non e (e non sara mai)
  // una regione ISTAT reale e il modo corretto di provare "regione assente
  // dal registry" adesso che tutte e venti sono coperte.
  const unknown = m.getSourcesByRegion("__test_unknown_region__")
  if (unknown.length !== 0) {
    throw new Error("getSourcesByRegion(\"__test_unknown_region__\") non vuoto: " + unknown.length)
  }
  // Fase 15 (15-05-PLAN.md): SoloSagre generalizzato aggiunge le altre 17
  // regioni ISTAT (oltre a lombardia/emilia-romagna/puglia, gia dichiarate
  // da 15-03) in coda, nellordine di dichiarazione di SOURCE_META (D-04).
  // Questa asserzione era congelata a ["lombardia","emilia-romagna","puglia"]
  // da quando SoloSagre copriva solo la Lombardia: ora segue lordine reale
  // del registry con tutte e venti le regioni, non un ricordo.
  const regions = m.getRegions()
  const expectedRegions = [
    "lombardia", "emilia-romagna", "puglia",
    "abruzzo", "basilicata", "calabria", "campania",
    "friuli-venezia-giulia", "lazio", "liguria", "marche", "molise",
    "piemonte", "sardegna", "sicilia", "toscana", "trentino-alto-adige",
    "umbria", "valle-d-aosta", "veneto"
  ]
  if (JSON.stringify(regions) !== JSON.stringify(expectedRegions)) {
    throw new Error("getRegions() = " + JSON.stringify(regions))
  }
})().catch((err) => { console.error("FAIL: " + err.message); process.exit(1) })
' 2>&1)" && s1_code=0 || s1_code=$?
if [[ "${s1_code}" -ne 0 ]]; then
  fail "S1 (getSourcesByRegion/getRegions): ${s1_output}"
fi
echo "S1 OK: getSourcesByRegion filtra per regione, getRegions() = le 20 regioni ISTAT nell'ordine di SOURCE_META, senza duplicati"

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

  // Fase 15 (15-03-PLAN.md): emilia-romagna e puglia aggiungono due host
  // propri (emiliaromagnaturismo.it, osservatorio.dms.puglia.it), distinti
  // dai tre host lombardi: 5 gruppi. Fase 19 (19-01, Alto Adige): un sesto
  // host proprio, tourism.api.opendatahub.com, distinto da tutti i
  // precedenti — 6 gruppi adesso, non piu 5. Questa asserzione segue il
  // numero reale di host distinti dichiarati in SOURCE_META, aggiornata ad
  // ogni sorgente nuova che porta un host proprio.
  const real = m.groupSourcesByHost(SOURCE_REGISTRY)
  if (real.length !== 6) {
    throw new Error("registry reale atteso 6 gruppi (host distinti), ottenuto " + real.length)
  }
})().catch((err) => { console.error("FAIL: " + err.message); process.exit(1) })
' 2>&1)" && s2_code=0 || s2_code=$?
if [[ "${s2_code}" -ne 0 ]]; then
  fail "S2 (groupSourcesByHost): ${s2_output}"
fi
echo "S2 OK: due entry sullo stesso host in un solo gruppo, host diversi in gruppi separati; registry reale = 6 gruppi"

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
# Fase 15 (15-05-PLAN.md): "molise" e ora una regione reale nel registry
# (SoloSagre nazionale) — __test_unknown_region__ e il modo corretto di
# provare "regione sconosciuta" adesso che tutte e venti le regioni ISTAT
# sono coperte.
resp4="${tmp_dir}/resp4.json"
http_code4="$(curl -s -o "${resp4}" -w '%{http_code}' --max-time 15 -X POST \
  -H "Authorization: Bearer ${secret}" \
  "http://127.0.0.1:${port}/api/cron/scrape?region=__test_unknown_region__")"
[[ "${http_code4}" == "404" ]] || fail "S4: atteso 404 con region=__test_unknown_region__, ottenuto ${http_code4} (body: $(cat "${resp4}" 2>/dev/null))"
node -e "
  const body = require('${resp4}');
  if (!Array.isArray(body.availableRegions) || !body.availableRegions.includes('lombardia')) {
    throw new Error('availableRegions non contiene lombardia: ' + JSON.stringify(body));
  }
" || fail "S4: il corpo del 404 non elenca le regioni note (D-03)"
echo "S4 OK: POST /api/cron/scrape?region=__test_unknown_region__ (sconosciuta) risponde 404 con l'elenco delle regioni note"

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

# --- S6: asserzione di sorgente — runAllScrapers non esiste piu' -----------
# runAllScrapers cancellata da lib/scrapers/runner.ts in 14-05 (D-08): il suo
# ultimo chiamante (app/api/events/route.ts, refresh da traffico) e' stato
# migrato a runRegion, chiudendo l'esenzione che questa sezione documentava
# fino a 14-01/14-03. Nessuna eccezione residua: un grep pulito su tutto il
# repository (esclusi i commenti) non deve trovarla piu' da nessuna parte.
if grep -rn "runAllScrapers" lib/ app/ scripts/ --include='*.ts' 2>/dev/null | grep -vE ':[0-9]+:\s*(//|\*)' >/dev/null; then
  fail "S6: runAllScrapers nominata ancora fuori da un commento (attesa cancellata da 14-05)"
fi
echo "S6 OK: runAllScrapers non esiste piu' in nessun file .ts del repository"

# --- S7: non-regressione — l'endpoint di scrape pubblico e' cancellato ------
# T-14-01: app/api/scrape/route.ts avviava lo scrape completo di tutte le
# sorgenti senza alcuna autenticazione. Il Task 2 di 14-01 lo ha cancellato;
# questa sezione impedisce che ricompaia, sia come file sia come nuovo import
# sotto app/. `grep -v '^\s*//'` ignora i commenti (es. questo stesso file
# cita "api/scrape/route.ts" sopra) cosi' una citazione non rende il gate
# auto-invalidante. Dalla 14-05 nessuna eccezione residua (vedi S6): un
# import di runAllScrapers sotto app/ sarebbe di per se' impossibile, la
# funzione non esiste piu'.
if [[ -e "${repo_root}/app/api/scrape/route.ts" ]]; then
  fail "S7: app/api/scrape/route.ts esiste ancora (T-14-01 non chiusa)"
fi
s7_hits="$(cd "${repo_root}" && grep -rn "runAllScrapers" app/ 2>/dev/null \
  | grep -vE ':[0-9]+:\s*//' || true)"
if [[ -n "${s7_hits}" ]]; then
  fail "S7: un file sotto app/ importa ancora runAllScrapers fuori da un commento: ${s7_hits}"
fi
echo "S7 OK: app/api/scrape/route.ts non esiste, nessun import di runAllScrapers sotto app/"

# --- S8: lock occupato -> 409, nessuno scrape avviato (SCHED-03, D-13) ------
# Riavvia il dev server (S3..S5 lo hanno fermato sopra): e' l'unico modo
# sicuro di esercitare il ramo 409 con una regione reale senza toccare la
# rete — inseriamo a mano una riga region_locks con scadenza futura, cosi'
# acquireRegionLock nella route trova il lock gia' occupato.
psql_dev_s8() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}
if ! docker compose -f "${repo_root}/docker-compose.dev.yml" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "S8: il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi
psql_dev_s8 "DELETE FROM region_locks WHERE region = 'lombardia'" >/dev/null
psql_dev_s8 "INSERT INTO region_locks (region, locked_at, expires_at) VALUES ('lombardia', now(), now() + interval '1 hour')" >/dev/null

bash scripts/dev-db.sh npx next dev -p "${port}" >"${tmp_dir}/dev-server-s8.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"

resp8="${tmp_dir}/resp8.json"
http_code8="$(curl -s -o "${resp8}" -w '%{http_code}' --max-time 15 -X POST \
  -H "Authorization: Bearer ${secret}" \
  "http://127.0.0.1:${port}/api/cron/scrape?region=lombardia")"
[[ "${http_code8}" == "409" ]] || fail "S8: atteso 409 con lock lombardia gia' occupato, ottenuto ${http_code8} (body: $(cat "${resp8}" 2>/dev/null))"

stop_server

remaining="$(psql_dev_s8 "SELECT count(*) FROM region_locks WHERE region = 'lombardia'")"
psql_dev_s8 "DELETE FROM region_locks WHERE region = 'lombardia'" >/dev/null
[[ "${remaining}" == "1" ]] || fail "S8: la riga di lock di prova per lombardia non era piu' presente dopo il 409 (count=${remaining}) — il ramo 409 non deve mai rilasciare un lock che non ha acquisito"
echo "S8 OK: POST /api/cron/scrape?region=lombardia con lock gia' occupato risponde 409, nessuno scrape avviato, riga di prova ripulita"

echo "PASS: contratto di scoping per regione (SCHED-01, D-01/D-02/D-03/D-04) + lock (SCHED-03, D-13)"
exit 0
