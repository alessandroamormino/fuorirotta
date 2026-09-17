#!/usr/bin/env bash
# Gate ROLL-03/ROLL-06 (D-01/D-02/D-04/D-08/D-09/D-11): soglia secca del
# segnale di copertura in entrambe le direzioni, e il contratto HTTP delle
# pagine /[regione] — 200 su una regione viva, 200+noindex su una regione
# ISTAT reale ma non ancora coperta, 404 su uno slug che non corrisponde a
# nessuna regione ISTAT.
#
# Usa uno slug/sorgente di prova dedicati (__test_coverage_region__,
# __test_coverage_source__), mai un dato reale: nessuna riga esistente viene
# toccata, stesso idioma di scripts/region-lock.test.sh. Richiede il
# Postgres locale (scripts/dev-db.sh, D-17) — mai il database di produzione.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

test_region="__test_coverage_region__"
test_source="__test_coverage_source__"
port="${REGION_COVERAGE_TEST_PORT:-39895}"
test_dist_dir=".next-region-coverage-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"
export COVERAGE_TEST_REGION="${test_region}"

tmp_dir="$(mktemp -d)"
server_pid=""

fail() {
  echo "FAIL: $1"
  exit 1
}

psql_dev() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
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
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
    lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

cleanup() {
  stop_server
  psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null 2>&1 || true
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

if ! docker compose -f "${repo_root}/docker-compose.dev.yml" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Stato pulito prima di iniziare, nel caso una run precedente sia rimasta a meta'.
psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null

# --- S1: soglia secca, direzione bassa — 0 eventi futuri per la regione di
# prova (== COVERAGE_THRESHOLD): non e' viva. E' anche la prova che
# getLiveRegions() non solleva eccezioni quando una regione non ha alcuna
# riga: il gruppo per __test_coverage_region__ non esiste affatto nel
# risultato di groupBy, esattamente come su una tabella eventi vuota.
s1_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getLiveRegions } = await import("./lib/coverage/liveRegions")
  const live = await getLiveRegions()
  console.log(live.has(process.env.COVERAGE_TEST_REGION as string) ? "true" : "false")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
[[ "${s1_output}" == "false" ]] || fail "S1: con 0 eventi futuri (== COVERAGE_THRESHOLD) la regione di prova risulta viva: ${s1_output}"
echo "S1 OK: 0 eventi futuri (== COVERAGE_THRESHOLD) -> regione di prova NON viva, nessuna eccezione"

# --- S2: soglia secca, direzione alta — 1 evento futuro canonico
# (== COVERAGE_THRESHOLD + 1): la regione di prova diventa viva.
psql_dev "INSERT INTO events (source, source_id, title, date_start, region, canonical_category) VALUES ('${test_source}', 't1', 'Evento di prova copertura', now() + interval '1 day', '${test_region}', 'Altro')" >/dev/null

s2_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getLiveRegions } = await import("./lib/coverage/liveRegions")
  const live = await getLiveRegions()
  console.log(live.has(process.env.COVERAGE_TEST_REGION as string) ? "true" : "false")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
[[ "${s2_output}" == "true" ]] || fail "S2: con 1 evento futuro (== COVERAGE_THRESHOLD + 1) la regione di prova NON risulta viva: ${s2_output}"
echo "S2 OK: 1 evento futuro (== COVERAGE_THRESHOLD + 1) -> regione di prova viva"

psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null

# --- Dev server effimero per S3/S4/S5, Postgres locale reale (D-17) --------
bash scripts/dev-db.sh npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# --- S3: /lombardia (regione viva, dati reali) -> 200 -----------------------
resp3="${tmp_dir}/resp3.html"
http_code3="$(curl -s -o "${resp3}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/lombardia")"
[[ "${http_code3}" == "200" ]] || fail "S3: atteso 200 su /lombardia, ottenuto ${http_code3}"
echo "S3 OK: GET /lombardia (regione viva) risponde 200"

# --- S4: /zzz-non-esiste (slug non ISTAT) -> 404 ----------------------------
http_code4="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/zzz-non-esiste")"
[[ "${http_code4}" == "404" ]] || fail "S4: atteso 404 su /zzz-non-esiste, ottenuto ${http_code4}"
echo "S4 OK: GET /zzz-non-esiste (slug non ISTAT) risponde 404"

# --- S5: /molise (regione ISTAT reale, oggi senza eventi) -> 200 + noindex --
# D-11: mai 404, mai redirect per una regione reale non ancora coperta.
resp5="${tmp_dir}/resp5.html"
http_code5="$(curl -s -o "${resp5}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/molise")"
[[ "${http_code5}" == "200" ]] || fail "S5: atteso 200 su /molise (regione reale, non coperta), ottenuto ${http_code5}"
grep -qi "noindex" "${resp5}" || fail "S5: /molise risponde 200 ma il corpo non contiene 'noindex'"
echo "S5 OK: GET /molise (regione ISTAT reale, non coperta) risponde 200 con noindex"

stop_server

echo "PASS: segnale di copertura (ROLL-03) + pagine /[regione] (ROLL-06) — S1..S5 verdi"
exit 0
