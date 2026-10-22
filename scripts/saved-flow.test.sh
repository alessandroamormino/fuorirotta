#!/usr/bin/env bash
# Gate dei salvati (check:saved-flow, test:local): dev server effimero sul
# Postgres LOCALE (scripts/dev-db.sh, mai produzione), con le variabili di
# accesso passate ESPLICITE e valori finti, come scripts/auth-flow.test.sh.
# Nessun utente di prova: la rotta dei salvati degli ospiti non ne ha bisogno.
#
# Sezioni:
#   R1  POST /api/v1/saved/resolve [A, M, 999999999]: tre righe, il membro M risolve
#       alla canonica A, A ha un'istantanea viva, l'id sconosciuto ha eventId e live nulli
#   R2  101 id, un id stringa, 0, 1000000000, un corpo non JSON -> 400 ciascuno
#   R3  la risposta 200 ha cache-control "private, no-store" e nessun set-cookie
#   R4  GET /salvati -> 200, contiene >Salvati</h1> e un meta robots noindex
#   R5  GET / -> 200, i cuori del server sono il contorno non salvato per tutti
#
# Righe di prova sotto il `source` dedicato '__saved_gate__', cancellate prima
# e all'uscita: nessuna riga reale viene letta o toccata.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il dev server dello sviluppatore.
port="${SAVED_FLOW_TEST_PORT:-39887}"
base_url="http://localhost:${port}"

test_dist_dir=".next-saved-flow-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
test_source="__saved_gate__"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti, ma di forma valida: il segreto ha 40 caratteri (minimo 32).
auth_env=(
  AUTH_ENABLED=true
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=saved-flow-test-secret-0123456789abcdefg"
  GOOGLE_CLIENT_ID=test-client-id.apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET=test-client-secret
)

fail() {
  echo "FAIL: $1"
  exit 1
}

psql_dev() {
  docker compose -f "${compose_file}" exec -T postgres-dev \
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
    # `next dev` spawna figli non sempre raggiungibili da un kill sul pid:
    # pkill -P prova l'albero, lsof sulla porta e' la rete di sicurezza.
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
    lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

delete_fixtures() {
  # Prima i membri, poi le canoniche: la FK canonical_event_id e' SET NULL, ma cosi' non resta nulla.
  psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null 2>&1 || true
}

cleanup() {
  stop_server
  delete_fixtures
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Parte pulita: righe di un giro interrotto.
delete_fixtures

# --- Fixture: canonica A, membro M di A, passato P ---------------------------
insert_event() {
  # insert_event <source_id> <titolo> <date_start> <date_end> <canonical_event_id|NULL> -> id
  psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, canonical_event_id) VALUES ('${test_source}', '$1', '$2', $3, $4, $5) RETURNING id" | head -n 1
}
a_id="$(insert_event gate-a 'Gate A' "now() + interval '3 days'" "now() + interval '4 days'" NULL)"
m_id="$(insert_event gate-m 'Gate M' "now() + interval '3 days'" "now() + interval '4 days'" "${a_id}")"
p_id="$(insert_event gate-p 'Gate P' "now() - interval '21 days'" "now() - interval '20 days'" NULL)"
[[ -n "${a_id}" && -n "${m_id}" && -n "${p_id}" ]] || fail "fixture non create (A='${a_id}' M='${m_id}' P='${p_id}')"
echo "ok  fixture create: A=${a_id} M=${m_id} (membro di A) P=${p_id} (passato)"

# --- Dev server effimero, Postgres locale reale -----------------------------
bash scripts/dev-db.sh env "${auth_env[@]}" npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# call <nome> <metodo> <percorso> [argomenti curl...]
# Scrive ${tmp_dir}/<nome>.h (header) e <nome>.b (corpo); stampa il codice HTTP.
# La prima compilazione di una rotta e' lenta: --max-time 120.
call() {
  local name="$1" method="$2" path="$3"
  shift 3
  curl -s -X "${method}" -D "${tmp_dir}/${name}.h" -o "${tmp_dir}/${name}.b" -w '%{http_code}' \
    --max-time 120 "$@" "http://127.0.0.1:${port}${path}"
}

# post_ids <nome> <corpo json> -> codice HTTP
post_ids() {
  call "$1" POST /api/v1/saved/resolve -H 'Content-Type: application/json' --data "$2"
}

# json_get <file> <espressione JS su "j"> -> stampa il risultato
json_get() {
  node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = eval(process.argv[2]); console.log(v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v))' "$1" "$2"
}

# --- R1: risoluzione a canonica e istantanea viva ----------------------------
code="$(post_ids r1 "{\"ids\":[${a_id},${m_id},999999999]}")"
[[ "${code}" == "200" ]] || fail "R1: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/r1.b"))"
[[ "$(json_get "${tmp_dir}/r1.b" 'j.items.length')" == "3" ]] || fail "R1: attese 3 righe, corpo: '$(cat "${tmp_dir}/r1.b")'"
[[ "$(json_get "${tmp_dir}/r1.b" 'j.items[1].eventId')" == "${a_id}" ]] || fail "R1: il membro M deve risolvere alla canonica A (${a_id}), corpo: '$(cat "${tmp_dir}/r1.b")'"
[[ -n "$(json_get "${tmp_dir}/r1.b" 'j.items[0].live.title')" && "$(json_get "${tmp_dir}/r1.b" 'j.items[0].live.title')" != "undefined" ]] || fail "R1: A deve avere un titolo vivo"
[[ "$(json_get "${tmp_dir}/r1.b" 'j.items[2].eventId')" == "null" && "$(json_get "${tmp_dir}/r1.b" 'j.items[2].live')" == "null" ]] || fail "R1: l'id sconosciuto deve avere eventId e live nulli"
echo "ok  R1: resolve [A, M, sconosciuto] -> 3 righe, M risolve ad A, A ha l'istantanea viva, lo sconosciuto e' nullo"

# --- R2: tutto cio' che non e' 1..100 interi di al piu' nove cifre e' 400 -----
too_many="$(node -e 'console.log(JSON.stringify({ids: Array.from({length: 101}, (_, i) => i + 1)}))')"
for body in "${too_many}" '{"ids":["7"]}' '{"ids":[0]}' '{"ids":[1000000000]}' '{"ids":[]}' '{"ids":[1.5]}' 'non json'; do
  code="$(post_ids r2 "${body}")"
  [[ "${code}" == "400" ]] || fail "R2: corpo '${body:0:40}': atteso 400, ottenuto ${code}"
  [[ "$(grep -i '^cache-control:' "${tmp_dir}/r2.h" | head -n 1 | cut -d: -f2- | tr -d ' \r')" == "private,no-store" ]] || fail "R2: anche il 400 deve essere private, no-store"
done
echo "ok  R2: 101 id, id stringa, 0, 1000000000, lista vuota, decimale e corpo non JSON -> 400"

# --- R3: nessuna cache condivisa, nessun cookie ------------------------------
code="$(post_ids r3 "{\"ids\":[${a_id}]}")"
[[ "${code}" == "200" ]] || fail "R3: atteso 200, ottenuto ${code}"
cc="$(grep -i '^cache-control:' "${tmp_dir}/r3.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r')"
[[ "${cc}" == "private, no-store" ]] || fail "R3: cache-control atteso 'private, no-store', ottenuto '${cc}'"
if grep -qi '^set-cookie:' "${tmp_dir}/r3.h"; then fail "R3: la risposta non deve impostare cookie"; fi
echo "ok  R3: 200 con cache-control 'private, no-store' e senza set-cookie"

# --- R4: /salvati e' una pagina pubblica, noindex ----------------------------
code="$(call r4 GET /salvati)"
[[ "${code}" == "200" ]] || fail "R4: GET /salvati: atteso 200, ottenuto ${code}"
grep -q '>Salvati</h1>' "${tmp_dir}/r4.b" || fail "R4: manca >Salvati</h1>"
grep -qiE '<meta name="robots" content="[^"]*noindex' "${tmp_dir}/r4.b" || fail "R4: manca il meta robots noindex"
echo "ok  R4: GET /salvati -> 200, h1 Salvati, robots noindex"

# --- R5: i cuori del server sono il contorno non salvato ---------------------
code="$(call r5 GET /)"
[[ "${code}" == "200" ]] || fail "R5: GET /: atteso 200, ottenuto ${code}"
grep -q 'aria-label="Salva: ' "${tmp_dir}/r5.b" || fail "R5: nessun cuore 'Salva: ' nell'HTML della home (dati locali vecchi? npm run scrape:local)"
grep -q 'aria-pressed="false"' "${tmp_dir}/r5.b" || fail "R5: i cuori del server devono avere aria-pressed=\"false\""
if grep -q 'aria-pressed="true"' "${tmp_dir}/r5.b"; then fail "R5: nessun cuore del server puo' essere salvato"; fi
echo "ok  R5: la home contiene cuori 'Salva: ...' con aria-pressed=\"false\", mai \"true\""

echo "Riepilogo: R1-R5 verdi"
