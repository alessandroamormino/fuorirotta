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
#   P1  tracer: PUT /me/devices col solo bearer -> una riga push_devices (token minuscolo, sessione dell'app); il secondo PUT la aggiorna
#   P2  concorrenza: due PUT dello stesso token -> 200 e 200 e una riga
#   P3  passaggio di proprieta' e scoping: la riga passa al secondo utente, il DELETE dell'altro non toglie nulla
#   P4  validazione: 400 senza scritture, 401/403 senza credenziali, il token solo dal corpo
#   P5  tetto di 10 dispositivi per utente: l'11esimo fa sparire il meno recente
#   P6  D-10: revoca dal web, sign-out col bearer e cancellazione dell'account tolgono il dispositivo
#   P7  l'export elenca pushDevices senza token
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
    exec 3>&- || true
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 150 ]]; then
      fail "porta ${target_port} non ha risposto entro il timeout"
    fi
    sleep 0.1
  done
  exec 3>&- || true
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
  psql_dev "DELETE FROM push_devices WHERE device_token LIKE 'fe%'" >/dev/null 2>&1 || true
  psql_dev "DELETE FROM auth_user WHERE email LIKE '%@fixture.invalid'" >/dev/null 2>&1 || true
}

# L'evento di prova di M2 (sorgente riservata): niente altro nel DB la usa.
delete_fixture_events() {
  psql_dev "DELETE FROM events WHERE source = '__mobile_api__'" >/dev/null 2>&1 || true
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

# mint_app_user <prefisso> [userAgent] [nome] -> imposta ${prefix}_user, ${prefix}_cookie (valore firmato,
# e' anche il bearer che tiene l'app) e ${prefix}_token (il token NUDO, che va rifiutato).
mint_app_user() {
  local prefix="$1" ua="${2-}" name="${3:-Prova $1}" uid cookie token
  read -r uid cookie token <<<"$(helper mint "${prefix}-mobile@fixture.invalid" "${name}" 0 ${ua:+"${ua}"} | tail -n 1)"
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

# --- M2: parita' bearer / cookie su OGNI metodo esportato sotto app/api/v1/me ---------
# Due utenti gemelli: W (web: cookie firmato + Origin) e A (app: solo bearer, bearer_call),
# stesso nome, e-mail diverse. Ogni riga gira per W e per A e deve dare lo stesso stato e lo
# stesso corpo normalizzato. Nel percorso, [eventId] [ref] [id] sono i segmenti dinamici dei
# file route.ts: li sostituisce side_path. {ev} nel corpo e' l'id dell'evento di prova.
# Le righe sono in ordine: le creazioni prima di rotate/patch/delete.
m2_matrix=(
  'GET|/api/v1/me/state|'
  'GET|/api/v1/me/follows|'
  'PUT|/api/v1/me/follows|{"kind":"region","key":"lombardia"}'
  'GET|/api/v1/me/follows|'
  'DELETE|/api/v1/me/follows|{"kind":"region","key":"lombardia"}'
  'POST|/api/v1/me/onboarding|{"places":[{"kind":"region","key":"lombardia"}],"categories":[]}'
  'GET|/api/v1/me/feed|'
  'PATCH|/api/v1/me/profile|{"name":"Parita Prova"}'
  'GET|/api/v1/me/saved|'
  'GET|/api/v1/me/saved/ids|'
  'PUT|/api/v1/me/saved/[eventId]|'
  'GET|/api/v1/me/saved|'
  'GET|/api/v1/me/saved/ids|'
  'POST|/api/v1/me/saved/ack|{"eventIds":[{ev}]}'
  'POST|/api/v1/me/saved/merge|{"items":[]}'
  'DELETE|/api/v1/me/saved/[eventId]|'
  'DELETE|/api/v1/me/saved/gone/[ref]|'
  'GET|/api/v1/me/share|'
  'PATCH|/api/v1/me/share|{"showName":true}'
  'POST|/api/v1/me/share/rotate|'
  'POST|/api/v1/me/share|'
  'GET|/api/v1/me/share|'
  'PATCH|/api/v1/me/share|{"showName":true}'
  'POST|/api/v1/me/share/rotate|'
  'DELETE|/api/v1/me/share|'
  'POST|/api/v1/me/calendar-feed|'
  'POST|/api/v1/me/calendar-feed/rotate|'
  'PUT|/api/v1/me/devices|{"token":"{tok}","environment":"sandbox"}'
  'DELETE|/api/v1/me/devices|{"token":"{tok}"}'
  'GET|/api/v1/me/export|'
  'GET|/api/v1/me/sessions|'
  'DELETE|/api/v1/me/sessions/[id]|'
  'DELETE|/api/v1/me/sessions|'
)

# Elenco "METODO /percorso" derivato dai file route.ts (mai da una copia tenuta a mano).
derive_me_methods() {
  local f p
  while IFS= read -r f; do
    p="/${f#app/}"
    p="${p%/route.ts}"
    { grep -oE 'export (async )?function (GET|POST|PUT|PATCH|DELETE)' "${f}" || true; } | awk -v p="${p}" '{ print $NF " " p }'
  done < <(find app/api/v1/me -name route.ts | sort)
}

matrix_methods() {
  local row m p
  for row in "${m2_matrix[@]}"; do
    IFS='|' read -r m p _ <<<"${row}"
    echo "${m} ${p}"
  done
}

# coverage_diff <derivato> <matrice> -> stampa le differenze ("manca ..." / "in piu' ...")
coverage_diff() {
  comm -23 <(sort -u <<<"$1") <(sort -u <<<"$2") | sed 's/^/manca nella matrice: /'
  comm -13 <(sort -u <<<"$1") <(sort -u <<<"$2") | sed "s/^/in piu' nella matrice (nessun file lo esporta): /"
}

derived="$(derive_me_methods)"
[[ -n "${derived}" ]] || fail "M2: nessun metodo derivato da app/api/v1/me"
diff_real="$(coverage_diff "${derived}" "$(matrix_methods)")"
[[ -z "${diff_real}" ]] || fail "M2: la matrice non copre le rotte me/**: ${diff_real}"
# Non-vacuita': con un metodo in piu' tra i file, il controllo deve accorgersene.
diff_synth="$(coverage_diff "${derived}"$'\n'"POST /api/v1/me/__sintetica__" "$(matrix_methods)")"
[[ "${diff_synth}" == *"manca nella matrice: POST /api/v1/me/__sintetica__"* ]] || fail "M2: il controllo di copertura non vede un metodo sintetico mancante (vacuo)"
m2_pairs="$(wc -l <<<"${derived}" | tr -d ' ')"

# Normalizzatore: stesso significato -> stessa stringa. Tempi ISO -> <ts>, id/e-mail/nome
# dell'utente di quel lato -> <self>, stringhe di 22+ caratteri base64url (codici dei link,
# id di sessione) -> <code>, numeri sotto le chiavi id/eventId/ref -> <id>.
norm_body() { # <file> <userId> <email> <nome>
  node -e '
const fs = require("fs");
const [file, id, email, name] = process.argv.slice(1);
const text = fs.readFileSync(file, "utf8");
let j;
try { j = JSON.parse(text); } catch { console.log("RAW:" + text); process.exit(0); }
const walk = (v, key) => {
  if (typeof v === "string") {
    if (v === id || v === email || v === name) return "<self>";
    return v.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>").replace(/[A-Za-z0-9_-]{22,}/g, "<code>");
  }
  if (typeof v === "number" && (key === "id" || key === "eventId" || key === "ref")) return "<id>";
  if (Array.isArray(v)) return v.map((x) => walk(x, key));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
  return v;
};
console.log(JSON.stringify(walk(j)));
' "$1" "$2" "$3" "$4"
}

# export e' un allegato con date e righe: confronto stato, content-type e chiavi (due livelli).
export_shape() { # <file>
  node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const inner = (v) => Array.isArray(v) ? (v[0] && typeof v[0] === "object" ? "[" + Object.keys(v[0]).sort().join(",") + "]" : "[]") : v && typeof v === "object" ? "{" + Object.keys(v).sort().join(",") + "}" : "";
console.log(Object.keys(j).sort().map((k) => k + inner(j[k])).join(" "));
' "$1"
}

header_value() { # <nome-file> <intestazione> -> valore
  grep -i "^$2:" "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r'
}

m2_ip_w=198.51.100.201
m2_ip_a=198.51.100.202

# Token dei dispositivi di prova: 'fe' + 62 caratteri esadecimali, uno per lato (device_token e' unico).
m2w_tok="fe$(printf 'a1%.0s' {1..31})"
m2a_tok="fe$(printf 'b2%.0s' {1..31})"
mint_app_user m2w "" "Parita Prova"
mint_app_user m2a "" "Parita Prova"
m2_ev="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, location_name, canonical_category)
  VALUES ('__mobile_api__', 'm2', 'Prova parita bearer', now() + interval '3 days', now() + interval '4 days', 'Piazza di prova', 'Altro')
  RETURNING id" | head -n 1)"
[[ "${m2_ev}" =~ ^[0-9]+$ ]] || fail "M2: evento di prova non inserito (id '${m2_ev}')"
for who in m2w m2a; do
  uid_var="${who}_user"
  read -r sid_val cookie_val _ <<<"$(helper session "${!uid_var}" 0 | tail -n 1)"
  [[ -n "${sid_val}" ]] || fail "M2: helper session non ha stampato la seconda sessione di ${who}"
  printf -v "${who}_sid" '%s' "${sid_val}"
  gone_id="$(psql_dev "INSERT INTO saved_events (user_id, event_id, title, date_start, canonical_category, source, source_id)
    VALUES ('${!uid_var}', NULL, 'Sparito', now() + interval '2 days', 'Altro', '__mobile_api__', 'gone') RETURNING id" | head -n 1)"
  [[ "${gone_id}" =~ ^[0-9]+$ ]] || fail "M2: riga 'sparita' non inserita per ${who}"
  printf -v "${who}_gone" '%s' "${gone_id}"
done

# side_path <lato: w|a> <testo> -> testo con [eventId] [ref] [id] e {ev} sostituiti
side_path() {
  local who="$1" s="$2" sid_var="m2${1}_sid" gone_var="m2${1}_gone" tok_var="m2${1}_tok"
  s="${s//\[eventId\]/${m2_ev}}"
  s="${s//\[ref\]/${!gone_var}}"
  s="${s//\[id\]/${!sid_var}}"
  s="${s//\{ev\}/${m2_ev}}"
  s="${s//\{tok\}/${!tok_var}}"
  printf '%s' "${s}"
}

# side_call <nome> <lato> <metodo> <percorso> <corpo> -> stampa il codice HTTP
side_call() {
  local name="$1" who="$2" method="$3" path body
  path="$(side_path "${who}" "$4")"
  body="$(side_path "${who}" "$5")"
  if [[ "${who}" == w ]]; then
    local args=(-H "Cookie: fuorirotta.session_token=${m2w_cookie}" -H "Origin: ${origin}")
    [[ -z "${body}" ]] || args+=(-H 'Content-Type: application/json' --data "${body}")
    call "${name}" "${method}" "${path}" "${m2_ip_w}" "${args[@]}"
  else
    bearer_call "${name}" "${method}" "${path}" "${m2_ip_a}" "${m2a_cookie}" "${body}"
  fi
}

i=0
m2_ok=0
for row in "${m2_matrix[@]}"; do
  i=$((i + 1))
  IFS='|' read -r m_method m_path m_body <<<"${row}"
  code_w="$(side_call "m2w${i}" w "${m_method}" "${m_path}" "${m_body}")"
  code_a="$(side_call "m2a${i}" a "${m_method}" "${m_path}" "${m_body}")"
  [[ "${code_w}" == "${code_a}" ]] || fail "M2: ${m_method} ${m_path}: cookie ${code_w} ($(head -c 200 "${tmp_dir}/m2w${i}.b")), bearer ${code_a} ($(head -c 200 "${tmp_dir}/m2a${i}.b"))"
  if [[ "${m_path}" == "/api/v1/me/export" ]]; then
    [[ "${code_w}" == "200" ]] || fail "M2: export: atteso 200, ottenuto ${code_w}"
    [[ "$(header_value "m2w${i}" content-type)" == "$(header_value "m2a${i}" content-type)" ]] || fail "M2: export: content-type diverso"
    [[ "$(export_shape "${tmp_dir}/m2w${i}.b")" == "$(export_shape "${tmp_dir}/m2a${i}.b")" ]] || fail "M2: export: chiavi diverse fra cookie e bearer"
  else
    nw="$(norm_body "${tmp_dir}/m2w${i}.b" "${m2w_user}" "m2w-mobile@fixture.invalid" "Parita Prova")"
    na="$(norm_body "${tmp_dir}/m2a${i}.b" "${m2a_user}" "m2a-mobile@fixture.invalid" "Parita Prova")"
    [[ "${nw}" == "${na}" ]] || fail "M2: ${m_method} ${m_path}: corpo diverso. cookie: ${nw} bearer: ${na}"
  fi
  # Le rotte di prova devono essere vive: un 404 di routing o un 500 non e' una parita'.
  [[ "${code_w}" != "500" && "${code_w}" != 000 ]] || fail "M2: ${m_method} ${m_path}: stato ${code_w}"
  [[ -z "${MOBILE_API_VERBOSE-}" ]] || echo "    M2 ${m_method} ${m_path} -> ${code_w}"
  [[ "${code_a}" != "200" ]] || m2_ok=$((m2_ok + 1))
done
# Anti-vacuita': se quasi tutto rispondesse 401/404 su entrambi i lati la parita' non direbbe nulla.
[[ "${m2_ok}" -ge 20 ]] || fail "M2: solo ${m2_ok} righe su ${i} rispondono 200 al bearer: la parita' sarebbe vuota"

echo "ok  M2: ${m2_pairs} metodi esportati sotto app/api/v1/me, ${i} righe: (${m2_ok} con 200) stesso stato e stesso corpo normalizzato con cookie + Origin e con il solo bearer; il controllo di copertura deriva dai file e non e' vacuo"

# --- M3: rifiuti ---------------------------------------------------------------------
m3_count=0
for row in "${m2_matrix[@]}"; do
  IFS='|' read -r m_method m_path m_body <<<"${row}"
  path="$(side_path w "${m_path}")"
  data=()
  [[ -z "${m_body}" ]] || data=(-H 'Content-Type: application/json' --data "$(side_path w "${m_body}")")
  # a) niente credenziali, con Origin
  code="$(call m3a "${m_method}" "${path}" 198.51.100.203 -H "Origin: ${origin}" ${data[@]+"${data[@]}"})"
  if [[ "${m_path}" == "/api/v1/me/state" ]]; then
    [[ "${code}" == "200" && "$(cat "${tmp_dir}/m3a.b")" == '{"enabled":true,"user":null}' ]] || fail "M3: state senza credenziali: atteso 200 {\"enabled\":true,\"user\":null}, ottenuto ${code} '$(cat "${tmp_dir}/m3a.b")'"
  else
    [[ "${code}" == "401" && "$(json_get "${tmp_dir}/m3a.b" 'j.error')" == "unauthenticated" ]] || fail "M3: ${m_method} ${m_path} senza credenziali: atteso 401 unauthenticated, ottenuto ${code} '$(cat "${tmp_dir}/m3a.b")'"
  fi
  no_store m3a M3
  [[ "${m_method}" != "GET" ]] || { m3_count=$((m3_count + 1)); continue; }
  # b) niente credenziali, niente Origin
  code="$(call m3b "${m_method}" "${path}" 198.51.100.203 ${data[@]+"${data[@]}"})"
  [[ "${code}" == "403" && "$(json_get "${tmp_dir}/m3b.b" 'j.error')" == "origin" ]] || fail "M3: ${m_method} ${m_path} senza credenziali ne' Origin: atteso 403 origin, ottenuto ${code} '$(cat "${tmp_dir}/m3b.b")'"
  no_store m3b M3
  # c) il cookie di W senza Origin
  code="$(call m3c "${m_method}" "${path}" 198.51.100.203 -H "Cookie: fuorirotta.session_token=${m2w_cookie}" ${data[@]+"${data[@]}"})"
  [[ "${code}" == "403" && "$(json_get "${tmp_dir}/m3c.b" 'j.error')" == "origin" ]] || fail "M3: ${m_method} ${m_path} con il solo cookie: atteso 403 origin, ottenuto ${code} '$(cat "${tmp_dir}/m3c.b")'"
  no_store m3c M3
  # d) cookie + un bearer qualunque, senza Origin: il cookie tiene il controllo
  code="$(call m3d "${m_method}" "${path}" 198.51.100.203 -H "Cookie: fuorirotta.session_token=${m2w_cookie}" -H 'Authorization: Bearer garbage.value' ${data[@]+"${data[@]}"})"
  [[ "${code}" == "403" && "$(json_get "${tmp_dir}/m3d.b" 'j.error')" == "origin" ]] || fail "M3: ${m_method} ${m_path} con cookie + bearer finto: atteso 403 origin, ottenuto ${code} '$(cat "${tmp_dir}/m3d.b")'"
  no_store m3d M3
  m3_count=$((m3_count + 1))
done

mint_app_user m3
# token nudo come bearer: 401 su una scrittura, nessun utente sullo stato
code="$(bearer_call m3e PUT /api/v1/me/follows 198.51.100.204 "${m3_token}" '{"kind":"region","key":"lombardia"}')"
[[ "${code}" == "401" ]] || fail "M3: token nudo come bearer su PUT follows: atteso 401, ottenuto ${code}"
no_store m3e M3
code="$(bearer_call m3f GET /api/v1/me/state 198.51.100.204 "${m3_token}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m3f.b" 'j.user')" == "null" ]] || fail "M3: token nudo come bearer su state: atteso user null, ottenuto ${code} '$(cat "${tmp_dir}/m3f.b")'"
# una sessione revocata dal web: il suo bearer da' 401
read -r m3_sid2 m3_cookie2 _ <<<"$(helper session "${m3_user}" 0 | tail -n 1)"
code="$(bearer_call m3g GET /api/v1/me/follows 198.51.100.204 "${m3_cookie2}")"
[[ "${code}" == "200" ]] || fail "M3: il bearer della seconda sessione, prima della revoca: atteso 200, ottenuto ${code}"
code="$(call m3h DELETE "/api/v1/me/sessions/${m3_sid2}" 198.51.100.204 -H "Cookie: fuorirotta.session_token=${m3_cookie}" -H "Origin: ${origin}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m3h.b" 'j.revoked')" == "1" ]] || fail "M3: revoca dal web: attesa 200 revoked 1, ottenuto ${code} '$(cat "${tmp_dir}/m3h.b")'"
code="$(bearer_call m3i GET /api/v1/me/follows 198.51.100.204 "${m3_cookie2}")"
[[ "${code}" == "401" ]] || fail "M3: il bearer di una sessione revocata: atteso 401, ottenuto ${code}"
no_store m3i M3
echo "ok  M3: ${m3_count} righe: senza credenziali 401 (state 200 user null), le scritture senza Origin 403, il solo cookie o cookie + bearer finto senza Origin 403, token nudo 401, sessione revocata dal web 401; tutto private, no-store"

# --- M4: D-12, il rinnovo a scorrimento vale anche per il bearer --------------------------
mint_app_user m4
psql_dev "UPDATE auth_session SET expires_at = expires_at - interval '2 days', updated_at = updated_at - interval '2 days' WHERE token = '${m4_token}'" >/dev/null
days_before="$(psql_dev "SELECT round(extract(epoch FROM (expires_at - now())) / 86400) FROM auth_session WHERE token = '${m4_token}'")"
[[ "${days_before}" == "58" ]] || fail "M4: prima del rinnovo expires_at atteso a ~58 giorni, trovato ${days_before}"
code="$(bearer_call m4 GET /api/v1/me/state 198.51.100.205 "${m4_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m4.b" 'j.user.email')" == "m4-mobile@fixture.invalid" ]] || fail "M4: stato col bearer: atteso 200 con l'utente, ottenuto ${code} '$(cat "${tmp_dir}/m4.b")'"
days_after="$(psql_dev "SELECT round(extract(epoch FROM (expires_at - now())) / 86400) FROM auth_session WHERE token = '${m4_token}'")"
[[ "${days_after}" == "60" ]] || fail "M4: dopo il rinnovo expires_at atteso a ~60 giorni, trovato ${days_after}"
echo "ok  M4: sessione bearer a 58 giorni rinnovata da una richiesta a /me/state: expires_at 58 -> 60 giorni, nessuna durata propria dell'app"

# --- M5: D-04, piano e funzioni solo da loggati -------------------------------------------
mint_app_user m5
expected_features="$(bash scripts/dev-db.sh npx tsx -e "import('./lib/api-contract.ts').then((mod) => { const m = mod.default ?? mod; console.log(JSON.stringify(m.FEATURES)) })" | tail -n 1)"
[[ "${expected_features}" == \[* ]] || fail "M5: non riesco a leggere FEATURES da lib/api-contract.ts (ottenuto '${expected_features}')"
code="$(call m5w GET /api/v1/me/state 198.51.100.206 -H "Cookie: fuorirotta.session_token=${m5_cookie}")"
[[ "${code}" == "200" ]] || fail "M5: stato col cookie: atteso 200, ottenuto ${code}"
code="$(bearer_call m5a GET /api/v1/me/state 198.51.100.206 "${m5_cookie}")"
[[ "${code}" == "200" ]] || fail "M5: stato col bearer: atteso 200, ottenuto ${code}"
for f in m5w m5a; do
  [[ "$(json_get "${tmp_dir}/${f}.b" 'j.plan')" == "beta" ]] || fail "M5: ${f}: atteso plan 'beta', corpo '$(cat "${tmp_dir}/${f}.b")'"
  [[ "$(json_get "${tmp_dir}/${f}.b" 'JSON.stringify(j.features)')" == "${expected_features}" ]] || fail "M5: ${f}: features diverse da FEATURES di lib/api-contract.ts (${expected_features}), corpo '$(cat "${tmp_dir}/${f}.b")'"
done
code="$(call m5n GET /api/v1/me/state 198.51.100.206)"
[[ "${code}" == "200" && "$(cat "${tmp_dir}/m5n.b")" == '{"enabled":true,"user":null}' ]] || fail "M5: il corpo anonimo deve restare {\"enabled\":true,\"user\":null}, ottenuto '$(cat "${tmp_dir}/m5n.b")'"
# D-01, parte statica: api-contract lo importano solo userAgent, lo stato e l'API v1, mai pagine, componenti o /api/events.
stray="$(grep -rl 'api-contract' app components lib --include='*.ts' --include='*.tsx' | grep -vE '^(lib/userAgent\.ts|lib/api-contract\.ts|app/api/v1/)' || true)"
[[ -z "${stray}" ]] || fail "M5: api-contract importato fuori da lib/userAgent.ts e app/api/v1: ${stray}"
echo "ok  M5: da loggati (cookie e bearer) /me/state ha plan 'beta' e features = FEATURES; l'anonimo resta {\"enabled\":true,\"user\":null}; api-contract non e' importato da pagine, componenti o /api/events"

# --- M6: concorrenza (bordo API-02) e stessa lista da cookie e bearer ----------------------
mint_app_user m6
bearer_call m6p1 PUT /api/v1/me/follows 198.51.100.207 "${m6_cookie}" '{"kind":"region","key":"toscana"}' >"${tmp_dir}/m6p1.code" &
pid1=$!
bearer_call m6p2 PUT /api/v1/me/follows 198.51.100.207 "${m6_cookie}" '{"kind":"region","key":"toscana"}' >"${tmp_dir}/m6p2.code" &
pid2=$!
wait "${pid1}" "${pid2}"
[[ "$(cat "${tmp_dir}/m6p1.code")" == "200" && "$(cat "${tmp_dir}/m6p2.code")" == "200" ]] || fail "M6: due PUT bearer in parallelo: attesi 200 e 200, ottenuti $(cat "${tmp_dir}/m6p1.code") e $(cat "${tmp_dir}/m6p2.code")"
[[ "$(follow_rows "${m6_user}" region toscana)" == "1" ]] || fail "M6: due PUT bearer in parallelo devono lasciare una riga"
read -r _ m6_cookie2 _ <<<"$(helper session "${m6_user}" 0 | tail -n 1)"
code="$(call m6w GET /api/v1/me/follows 198.51.100.207 -H "Cookie: fuorirotta.session_token=${m6_cookie}")"
[[ "${code}" == "200" ]] || fail "M6: GET col cookie: atteso 200, ottenuto ${code}"
code="$(bearer_call m6a GET /api/v1/me/follows 198.51.100.207 "${m6_cookie2}")"
[[ "${code}" == "200" ]] || fail "M6: GET col bearer di un'altra sessione: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/m6w.b" 'j.follows.map((f) => f.kind + ":" + f.key).join()')" == "region:toscana" ]] || fail "M6: il cookie deve elencare toscana, corpo '$(cat "${tmp_dir}/m6w.b")'"
[[ "$(cat "${tmp_dir}/m6w.b")" == "$(cat "${tmp_dir}/m6a.b")" ]] || fail "M6: cookie e bearer della stessa utente devono vedere gli stessi follow"
echo "ok  M6: due PUT bearer in parallelo -> 200 e 200 e una riga; cookie e bearer di due sessioni dello stesso utente leggono gli stessi follow"

# --- M7: D-13, la sessione dell'app si vede e si revoca dal web --------------------------------
chrome_ua='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
mint_app_user m7 "${chrome_ua}"
read -r m7_app_sid m7_app_cookie _ <<<"$(helper session "${m7_user}" 0 "${app_ua}" | tail -n 1)"
[[ -n "${m7_app_sid}" && -n "${m7_app_cookie}" ]] || fail "M7: helper session non ha stampato la sessione dell'app"
code="$(call m7a GET /api/v1/me/sessions 198.51.100.208 -H "Cookie: fuorirotta.session_token=${m7_cookie}")"
[[ "${code}" == "200" ]] || fail "M7: elenco sessioni dal web: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/m7a.b" "j.sessions.filter((s) => s.device === 'App iPhone' && s.kind === 'phone').length")" == "1" ]] || fail "M7: l'elenco del web deve avere una riga 'App iPhone' (phone), corpo '$(cat "${tmp_dir}/m7a.b")'"
[[ "$(json_get "${tmp_dir}/m7a.b" "j.sessions.filter((s) => s.device === 'Chrome su Mac' && s.current).length")" == "1" ]] || fail "M7: la sessione del web deve restare 'Chrome su Mac' e corrente, corpo '$(cat "${tmp_dir}/m7a.b")'"
code="$(bearer_call m7b GET /api/v1/me/follows 198.51.100.208 "${m7_app_cookie}")"
[[ "${code}" == "200" ]] || fail "M7: il bearer dell'app prima della revoca: atteso 200, ottenuto ${code}"
code="$(call m7c DELETE "/api/v1/me/sessions/${m7_app_sid}" 198.51.100.208 -H "Cookie: fuorirotta.session_token=${m7_cookie}" -H "Origin: ${origin}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m7c.b" 'j.revoked')" == "1" ]] || fail "M7: revoca dal web: attesa 200 revoked 1, ottenuto ${code} '$(cat "${tmp_dir}/m7c.b")'"
code="$(bearer_call m7d GET /api/v1/me/follows 198.51.100.208 "${m7_app_cookie}")"
[[ "${code}" == "401" ]] || fail "M7: il bearer dell'app dopo la revoca: atteso 401, ottenuto ${code}"
echo "ok  M7: la sessione con lo user agent dell'app e' 'App iPhone' (phone) nell'elenco del web; DELETE dal web -> revoked 1 e il suo bearer da' 401"

# --- M8: D-10, uscire dall'app con il solo bearer chiude la sessione sul server ---------------------
mint_app_user m8 "${app_ua}"
code="$(bearer_call m8a POST /api/auth/sign-out 198.51.100.209 "${m8_cookie}" '{}')"
[[ "${code}" == "200" ]] || fail "M8: sign-out con il solo bearer: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/m8a.b"))"
[[ "$(psql_dev "SELECT count(*) FROM auth_session WHERE token = '${m8_token}'")" == "0" ]] || fail "M8: la riga auth_session deve sparire dopo il sign-out"
code="$(bearer_call m8b GET /api/v1/me/follows 198.51.100.209 "${m8_cookie}")"
[[ "${code}" == "401" ]] || fail "M8: lo stesso bearer dopo il sign-out: atteso 401, ottenuto ${code}"
echo "ok  M8: POST /api/auth/sign-out con il solo bearer (niente Cookie, niente Origin) -> 200, riga auth_session cancellata, il bearer da' 401"

# --- P1 (tracer): l'app registra il suo token con il solo bearer e compare una riga legata alla sessione ---
p1_tok_upper="FE$(printf '0A%.0s' {1..31})"
p1_tok="$(tr 'A-F' 'a-f' <<<"${p1_tok_upper}")"
mint_app_user p1 "${app_ua}"
p1_sid="$(psql_dev "SELECT id FROM auth_session WHERE token = '${p1_token}'" | head -n 1)"
[[ -n "${p1_sid}" ]] || fail "P1: sessione dell'app non trovata"
code="$(bearer_call p1a PUT /api/v1/me/devices 198.51.100.210 "${p1_cookie}" "{\"token\":\"${p1_tok_upper}\",\"environment\":\"sandbox\"}")"
[[ "${code}" == "200" && "$(cat "${tmp_dir}/p1a.b")" == '{"registered":true}' ]] || fail "P1: PUT devices col solo bearer: atteso 200 {\"registered\":true}, ottenuto ${code} '$(cat "${tmp_dir}/p1a.b")'"
no_store p1a P1
[[ "$(grep -ci "${p1_tok}" "${tmp_dir}/p1a.b" || true)" == "0" ]] || fail "P1: il token non deve tornare nel corpo"
p1_row="$(psql_dev "SELECT device_token || '|' || user_id || '|' || session_id || '|' || environment FROM push_devices WHERE device_token = '${p1_tok}'")"
[[ "${p1_row}" == "${p1_tok}|${p1_user}|${p1_sid}|sandbox" ]] || fail "P1: riga attesa '${p1_tok}|${p1_user}|${p1_sid}|sandbox', trovata '${p1_row}'"
[[ "$(psql_dev "SELECT count(*) FROM push_devices WHERE user_id = '${p1_user}'")" == "1" ]] || fail "P1: attesa una sola riga per l'utente"
p1_seen1="$(psql_dev "SELECT extract(epoch FROM last_seen_at) FROM push_devices WHERE device_token = '${p1_tok}'")"
sleep 1
code="$(bearer_call p1b PUT /api/v1/me/devices 198.51.100.210 "${p1_cookie}" "{\"token\":\"${p1_tok}\",\"environment\":\"sandbox\",\"appVersion\":\"1.0.1\"}")"
[[ "${code}" == "200" ]] || fail "P1: secondo PUT: atteso 200, ottenuto ${code}"
p1_row2="$(psql_dev "SELECT count(*) || '|' || app_version || '|' || (extract(epoch FROM last_seen_at) > ${p1_seen1}) FROM push_devices WHERE user_id = '${p1_user}' GROUP BY app_version, last_seen_at")"
[[ "${p1_row2}" == "1|1.0.1|true" ]] || fail "P1: dopo il secondo PUT attesa una riga con app_version 1.0.1 e last_seen_at avanzato, trovato '${p1_row2}'"
echo "ok  P1: PUT /me/devices col solo bearer -> 200 {registered:true} senza token nel corpo, una riga (token minuscolo, utente e sessione dell'app, sandbox); il secondo PUT la aggiorna (app_version, last_seen_at)"

# Token di prova di una sezione: 'fe' + 62 caratteri esadecimali, unico per (sezione, indice).
fe_tok() { # <cifra 0-9> <indice 0-99> -> 64 caratteri
  printf 'fe%02x%s' "$2" "$(printf "${1}c%.0s" {1..30})"
}
dev_rows() { psql_dev "SELECT count(*) FROM push_devices WHERE user_id = '$1'"; }
put_dev() { # <nome> <ip> <bearer> <token> [environment]
  bearer_call "$1" PUT /api/v1/me/devices "$2" "$3" "{\"token\":\"$4\",\"environment\":\"${5:-sandbox}\"}"
}
del_dev() { # <nome> <ip> <bearer> <token>
  bearer_call "$1" DELETE /api/v1/me/devices "$2" "$3" "{\"token\":\"$4\"}"
}

# --- P2: concorrenza (bordo API-03) -----------------------------------------------------
mint_app_user p2 "${app_ua}"
p2_tok="$(fe_tok 2 0)"
put_dev p2a 198.51.100.211 "${p2_cookie}" "${p2_tok}" >"${tmp_dir}/p2a.code" &
pid1=$!
put_dev p2b 198.51.100.211 "${p2_cookie}" "${p2_tok}" >"${tmp_dir}/p2b.code" &
pid2=$!
wait "${pid1}" "${pid2}"
[[ "$(cat "${tmp_dir}/p2a.code")" == "200" && "$(cat "${tmp_dir}/p2b.code")" == "200" ]] || fail "P2: due PUT dello stesso token: attesi 200 e 200, ottenuti $(cat "${tmp_dir}/p2a.code") e $(cat "${tmp_dir}/p2b.code")"
[[ "$(dev_rows "${p2_user}")" == "1" ]] || fail "P2: due PUT dello stesso token devono lasciare una riga"
echo "ok  P2: due PUT in parallelo dello stesso token -> 200 e 200 e una riga"

# --- P3: passaggio di proprieta' e DELETE ristretto al proprietario ----------------------------
mint_app_user p3a "${app_ua}"
mint_app_user p3b "${app_ua}"
p3_sid_b="$(psql_dev "SELECT id FROM auth_session WHERE token = '${p3b_token}'" | head -n 1)"
p3_tok="$(fe_tok 3 0)"
[[ "$(put_dev p3a1 198.51.100.212 "${p3a_cookie}" "${p3_tok}")" == "200" ]] || fail "P3: PUT di A"
[[ "$(put_dev p3b1 198.51.100.213 "${p3b_cookie}" "${p3_tok}" production)" == "200" ]] || fail "P3: PUT di B dello stesso token"
p3_row="$(psql_dev "SELECT count(*) || '|' || min(user_id) || '|' || min(session_id) || '|' || min(environment) FROM push_devices WHERE device_token = '${p3_tok}'")"
[[ "${p3_row}" == "1|${p3b_user}|${p3_sid_b}|production" ]] || fail "P3: una riga attesa di B, trovata '${p3_row}'"
code="$(del_dev p3a2 198.51.100.212 "${p3a_cookie}" "${p3_tok}")"
[[ "${code}" == "200" && "$(cat "${tmp_dir}/p3a2.b")" == '{"removed":0}' ]] || fail "P3: DELETE di A: atteso {\"removed\":0}, ottenuto ${code} '$(cat "${tmp_dir}/p3a2.b")'"
[[ "$(dev_rows "${p3b_user}")" == "1" ]] || fail "P3: il DELETE di A non doveva togliere la riga di B"
code="$(del_dev p3b2 198.51.100.213 "${p3b_cookie}" "${p3_tok}")"
[[ "${code}" == "200" && "$(cat "${tmp_dir}/p3b2.b")" == '{"removed":1}' ]] || fail "P3: DELETE di B: atteso {\"removed\":1}, ottenuto ${code} '$(cat "${tmp_dir}/p3b2.b")'"
code="$(del_dev p3b3 198.51.100.213 "${p3b_cookie}" "${p3_tok}")"
[[ "${code}" == "200" && "$(cat "${tmp_dir}/p3b3.b")" == '{"removed":0}' ]] || fail "P3: secondo DELETE di B: atteso {\"removed\":0}, ottenuto ${code} '$(cat "${tmp_dir}/p3b3.b")'"
[[ "$(psql_dev "SELECT count(*) FROM push_devices WHERE device_token = '${p3_tok}'")" == "0" ]] || fail "P3: la riga doveva sparire"
no_store p3b3 P3
echo "ok  P3: lo stesso token registrato da A e poi da B e' una riga di B (con la sua sessione e il suo ambiente); il DELETE di A -> removed 0 e la riga resta; quello di B -> removed 1, poi 0"

# --- P4: validazione e credenziali -------------------------------------------------------
mint_app_user p4 "${app_ua}"
p4_ok="$(fe_tok 4 0)"
p4_bad=0
p4_expect_400() { # <nome> <corpo> <descrizione>
  local code
  code="$(bearer_call "$1" PUT /api/v1/me/devices 198.51.100.214 "${p4_cookie}" "$2")"
  [[ "${code}" == "400" && "$(json_get "${tmp_dir}/$1.b" 'j.error')" == "bad-request" ]] || fail "P4: $3: atteso 400 bad-request, ottenuto ${code} '$(cat "${tmp_dir}/$1.b")'"
  no_store "$1" P4
  p4_bad=$((p4_bad + 1))
}
hex63="$(printf 'ab%.0s' {1..31})a"
hex201="$(printf 'ab%.0s' {1..100})a"
hex200="$(printf 'ab%.0s' {1..100})"
p4_expect_400 p4a "{\"token\":\"${hex63}\",\"environment\":\"sandbox\"}" "63 caratteri esadecimali"
p4_expect_400 p4b "{\"token\":\"${hex201}\",\"environment\":\"sandbox\"}" "201 caratteri esadecimali"
p4_expect_400 p4c "{\"token\":\"$(printf 'zz%.0s' {1..32})\",\"environment\":\"sandbox\"}" "token non esadecimale"
p4_expect_400 p4d '{"token":"ExponentPushToken[xxxx]","environment":"sandbox"}' "ExponentPushToken"
p4_expect_400 p4e "{\"token\":\"${p4_ok}\"}" "environment mancante"
p4_expect_400 p4f "{\"token\":\"${p4_ok}\",\"environment\":\"development\"}" "environment development"
p4_expect_400 p4g "{\"token\":\"${p4_ok}\",\"environment\":\"sandbox\",\"appVersion\":\"123456789012345678901\"}" "appVersion di 21 caratteri"
p4_expect_400 p4h "{\"token\":\"${p4_ok}\",\"environment\":\"sandbox\",\"appVersion\":\"1 0\"}" "appVersion con spazio"
p4_expect_400 p4i 'non-json' "corpo che non e' JSON"
p4_expect_400 p4j "[\"${p4_ok}\"]" "corpo array"
code="$(bearer_call p4k PUT "/api/v1/me/devices?token=${p4_ok}&environment=sandbox" 198.51.100.214 "${p4_cookie}" '{}')"
[[ "${code}" == "400" ]] || fail "P4: token solo nella query: atteso 400, ottenuto ${code}"
code="$(bearer_call p4l DELETE /api/v1/me/devices 198.51.100.214 "${p4_cookie}" '{"token":"nope"}')"
[[ "${code}" == "400" ]] || fail "P4: DELETE con token non valido: atteso 400, ottenuto ${code}"
# 200 e 64/200 caratteri passano (confini inclusi)
[[ "$(put_dev p4m 198.51.100.214 "${p4_cookie}" "${hex200}")" == "200" ]] || fail "P4: 200 caratteri esadecimali devono passare"
[[ "$(put_dev p4n 198.51.100.214 "${p4_cookie}" "${p4_ok}")" == "200" ]] || fail "P4: 64 caratteri esadecimali devono passare"
[[ "$(dev_rows "${p4_user}")" == "2" ]] || fail "P4: i rifiuti non devono scrivere: attese 2 righe (i due PUT validi), trovate $(dev_rows "${p4_user}")"
body_ok="{\"token\":\"${p4_ok}\",\"environment\":\"sandbox\"}"
code="$(call p4o PUT /api/v1/me/devices 198.51.100.215 -H "Origin: ${origin}" -H 'Content-Type: application/json' --data "${body_ok}")"
[[ "${code}" == "401" ]] || fail "P4: senza credenziali con Origin: atteso 401, ottenuto ${code}"
code="$(call p4p PUT /api/v1/me/devices 198.51.100.215 -H 'Content-Type: application/json' --data "${body_ok}")"
[[ "${code}" == "403" ]] || fail "P4: senza credenziali e senza Origin: atteso 403, ottenuto ${code}"
no_store p4o P4
no_store p4p P4
echo "ok  P4: ${p4_bad} corpi non validi (63/201 caratteri, non esadecimale, Expo, environment mancante o development, appVersion lunga o con spazio, non JSON, array, token solo in query) -> 400 bad-request senza scritture; 64 e 200 caratteri passano; senza credenziali 401 con Origin e 403 senza"

# --- P5: tetto di 10 dispositivi per utente ---------------------------------------------------
mint_app_user p5 "${app_ua}"
p5_sid="$(psql_dev "SELECT id FROM auth_session WHERE token = '${p5_token}'" | head -n 1)"
for n in 1 2 3 4 5 6 7 8 9 10; do
  psql_dev "INSERT INTO push_devices (user_id, session_id, device_token, environment, last_seen_at)
    VALUES ('${p5_user}', '${p5_sid}', '$(fe_tok 5 "${n}")', 'sandbox', now() - interval '${n} minutes')" >/dev/null
done
code="$(put_dev p5 198.51.100.216 "${p5_cookie}" "$(fe_tok 5 11)")"
[[ "${code}" == "200" ]] || fail "P5: l'undicesimo PUT: atteso 200, ottenuto ${code}"
[[ "$(dev_rows "${p5_user}")" == "10" ]] || fail "P5: dopo l'undicesimo restano 10 righe, trovate $(dev_rows "${p5_user}")"
[[ "$(psql_dev "SELECT count(*) FROM push_devices WHERE device_token = '$(fe_tok 5 10)'")" == "0" ]] || fail "P5: doveva sparire la riga meno recente (last_seen_at piu' vecchio)"
[[ "$(psql_dev "SELECT count(*) FROM push_devices WHERE device_token = '$(fe_tok 5 11)'")" == "1" ]] || fail "P5: la riga appena registrata deve restare"
echo "ok  P5: con 10 dispositivi l'undicesimo PUT -> 200, ne restano 10 e quello visto meno di recente e' sparito"

# --- P6: D-10, il dispositivo non sopravvive alla sessione che lo ha registrato ------------------------
mint_app_user p6 "${chrome_ua}"
read -r p6_app_sid p6_app_cookie _ <<<"$(helper session "${p6_user}" 0 "${app_ua}" | tail -n 1)"
[[ -n "${p6_app_sid}" && -n "${p6_app_cookie}" ]] || fail "P6: helper session non ha stampato la sessione dell'app"
p6_tok="$(fe_tok 6 0)"
[[ "$(put_dev p6a 198.51.100.217 "${p6_app_cookie}" "${p6_tok}")" == "200" ]] || fail "P6: PUT dall'app"
[[ "$(dev_rows "${p6_user}")" == "1" ]] || fail "P6: attesa una riga prima della revoca"
code="$(call p6b DELETE "/api/v1/me/sessions/${p6_app_sid}" 198.51.100.217 -H "Cookie: fuorirotta.session_token=${p6_cookie}" -H "Origin: ${origin}")"
[[ "${code}" == "200" ]] || fail "P6: revoca dal web: atteso 200, ottenuto ${code}"
[[ "$(dev_rows "${p6_user}")" == "0" ]] || fail "P6: la revoca della sessione dal web deve togliere il dispositivo"
read -r _ p6_app_cookie2 _ <<<"$(helper session "${p6_user}" 0 "${app_ua}" | tail -n 1)"
[[ "$(put_dev p6c 198.51.100.217 "${p6_app_cookie2}" "${p6_tok}")" == "200" ]] || fail "P6: PUT dalla nuova sessione dell'app"
[[ "$(dev_rows "${p6_user}")" == "1" ]] || fail "P6: attesa una riga dopo la nuova registrazione"
code="$(bearer_call p6d POST /api/auth/sign-out 198.51.100.217 "${p6_app_cookie2}" '{}')"
[[ "${code}" == "200" ]] || fail "P6: sign-out col solo bearer: atteso 200, ottenuto ${code}"
[[ "$(dev_rows "${p6_user}")" == "0" ]] || fail "P6: il sign-out col bearer deve togliere il dispositivo"
read -r _ p6_app_cookie3 _ <<<"$(helper session "${p6_user}" 0 "${app_ua}" | tail -n 1)"
[[ "$(put_dev p6e 198.51.100.217 "${p6_app_cookie3}" "${p6_tok}")" == "200" ]] || fail "P6: PUT dalla terza sessione dell'app"
[[ "$(dev_rows "${p6_user}")" == "1" ]] || fail "P6: attesa una riga prima della cancellazione dell'account"
psql_dev "DELETE FROM auth_user WHERE id = '${p6_user}'" >/dev/null
[[ "$(psql_dev "SELECT count(*) FROM push_devices WHERE device_token = '${p6_tok}'")" == "0" ]] || fail "P6: la cancellazione dell'account deve togliere il dispositivo"
echo "ok  P6: revoca della sessione dal web, sign-out col solo bearer e cancellazione dell'account lasciano zero righe push_devices per quel dispositivo"

# --- P7: l'export elenca i dispositivi senza il token --------------------------------------------------
mint_app_user p7 "${app_ua}"
p7_tok="$(fe_tok 7 0)"
[[ "$(put_dev p7a 198.51.100.218 "${p7_cookie}" "${p7_tok}" production)" == "200" ]] || fail "P7: PUT dall'app"
code="$(call p7b GET /api/v1/me/export 198.51.100.218 -H "Cookie: fuorirotta.session_token=${p7_cookie}")"
[[ "${code}" == "200" ]] || fail "P7: export: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/p7b.b" 'j.pushDevices.length + "|" + Object.keys(j.pushDevices[0]).sort().join() + "|" + j.pushDevices[0].environment')" == "1|appVersion,createdAt,environment,lastSeenAt|production" ]] \
  || fail "P7: pushDevices inattesi: $(json_get "${tmp_dir}/p7b.b" 'j.pushDevices')"
[[ "$(grep -ci "${p7_tok}" "${tmp_dir}/p7b.b" || true)" == "0" ]] || fail "P7: il token del dispositivo non deve comparire nell'export"
echo "ok  P7: l'export ha pushDevices con un oggetto {appVersion, createdAt, environment, lastSeenAt} e il token non compare da nessuna parte"
