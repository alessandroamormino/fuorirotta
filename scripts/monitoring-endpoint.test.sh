#!/usr/bin/env bash
# Harness di verifica per MON-01 (GET /api/monitoring) e SRC-08 (computeSourceHealth).
# Nessun framework, nessuna riga scritta in scrape_runs: la logica di baseline/anomalia e'
# verificata su array in memoria (scripts/health-cases.ts, chiamato da qui come primo passo);
# all'HTTP resta la sola verifica di forma e di codice di stato contro un dev server effimero,
# avviato e fermato da questo script (trap cleanup EXIT, come scripts/cron-scrape.test.sh).
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
port="${PORT:-39880}"
broken_port="${BROKEN_DB_PORT:-39881}"

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
    # `next dev` spawna processi figli (worker/compiler) non sempre raggiungibili da un
    # semplice `kill` sul pid del comando: pkill -P prova a fermare l'albero, lsof sulla
    # porta e' la rete di sicurezza se un figlio e' sopravvissuto comunque.
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
  fi
  lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
}

cleanup() {
  stop_server
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

# --- 0. Conteggio scrape_runs prima di iniziare (T-08-12) -----------------------------------
# Sola lettura (SELECT count). Se il container locale non risponde l'harness fallisce qui,
# invece di procedere senza poter verificare l'invariante "nessuna scrittura".
count_before="$(docker exec fuorirotta-postgres-dev psql -U fuorirotta -d fuorirotta_dev -tAc 'SELECT count(*) FROM scrape_runs;' 2>/dev/null | tr -d '[:space:]')"
[[ -n "${count_before}" ]] || fail "impossibile leggere il conteggio scrape_runs prima dell'esecuzione (container fuorirotta-postgres-dev raggiungibile?)"

# --- 1. Casi puri su computeSourceHealth -----------------------------------------------------
if ! npx tsx scripts/health-cases.ts; then
  fail "npx tsx scripts/health-cases.ts e' uscito diverso da 0"
fi
echo "ok  health-cases.ts: dieci casi verdi (SRC-08)"

# --- 2. Dev server effimero, Postgres locale reale -------------------------------------------
# scripts/dev-db.sh e' l'unico modo sicuro di puntare a un database da questo harness: URL
# letterale, mai da .env, riasserito prima di eseguire. Nessuna scrittura avviene comunque:
# GET /api/monitoring esegue solo SELECT.
bash scripts/dev-db.sh npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# --- 3. GET /api/monitoring senza Authorization: 200, application/json, forma minima ---------
response_ok="${tmp_dir}/response_ok.json"
headers_ok="${tmp_dir}/headers_ok.txt"
http_code="$(curl -s -o "${response_ok}" -w '%{http_code}' -D "${headers_ok}" --max-time 15 "http://127.0.0.1:${port}/api/monitoring")"
[[ "${http_code}" == "200" ]] || fail "atteso 200 su GET /api/monitoring senza credenziali, ottenuto ${http_code} (D-11)"
grep -qi '^content-type:.*application/json' "${headers_ok}" || fail "header content-type senza application/json (header ricevuti: $(cat "${headers_ok}"))"
node -e "
  const body = require('${response_ok}');
  if (typeof body.generatedAt !== 'string') throw new Error('generatedAt assente o non stringa');
  if (!Array.isArray(body.sources)) throw new Error('sources non e\' un array');
" || fail "forma della risposta 200 non valida"
echo "ok  GET /api/monitoring senza Authorization risponde 200, application/json, generatedAt presente, sources e' un array (D-11)"

# --- 4. Coerenza anomaly/status per ogni elemento di sources ---------------------------------
node -e "
  const body = require('${response_ok}');
  for (const s of body.sources) {
    if (![true, false, null].includes(s.anomaly)) {
      throw new Error('anomaly fuori dai tre valori ammessi per ' + s.source + '/' + s.region + ': ' + JSON.stringify(s.anomaly));
    }
    const shouldBeNull = s.status === 'insufficient_history';
    if (shouldBeNull && s.anomaly !== null) {
      throw new Error('status=insufficient_history ma anomaly non e\' null per ' + s.source + '/' + s.region);
    }
    if (!shouldBeNull && s.anomaly === null) {
      throw new Error('anomaly=null ma status non e\' insufficient_history per ' + s.source + '/' + s.region + ' (status=' + s.status + ')');
    }
  }
" || fail "coerenza anomaly/status violata su almeno un elemento di sources"
echo "ok  ogni elemento di sources ha anomaly=null esattamente quando status=insufficient_history"

stop_server

# --- 5. Endpoint a database irraggiungibile: 500, corpo senza dettagli del driver ------------
# NB: non si usa scripts/dev-db.sh qui. La sua guardia accetta di proposito solo il DATABASE_URL
# letterale del Postgres locale — e' li' apposta per impedire URL arbitrari, quindi non puo'
# supportare un URL rotto ad hoc. Serve invece un URL rotto DI PROPOSITO, mai letto da alcun
# file .env (questo worktree non ne ha nessuno: solo .env.example), che punta a una porta
# chiusa su 127.0.0.1: non tocca ne' il Postgres locale ne', a maggior ragione, la produzione.
broken_db_url="postgresql://fuorirotta:fuorirotta@127.0.0.1:${broken_port}/fuorirotta_dev"
DATABASE_URL="${broken_db_url}" DIRECT_URL="${broken_db_url}" \
  npx next dev -p "${port}" >"${tmp_dir}/dev-server-broken.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server riavviato con DATABASE_URL rotto (porta chiusa ${broken_port} su 127.0.0.1, mai ne' il DB locale ne' produzione)"

response_err="${tmp_dir}/response_err.json"
http_code_err="$(curl -s -o "${response_err}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/monitoring")"
[[ "${http_code_err}" == "500" ]] || fail "atteso 500 con database irraggiungibile, ottenuto ${http_code_err}"
node -e "
  const body = require('${response_err}');
  if (typeof body.error !== 'string') throw new Error('corpo 500 senza campo error');
  if (typeof body.checkedAt !== 'string') throw new Error('corpo 500 senza campo checkedAt');
" || fail "corpo della risposta 500 non ha la forma attesa {error, checkedAt}"

body_raw="$(cat "${response_err}")"
for leaked in "postgres" "127.0.0.1" "5433" "ECONNREFUSED" "${broken_port}"; do
  if echo "${body_raw}" | grep -qi -- "${leaked}"; then
    fail "T-08-13: il corpo della risposta 500 contiene '${leaked}' — un dettaglio del driver/host sta trapelando (corpo: ${body_raw})"
  fi
done
echo "ok  GET /api/monitoring con database irraggiungibile risponde 500, corpo {error, checkedAt}, nessuna stringa di connessione al database (T-08-13)"

stop_server

# --- 6. Il conteggio di scrape_runs non e' cambiato (T-08-12) --------------------------------
count_after="$(docker exec fuorirotta-postgres-dev psql -U fuorirotta -d fuorirotta_dev -tAc 'SELECT count(*) FROM scrape_runs;' 2>/dev/null | tr -d '[:space:]')"
[[ "${count_before}" == "${count_after}" ]] || fail "il conteggio di scrape_runs e' cambiato durante l'harness: prima=${count_before} dopo=${count_after} (T-08-12, l'harness non deve scrivere sul database)"
echo "ok  conteggio scrape_runs invariato prima/dopo l'harness (${count_before} righe, T-08-12)"

echo "PASS: monitoring endpoint (MON-01) e casi di confine SRC-08, database mai scritto"
exit 0
