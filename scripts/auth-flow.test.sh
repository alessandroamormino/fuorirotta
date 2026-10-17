#!/usr/bin/env bash
# Gate dell'accesso con Google (check:auth-flow, test:local): dev server
# effimero sul Postgres LOCALE (scripts/dev-db.sh, mai produzione), con le
# variabili di accesso passate ESPLICITE e valori finti. .env.local puo'
# contenere valori veri, ma quelli espliciti vincono.
#
# Sezioni:
#   S1  POST sign-in/social: URL di Google con scope openid email profile,
#       redirect_uri giusto, niente include_granted_scopes; stampa i cookie
#       impostati ("cookie: <nome>", servono alla pagina /cookie)
#   S2  GET /api/v1/me/state senza cookie: {"enabled":true,"user":null}, no-store
#   S3  sessione vera (helper mint) -> lo stato restituisce nome ed e-mail
#   S4  callbackURL assoluto o protocol-relative -> 403
#   S5  statico: nessuno script di Google, nessuna pagina pubblica importa lib/auth
#
# Ogni sezione usa un X-Real-IP di TEST-NET-2 (198.51.100.x) tutto suo, cosi'
# i contatori del rate limit non si disturbano a vicenda. Utenti di prova
# sempre @fixture.invalid, cancellati all'uscita.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il dev server dello sviluppatore.
port="${AUTH_FLOW_TEST_PORT:-39885}"
base_url="http://localhost:${port}"
origin="${base_url}"

test_dist_dir=".next-auth-flow-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti, ma di forma valida: il segreto ha 40 caratteri (minimo 32).
test_secret="auth-flow-test-secret-0123456789abcdefgh"
auth_env=(
  AUTH_ENABLED=1
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=${test_secret}"
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

# helper <sottocomando> [args...]: stesso ambiente del dev server, DB locale.
helper() {
  bash scripts/dev-db.sh env "${auth_env[@]}" npx tsx scripts/auth-flow.helper.ts "$@"
}

cleanup() {
  stop_server
  helper cleanup >/dev/null 2>&1 || true
  psql_dev "DELETE FROM auth_rate_limit WHERE key LIKE '198.51.100.%' OR key LIKE '2001:%' OR key LIKE 'no-trusted-ip|%'" >/dev/null 2>&1 || true
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Parte pulita: utenti e contatori di prove precedenti interrotte.
helper cleanup >/dev/null
psql_dev "DELETE FROM auth_rate_limit WHERE key LIKE '198.51.100.%' OR key LIKE '2001:%' OR key LIKE 'no-trusted-ip|%'" >/dev/null

# --- Dev server effimero, Postgres locale reale -----------------------------
bash scripts/dev-db.sh env "${auth_env[@]}" npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale, accesso attivo con valori finti)"

# call <nome> <metodo> <percorso> <ip> [argomenti curl...]
# Scrive ${tmp_dir}/<nome>.h (header) e <nome>.b (corpo); stampa il codice HTTP.
# La prima compilazione di una rotta e' lenta: --max-time 90.
call() {
  local name="$1" method="$2" path="$3" ip="$4"
  shift 4
  curl -s -X "${method}" -D "${tmp_dir}/${name}.h" -o "${tmp_dir}/${name}.b" -w '%{http_code}' \
    --max-time 90 -H "X-Real-IP: ${ip}" "$@" "http://127.0.0.1:${port}${path}"
}

# header <nome> <header> -> valore (CR tolto)
header() {
  grep -i "^$2:" "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r'
}

# json_get <file> <espressione JS su "j"> -> stampa il risultato
json_get() {
  node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = eval(process.argv[2]); console.log(v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v))' "$1" "$2"
}

# sign_in <nome> <ip> <callbackURL> -> codice HTTP
sign_in() {
  call "$1" POST /api/auth/sign-in/social "$2" \
    -H "Origin: ${origin}" -H 'Content-Type: application/json' \
    --data "{\"provider\":\"google\",\"callbackURL\":\"$3\",\"errorCallbackURL\":\"$3\"}"
}

# --- S1: l'URL di Google e i cookie impostati --------------------------------
code="$(sign_in s1 198.51.100.11 '/eventi/1?a=1')"
[[ "${code}" == "200" ]] || fail "S1: POST sign-in/social: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s1.b"))"
google_url="$(json_get "${tmp_dir}/s1.b" 'j.url')"
node -e '
const u = new URL(process.argv[1]);
const expectedRedirect = process.argv[2] + "/api/auth/callback/google";
if (u.hostname !== "accounts.google.com") { console.error("host " + u.hostname); process.exit(1) }
const scopes = new Set((u.searchParams.get("scope") || "").split(/[ +]/).filter(Boolean));
const want = ["openid", "email", "profile"];
if (scopes.size !== want.length || !want.every((s) => scopes.has(s))) { console.error("scope: " + [...scopes].join(",")); process.exit(1) }
if (u.searchParams.get("redirect_uri") !== expectedRedirect) { console.error("redirect_uri: " + u.searchParams.get("redirect_uri")); process.exit(1) }
if (u.searchParams.has("include_granted_scopes")) { console.error("include_granted_scopes presente"); process.exit(1) }
' "${google_url}" "${base_url}" || fail "S1: l'URL di Google non ha scope {openid,email,profile}, redirect_uri ${base_url}/api/auth/callback/google e nessun include_granted_scopes"
echo "ok  S1: sign-in/social restituisce un URL di Google con scope openid email profile, redirect_uri ${base_url}/api/auth/callback/google, senza include_granted_scopes"
# I nomi dei cookie del sign-in vanno nel SUMMARY e alla pagina /cookie (D-14).
cookie_names="$(grep -i '^set-cookie:' "${tmp_dir}/s1.h" | sed -E 's/^[Ss]et-[Cc]ookie: *([^=]*)=.*/\1/' | sort -u)"
if [[ -n "${cookie_names}" ]]; then
  while IFS= read -r name; do echo "cookie: ${name}"; done <<<"${cookie_names}"
else
  echo "cookie: (nessuno)"
fi

# --- S2: senza cookie lo stato e' "ospite", mai in cache condivisa -------------
code="$(call s2 GET /api/v1/me/state 198.51.100.12)"
[[ "${code}" == "200" ]] || fail "S2: GET /api/v1/me/state: atteso 200, ottenuto ${code}"
[[ "$(cat "${tmp_dir}/s2.b")" == '{"enabled":true,"user":null}' ]] || fail "S2: corpo inatteso: '$(cat "${tmp_dir}/s2.b")'"
[[ "$(header s2 cache-control)" == "private, no-store" ]] || fail "S2: cache-control atteso 'private, no-store', ottenuto '$(header s2 cache-control)'"
echo "ok  S2: senza cookie lo stato e' {\"enabled\":true,\"user\":null} con private, no-store"

# --- S3: una sessione vera restituisce l'utente --------------------------------
read -r s3_user s3_cookie _s3_token <<<"$(helper mint s3-anna@fixture.invalid 'Anna Verdi' 0 | tail -n 1)"
[[ -n "${s3_user}" && -n "${s3_cookie}" ]] || fail "S3: helper mint non ha stampato utente e cookie"
code="$(call s3 GET /api/v1/me/state 198.51.100.13 -H "Cookie: fuorirotta.session_token=${s3_cookie}")"
[[ "${code}" == "200" ]] || fail "S3: GET /api/v1/me/state con cookie: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/s3.b" 'j.enabled')" == "true" ]] || fail "S3: enabled non e' true"
[[ "$(json_get "${tmp_dir}/s3.b" 'j.user.name')" == "Anna Verdi" ]] || fail "S3: nome atteso 'Anna Verdi', corpo: '$(cat "${tmp_dir}/s3.b")'"
[[ "$(json_get "${tmp_dir}/s3.b" 'j.user.email')" == "s3-anna@fixture.invalid" ]] || fail "S3: e-mail attesa s3-anna@fixture.invalid, corpo: '$(cat "${tmp_dir}/s3.b")'"
[[ "$(header s3 cache-control)" == "private, no-store" ]] || fail "S3: cache-control atteso 'private, no-store'"
echo "ok  S3: il cookie di sessione firmato restituisce nome ed e-mail dell'utente"

# --- S4: niente open redirect dai callback URL --------------------------------
for evil in 'https://evil.example/x' '//evil.example/x'; do
  code="$(sign_in s4 198.51.100.14 "${evil}")"
  [[ "${code}" == "403" ]] || fail "S4: callbackURL '${evil}': atteso 403, ottenuto ${code}"
done
echo "ok  S4: callbackURL assoluto e protocol-relative -> 403"

# --- S5: statico, nessuno script di Google e nessuna pagina pubblica sull'auth ---
gsi_hits="$(grep -rnE 'accounts\.google\.com/gsi|googleusercontent' app components lib || true)"
[[ -z "${gsi_hits}" ]] || fail "S5: script Google o host googleusercontent nel codice: ${gsi_hits}"
public_hits="$(grep -rnE "lib/auth([\"'/]|$)" app/layout.tsx app/page.tsx app/eventi "app/[regione]" || true)"
[[ -z "${public_hits}" ]] || fail "S5: una pagina pubblica importa lib/auth: ${public_hits}"
echo "ok  S5: nessuno script di Google in app/ components/ lib/, nessuna pagina pubblica importa lib/auth"
