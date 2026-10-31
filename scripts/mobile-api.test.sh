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
  local who="$1" s="$2" sid_var="m2${1}_sid" gone_var="m2${1}_gone"
  s="${s//\[eventId\]/${m2_ev}}"
  s="${s//\[ref\]/${!gone_var}}"
  s="${s//\[id\]/${!sid_var}}"
  s="${s//\{ev\}/${m2_ev}}"
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
