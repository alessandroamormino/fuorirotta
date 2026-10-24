#!/usr/bin/env bash
# Gate del feed "Per te" (check:follows-feed, test:local): dev server effimero sul
# Postgres LOCALE (scripts/dev-db.sh, mai produzione), con le variabili di accesso
# passate ESPLICITE e valori finti, come scripts/follows-flow.test.sh. Gli utenti
# (e-mail @fixture.invalid) nascono con scripts/auth-flow.helper.ts e gli eventi di
# prova stanno sotto la sorgente riservata '__follows_feed_gate__': entrambi si
# cancellano a inizio e fine giro.
#
# Sezioni:
#   FE1  utente con un follow di regione su lombardia: GET /api/v1/me/feed -> 200, private,
#        no-store, follows 1, total > 0, al piu' 10 voci, ognuna con id e title
#   FE2  il total e' il numero di eventi canonici disponibili di lombardia nel DB (la stessa
#        clausola della pagina regione, finestra = mezzanotte di oggi a Roma)
#   FE3  GET / con e senza sessione: un div.per-te-slot vuoto e la riga data-perte nello
#        script del <head>, uguali per tutti
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05).
port="${FOLLOWS_FEED_TEST_PORT:-39889}"
base_url="http://localhost:${port}"
origin="${base_url}"

test_dist_dir=".next-follows-feed-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti, ma di forma valida: il segreto ha 40 caratteri (minimo 32).
auth_env=(
  AUTH_ENABLED=true
  NEXT_PUBLIC_AUTH_ENABLED=true
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=follows-feed-test-secret-0123456789abcdef"
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
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
    lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

# Gli utenti di prova @fixture.invalid: la FK in cascata porta via user_follows.
delete_users() {
  psql_dev "DELETE FROM auth_user WHERE email LIKE '%@fixture.invalid'" >/dev/null 2>&1 || true
}

# Gli eventi di prova (sorgente riservata): niente altro nel DB li usa.
delete_fixture_events() {
  psql_dev "DELETE FROM events WHERE source = '__follows_feed_gate__'" >/dev/null 2>&1 || true
}

cleanup() {
  stop_server
  delete_users
  delete_fixture_events
  rm -rf "${tmp_dir:?}"
  rm -rf "${repo_root:?}/${test_dist_dir:?}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Parte pulita: utenti ed eventi di un giro interrotto.
delete_users
delete_fixture_events

# --- Dev server effimero, Postgres locale reale -----------------------------
bash scripts/dev-db.sh env "${auth_env[@]}" npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# call <nome> <metodo> <percorso> [argomenti curl...]
# Scrive ${tmp_dir}/<nome>.h (header) e <nome>.b (corpo); stampa il codice HTTP.
call() {
  local name="$1" method="$2" path="$3"
  shift 3
  curl -s -X "${method}" -D "${tmp_dir}/${name}.h" -o "${tmp_dir}/${name}.b" -w '%{http_code}' \
    --max-time 120 "$@" "http://127.0.0.1:${port}${path}"
}

# json_get <file> <espressione JS su "j"> -> stampa il risultato
json_get() {
  node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = eval(process.argv[2]); console.log(v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v))' "$1" "$2"
}

# helper <sottocomando> [args...]: stesso ambiente del dev server, Postgres locale.
helper() {
  bash scripts/dev-db.sh env "${auth_env[@]}" npx tsx scripts/auth-flow.helper.ts "$@"
}

# mint_user <prefisso> -> imposta ${prefix}_user e ${prefix}_cookie (intestazione Cookie)
mint_user() {
  local prefix="$1" uid cookie
  read -r uid cookie _ <<<"$(helper mint "${prefix}-feed@fixture.invalid" "Prova ${prefix}" 0 | tail -n 1)"
  [[ -n "${uid}" && -n "${cookie}" ]] || fail "helper mint non ha stampato utente e cookie per ${prefix}"
  printf -v "${prefix}_user" '%s' "${uid}"
  printf -v "${prefix}_cookie" '%s' "Cookie: fuorirotta.session_token=${cookie}"
}

add_follow() { # <utente> <kind> <key>: scrive la riga come lo farebbe la PUT, senza passare dall'API
  psql_dev "INSERT INTO user_follows (user_id, kind, key) VALUES ('$1', '$2', '$3')" >/dev/null
}
get_feed() { # <nome> <cookie> [query]
  call "$1" GET "/api/v1/me/feed${3:-}" -H "$2"
}

no_store() { # <nome-file> <sezione>
  local cc
  cc="$(grep -i '^cache-control:' "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r')"
  [[ "${cc}" == "private, no-store" ]] || fail "$2: cache-control atteso 'private, no-store' su $1, ottenuto '${cc}'"
}

# Mezzanotte di oggi a Roma come "cifre UTC" senza fuso: la finestra di lib/dateWindow.ts.
window_start="$(psql_dev "SELECT ((date_trunc('day', now() AT TIME ZONE 'Europe/Rome')) AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC'")"
[[ -n "${window_start}" ]] || fail "finestra di oggi non calcolata"

mint_user u1
add_follow "${u1_user}" region lombardia

# --- FE1: un follow di regione -> feed 200, privato, con eventi ------------------
code="$(get_feed fe1 "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "FE1: GET feed: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/fe1.b"))"
no_store fe1 FE1
[[ "$(json_get "${tmp_dir}/fe1.b" 'j.follows')" == "1" ]] || fail "FE1: follows atteso 1, corpo '$(head -c 300 "${tmp_dir}/fe1.b")'"
fe1_total="$(json_get "${tmp_dir}/fe1.b" 'j.total')"
[[ "${fe1_total}" -gt 0 ]] || fail "FE1: total atteso > 0 (eventi futuri di lombardia nel DB locale?), ottenuto ${fe1_total}"
[[ "$(json_get "${tmp_dir}/fe1.b" 'j.items.length <= 10 && j.items.length > 0 && j.items.every((e) => Number.isInteger(e.id) && typeof e.title === "string" && e.title.length > 0)')" == "true" ]] || fail "FE1: attese 1..10 voci ognuna con id e title"
echo "ok  FE1: follow di lombardia -> 200 private, no-store, follows 1, total ${fe1_total}, al piu' 10 voci con id e title"

# --- FE2: stessa clausola della pagina regione -----------------------------------
want="$(psql_dev "SELECT count(*) FROM events WHERE region = 'lombardia' AND canonical_event_id IS NULL AND (date_end >= '${window_start}' OR (date_end IS NULL AND date_start >= '${window_start}'))")"
[[ "${fe1_total}" == "${want}" ]] || fail "FE2: total del feed ${fe1_total}, eventi di lombardia nel DB ${want}"
echo "ok  FE2: il total (${fe1_total}) e' il numero di eventi disponibili di lombardia"

# --- FE3: la home e' uguale per tutti, con il riquadro vuoto ---------------------
for who in anon session; do
  if [[ "${who}" == "anon" ]]; then code="$(call "fe3${who}" GET /)"; else code="$(call "fe3${who}" GET / -H "${u1_cookie}")"; fi
  [[ "${code}" == "200" ]] || fail "FE3 (${who}): GET /: atteso 200, ottenuto ${code}"
  # React puo' stampare l'attributo come data-per-te-slot="" o ="true": il pattern non ne fissa il valore.
  grep -qE 'class="per-te-slot"[^>]*></div>' "${tmp_dir}/fe3${who}.b" || fail "FE3 (${who}): manca il div.per-te-slot vuoto"
  grep -q 'data-perte' "${tmp_dir}/fe3${who}.b" || fail "FE3 (${who}): manca la riga data-perte nello script del <head>"
  if grep -q 'class="per-te-slot"[^>]*><section' "${tmp_dir}/fe3${who}.b"; then fail "FE3 (${who}): il server non puo' rendere il rail"; fi
done
echo "ok  FE3: / con e senza sessione contiene div.per-te-slot vuoto e data-perte nello script"

echo "Riepilogo: FE1-FE3 verdi"
