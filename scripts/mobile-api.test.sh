#!/usr/bin/env bash
# Gate dell'API per l'app (check:mobile-api, test:local): un client nativo porta
# SOLO il bearer firmato (il valore di set-auth-token), non manda Origin ne'
# cookie, e deve ottenere dagli stessi gestori di /api/v1/me/** quello che
# ottiene il web. Dev server effimero sul Postgres LOCALE (scripts/dev-db.sh,
# mai produzione), variabili di accesso ESPLICITE con valori finti, come
# scripts/follows-flow.test.sh. Gli utenti (e-mail <sezione>-mobile@fixture.invalid)
# nascono con scripts/auth-flow.helper.ts e si cancellano a inizio e fine giro.
#
# Sezioni (i piani successivi della Fase 26 ne aggiungono altre in fondo):
#   M1  tracer: bearer senza Origin ne' cookie -> PUT follows 200, GET lo elenca, una riga, private, no-store
#   M2  parita': ogni metodo esportato sotto app/api/v1/me risponde al bearer come al cookie + Origin
#   M3  rifiuti: niente credenziali, cookie senza Origin (anche con bearer), token nudo, sessione revocata
#   M4  D-12: una sessione bearer di 2 giorni si rinnova (58 -> 60 giorni), nessuna durata propria dell'app
#   M5  D-04: /me/state ha plan 'beta' e features solo da loggato; anonimo e interruttore spento invariati
#   M6  concorrenza: due PUT bearer in parallelo -> una riga; bearer e cookie vedono gli stessi follow
#   M7  D-13: la sessione dell'app e' 'App iPhone' nell'elenco del web e si revoca da li'
#   M8  D-10: POST /api/auth/sign-out con il solo bearer cancella la sessione
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il dev server dello sviluppatore.
port="${MOBILE_API_TEST_PORT:-39891}"
base_url="http://localhost:${port}"
origin="${base_url}"
app_ua='FuoriRotta/1.0.0 (iOS; iPhone)'

test_dist_dir=".next-mobile-api-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti, ma di forma valida: il segreto ha 40 caratteri (minimo 32).
auth_env=(
  AUTH_ENABLED=true
  NEXT_PUBLIC_AUTH_ENABLED=true
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=mobile-api-test-secret-0123456789abcdef"
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

# Gli utenti di prova @fixture.invalid: la FK in cascata porta via follow, salvati e sessioni.
delete_users() {
  psql_dev "DELETE FROM auth_user WHERE email LIKE '%@fixture.invalid'" >/dev/null 2>&1 || true
}

cleanup() {
  stop_server
  delete_users
  rm -rf "${tmp_dir:?}"
  rm -rf "${repo_root:?}/${test_dist_dir:?}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Parte pulita: utenti di un giro interrotto.
delete_users

# --- Dev server effimero, Postgres locale reale -----------------------------
bash scripts/dev-db.sh env "${auth_env[@]}" npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# call <nome> <metodo> <percorso> <ip> [argomenti curl...]
# Scrive ${tmp_dir}/<nome>.h (header) e <nome>.b (corpo); stampa il codice HTTP.
# La prima compilazione di una rotta e' lenta: --max-time 120.
call() {
  local name="$1" method="$2" path="$3" ip="$4"
  shift 4
  curl -s -X "${method}" -D "${tmp_dir}/${name}.h" -o "${tmp_dir}/${name}.b" -w '%{http_code}' \
    --max-time 120 -H "X-Real-IP: ${ip}" "$@" "http://127.0.0.1:${port}${path}"
}

# bearer_call <nome> <metodo> <percorso> <ip> <bearer> [corpo JSON]
# L'UNICA strada delle richieste "da app" del gate: solo Authorization e
# Content-Type, mai Cookie, mai Origin (e' quello che manda un URLSession effimero).
bearer_call() {
  local name="$1" method="$2" path="$3" ip="$4" bearer="$5" body="${6-}"
  if [[ -n "${body}" ]]; then
    call "${name}" "${method}" "${path}" "${ip}" -H "Authorization: Bearer ${bearer}" -H 'Content-Type: application/json' --data "${body}"
  else
    call "${name}" "${method}" "${path}" "${ip}" -H "Authorization: Bearer ${bearer}" -H 'Content-Type: application/json'
  fi
}

# json_get <file> <espressione JS su "j"> -> stampa il risultato
json_get() {
  node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = eval(process.argv[2]); console.log(v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v))' "$1" "$2"
}

# helper <sottocomando> [args...]: stesso ambiente del dev server, Postgres locale.
helper() {
  bash scripts/dev-db.sh env "${auth_env[@]}" npx tsx scripts/auth-flow.helper.ts "$@"
}

# mint_app_user <prefisso> [userAgent] -> imposta ${prefix}_user, ${prefix}_cookie (valore firmato,
# e' anche il bearer che tiene l'app) e ${prefix}_token (il token NUDO, che va rifiutato).
mint_app_user() {
  local prefix="$1" ua="${2-}" uid cookie token
  read -r uid cookie token <<<"$(helper mint "${prefix}-mobile@fixture.invalid" "Prova ${prefix}" 0 ${ua:+"${ua}"} | tail -n 1)"
  [[ -n "${uid}" && -n "${cookie}" && -n "${token}" ]] || fail "helper mint non ha stampato utente, cookie e token per ${prefix}"
  printf -v "${prefix}_user" '%s' "${uid}"
  printf -v "${prefix}_cookie" '%s' "${cookie}"
  printf -v "${prefix}_token" '%s' "${token}"
}

no_store() { # <nome-file> <sezione>
  local cc
  cc="$(grep -i '^cache-control:' "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r')"
  [[ "${cc}" == "private, no-store" ]] || fail "$2: cache-control atteso 'private, no-store' su $1, ottenuto '${cc}'"
}

follow_rows() { # <utente> <kind> <key> -> numero di righe
  psql_dev "SELECT count(*) FROM user_follows WHERE user_id = '$1' AND kind = '$2' AND key = '$3'"
}

# --- M1 (tracer): un client con il solo bearer salva un follow e lo rilegge -----
mint_app_user m1 "${app_ua}"
code="$(bearer_call m1put PUT /api/v1/me/follows 198.51.100.200 "${m1_cookie}" '{"kind":"region","key":"lombardia"}')"
[[ "${code}" == "200" ]] || fail "M1: PUT follows con il solo bearer: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/m1put.b"))"
[[ "$(json_get "${tmp_dir}/m1put.b" 'j.followed')" == "true" ]] || fail "M1: atteso followed true, corpo '$(cat "${tmp_dir}/m1put.b")'"
no_store m1put M1
code="$(bearer_call m1get GET /api/v1/me/follows 198.51.100.200 "${m1_cookie}")"
[[ "${code}" == "200" ]] || fail "M1: GET follows con il solo bearer: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/m1get.b" 'j.follows.map((f) => f.kind + ":" + f.key).join()')" == "region:lombardia" ]] || fail "M1: il GET deve elencare lombardia, corpo '$(cat "${tmp_dir}/m1get.b")'"
no_store m1get M1
[[ "$(follow_rows "${m1_user}" region lombardia)" == "1" ]] || fail "M1: attesa una riga user_follows per lombardia"
echo "ok  M1: bearer senza Origin ne' cookie -> PUT follows 200 followed true, GET lo elenca, una riga, private, no-store"
