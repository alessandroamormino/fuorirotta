#!/usr/bin/env bash
# Gate dei follow (check:follows-flow, test:local): dev server effimero sul
# Postgres LOCALE (scripts/dev-db.sh, mai produzione), con le variabili di
# accesso passate ESPLICITE e valori finti, come scripts/saved-flow.test.sh.
# A differenza di quello, qui anche NEXT_PUBLIC_AUTH_ENABLED=true e' esplicito:
# il bottone Segui non viene reso senza il flag di build, e Next altrimenti
# prenderebbe quello che dice .env.local. Gli utenti (e-mail @fixture.invalid)
# nascono con scripts/auth-flow.helper.ts e si cancellano a inizio e fine giro:
# la cascata porta via i loro follow.
#
# Sezioni:
#   S1  utente nuovo: GET /api/v1/me/follows -> 200 {onboarded:false, follows:[]}, private, no-store
#   S2  PUT {region, lombardia} con Origin e cookie -> 200 followed true, label Lombardia e UNA
#       riga; secondo PUT -> ancora una riga; due PUT in parallelo su toscana -> una riga
#   S3  una seconda sessione dello stesso utente: GET elenca lombardia e toscana
#   S4  DELETE lombardia -> removed 1, di nuovo -> removed 0
#   S5  GET /lombardia con e senza cookie: aria-label "Segui Lombardia" e aria-pressed="false",
#       mai aria-pressed="true" (l'HTML del server e' lo stesso per tutti)
#   S6  validazione: forma sbagliata o corpo non JSON -> 400; comune/provincia ben formati ma ignoti
#       (o abolita, OT) -> 404; comune 016024 -> label 'Bergamo (BG)', provincia BG -> 'Provincia di
#       Bergamo', categoria Altro -> 200; GET elenca le etichette del server; tutto private, no-store
#   S7  tetto: 49 luoghi per INSERT ... SELECT, il 50o (016024) -> 200, il 51o (regione) -> 409 cap e
#       50 righe, 016024 di nuovo -> 200, categoria -> 200 (esente); un comune sparito dai comuni
#       si legge 'Comune non più disponibile'
#   S8  DELETE di un altro utente su un follow di u1 -> 200 removed 0 e la riga resta; PUT senza Origin
#       -> 403, senza cookie -> 401, GET senza cookie -> 401, tutto private, no-store
#   H1  GET /lombardia/bergamo con e senza cookie: aria-label "Segui provincia di Bergamo", aria-pressed="false", mai "true"
#   H2  PUT {province, BG} con un utente nuovo -> 200 label 'Provincia di Bergamo' e GET la elenca
#   S9  server riavviato con AUTH_ENABLED=false: GET e PUT con cookie -> 404 private, no-store;
#       GET /api/v1/me/state -> {"enabled":false,"user":null}
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il dev server dello sviluppatore.
port="${FOLLOWS_FLOW_TEST_PORT:-39888}"
base_url="http://localhost:${port}"
origin="${base_url}"

test_dist_dir=".next-follows-flow-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti, ma di forma valida: il segreto ha 40 caratteri (minimo 32).
auth_env=(
  AUTH_ENABLED=true
  NEXT_PUBLIC_AUTH_ENABLED=true
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=follows-flow-test-secret-0123456789abcdef"
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

# Gli utenti di prova @fixture.invalid: la FK in cascata porta via user_follows.
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

# call <nome> <metodo> <percorso> [argomenti curl...]
# Scrive ${tmp_dir}/<nome>.h (header) e <nome>.b (corpo); stampa il codice HTTP.
# La prima compilazione di una rotta e' lenta: --max-time 120.
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
  read -r uid cookie _ <<<"$(helper mint "${prefix}-follows@fixture.invalid" "Prova ${prefix}" 0 | tail -n 1)"
  [[ -n "${uid}" && -n "${cookie}" ]] || fail "helper mint non ha stampato utente e cookie per ${prefix}"
  printf -v "${prefix}_user" '%s' "${uid}"
  printf -v "${prefix}_cookie" '%s' "Cookie: fuorirotta.session_token=${cookie}"
}

follow_rows() { # <utente> <kind> <key> -> numero di righe
  psql_dev "SELECT count(*) FROM user_follows WHERE user_id = '$1' AND kind = '$2' AND key = '$3'"
}
put() { # <nome> <kind> <key> <cookie>
  call "$1" PUT /api/v1/me/follows -H "Origin: ${origin}" -H "$4" -H 'Content-Type: application/json' --data "{\"kind\":\"$2\",\"key\":\"$3\"}"
}
del() { # <nome> <kind> <key> <cookie>
  call "$1" DELETE /api/v1/me/follows -H "Origin: ${origin}" -H "$4" -H 'Content-Type: application/json' --data "{\"kind\":\"$2\",\"key\":\"$3\"}"
}
get_follows() { call "$1" GET /api/v1/me/follows -H "$2"; }

no_store() { # <nome-file> <sezione>
  local cc
  cc="$(grep -i '^cache-control:' "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r')"
  [[ "${cc}" == "private, no-store" ]] || fail "$2: cache-control atteso 'private, no-store' su $1, ottenuto '${cc}'"
}

mint_user u1

# --- S1: utente nuovo, nessun follow, nessuna cache condivisa -----------------
code="$(get_follows s1 "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "S1: GET follows: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s1.b"))"
[[ "$(json_get "${tmp_dir}/s1.b" 'JSON.stringify(j)')" == '{"onboarded":false,"follows":[]}' ]] || fail "S1: corpo atteso {onboarded:false,follows:[]}, ottenuto '$(cat "${tmp_dir}/s1.b")'"
cc="$(grep -i '^cache-control:' "${tmp_dir}/s1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r')"
[[ "${cc}" == "private, no-store" ]] || fail "S1: cache-control atteso 'private, no-store', ottenuto '${cc}'"
echo "ok  S1: utente nuovo -> 200 {onboarded:false, follows:[]}, private, no-store"

# --- S2: segui, idempotente e sicuro in parallelo ------------------------------
code="$(put s2 region lombardia "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "S2: PUT lombardia: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s2.b"))"
[[ "$(json_get "${tmp_dir}/s2.b" 'j.followed + "|" + j.label')" == "true|Lombardia" ]] || fail "S2: attesi followed true e label Lombardia, corpo '$(cat "${tmp_dir}/s2.b")'"
[[ "$(follow_rows "${u1_user}" region lombardia)" == "1" ]] || fail "S2: attesa una riga per lombardia"
code="$(put s2b region lombardia "${u1_cookie}")"
[[ "${code}" == "200" && "$(follow_rows "${u1_user}" region lombardia)" == "1" ]] || fail "S2: il secondo PUT deve dare 200 e lasciare una riga"
put s2p1 region toscana "${u1_cookie}" >"${tmp_dir}/s2p1.code" &
pid1=$!
put s2p2 region toscana "${u1_cookie}" >"${tmp_dir}/s2p2.code" &
pid2=$!
wait "${pid1}" "${pid2}"
[[ "$(cat "${tmp_dir}/s2p1.code")" == "200" && "$(cat "${tmp_dir}/s2p2.code")" == "200" ]] || fail "S2: due PUT in parallelo su toscana: attesi 200 e 200, ottenuti $(cat "${tmp_dir}/s2p1.code") e $(cat "${tmp_dir}/s2p2.code")"
[[ "$(follow_rows "${u1_user}" region toscana)" == "1" ]] || fail "S2: due PUT in parallelo su toscana devono lasciare una riga"
echo "ok  S2: PUT lombardia -> 200 label Lombardia e una riga; secondo PUT -> una riga; due PUT in parallelo su toscana -> una riga"

# --- S3: la stessa lista da un'altra sessione ----------------------------------
read -r _ s3_cookie _ <<<"$(helper session "${u1_user}" 0 | tail -n 1)"
[[ -n "${s3_cookie}" ]] || fail "S3: helper session non ha stampato il cookie"
code="$(get_follows s3 "Cookie: fuorirotta.session_token=${s3_cookie}")"
[[ "${code}" == "200" ]] || fail "S3: GET dalla seconda sessione: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/s3.b" 'j.follows.map((f) => f.kind + ":" + f.key).sort().join()')" == "region:lombardia,region:toscana" ]] || fail "S3: attesi lombardia e toscana, corpo '$(cat "${tmp_dir}/s3.b")'"
echo "ok  S3: una seconda sessione dello stesso utente elenca lombardia e toscana"

# --- S4: smetti di seguire, due volte non e' un errore ---------------------------
code="$(del s4 region lombardia "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/s4.b" 'j.removed')" == "1" ]] || fail "S4: DELETE lombardia: atteso 200 removed 1, ottenuto ${code} '$(cat "${tmp_dir}/s4.b")'"
code="$(del s4b region lombardia "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/s4b.b" 'j.removed')" == "0" ]] || fail "S4: secondo DELETE: atteso 200 removed 0, ottenuto ${code} '$(cat "${tmp_dir}/s4b.b")'"
[[ "$(follow_rows "${u1_user}" region lombardia)" == "0" && "$(follow_rows "${u1_user}" region toscana)" == "1" ]] || fail "S4: deve sparire solo lombardia"
echo "ok  S4: DELETE lombardia -> removed 1, di nuovo -> removed 0, toscana resta"

# --- S5: l'HTML del server e' la pillola non seguita, per tutti ----------------
for who in anon session; do
  if [[ "${who}" == "anon" ]]; then code="$(call "s5${who}" GET /lombardia)"; else code="$(call "s5${who}" GET /lombardia -H "${u1_cookie}")"; fi
  [[ "${code}" == "200" ]] || fail "S5 (${who}): GET /lombardia: atteso 200, ottenuto ${code}"
  grep -q 'aria-label="Segui Lombardia"' "${tmp_dir}/s5${who}.b" || fail "S5 (${who}): manca aria-label=\"Segui Lombardia\" (regione non coperta in locale?)"
  grep -q 'aria-pressed="false"' "${tmp_dir}/s5${who}.b" || fail "S5 (${who}): manca aria-pressed=\"false\""
  if grep -q 'aria-pressed="true"' "${tmp_dir}/s5${who}.b"; then fail "S5 (${who}): il server non puo' rendere un bottone seguito"; fi
done
echo "ok  S5: /lombardia con e senza sessione contiene 'Segui Lombardia' con aria-pressed=\"false\", mai \"true\""


# --- S6: validazione, esistenza, etichette del server --------------------------
for bad in "hacker|lombardia" "region|atlantide" "comune|12345" "province|bg" "category|Hacker"; do
  code="$(put s6bad "${bad%%|*}" "${bad##*|}" "${u1_cookie}")"
  [[ "${code}" == "400" ]] || fail "S6: ${bad}: atteso 400, ottenuto ${code} ($(cat "${tmp_dir}/s6bad.b"))"
  no_store s6bad S6
done
code="$(call s6json PUT /api/v1/me/follows -H "Origin: ${origin}" -H "${u1_cookie}" -H 'Content-Type: application/json' --data 'non json')"
[[ "${code}" == "400" ]] || fail "S6: corpo non JSON: atteso 400, ottenuto ${code}"
for unk in "comune|999999" "province|ZZ" "province|OT"; do
  code="$(put s6unk "${unk%%|*}" "${unk##*|}" "${u1_cookie}")"
  [[ "${code}" == "404" && "$(json_get "${tmp_dir}/s6unk.b" 'j.error')" == "not-found" ]] || fail "S6: ${unk}: atteso 404 not-found, ottenuto ${code} ($(cat "${tmp_dir}/s6unk.b"))"
  no_store s6unk S6
done
for ok in "comune|016024|Bergamo (BG)" "province|BG|Provincia di Bergamo" "category|Altro|Altro"; do
  IFS='|' read -r k v want <<<"${ok}"
  code="$(put s6ok "${k}" "${v}" "${u1_cookie}")"
  [[ "${code}" == "200" && "$(json_get "${tmp_dir}/s6ok.b" 'j.label')" == "${want}" ]] || fail "S6: ${k} ${v}: atteso 200 label '${want}', ottenuto ${code} ($(cat "${tmp_dir}/s6ok.b"))"
  no_store s6ok S6
done
get_follows s6get "${u1_cookie}" >/dev/null
no_store s6get S6
labels="$(json_get "${tmp_dir}/s6get.b" 'j.follows.map((f) => f.label).join("|")')"
[[ "${labels}" == *"Bergamo (BG)"* && "${labels}" == *"Provincia di Bergamo"* ]] || fail "S6: GET deve elencare le etichette del server, ottenuto '${labels}'"
[[ "$(psql_dev "SELECT count(*) FROM user_follows WHERE user_id = '${u1_user}' AND (key IN ('atlantide','12345','bg','Hacker','999999','ZZ','OT') OR kind = 'hacker')")" == "0" ]] || fail "S6: una richiesta rifiutata ha scritto una riga"
echo "ok  S6: forma sbagliata -> 400, ignoti -> 404, 016024 'Bergamo (BG)', BG 'Provincia di Bergamo', GET con le etichette del server, private, no-store"

# --- S7: tetto dei 50 luoghi ----------------------------------------------------
mint_user u2
psql_dev "INSERT INTO user_follows (user_id, kind, key) SELECT '${u2_user}', 'comune', istat_code FROM comuni WHERE istat_code <> '016024' ORDER BY istat_code LIMIT 49" >/dev/null
[[ "$(psql_dev "SELECT count(*) FROM user_follows WHERE user_id = '${u2_user}'")" == "49" ]] || fail "S7: fixture attesa di 49 righe (comuni nel DB locale?)"
code="$(put s7a comune 016024 "${u2_cookie}")"
[[ "${code}" == "200" ]] || fail "S7: il 50o luogo: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s7a.b"))"
code="$(put s7b region lombardia "${u2_cookie}")"
[[ "${code}" == "409" && "$(json_get "${tmp_dir}/s7b.b" 'j.error')" == "cap" ]] || fail "S7: il 51o luogo: atteso 409 cap, ottenuto ${code} ($(cat "${tmp_dir}/s7b.b"))"
no_store s7b S7
[[ "$(psql_dev "SELECT count(*) FROM user_follows WHERE user_id = '${u2_user}' AND kind <> 'category'")" == "50" ]] || fail "S7: dopo il 409 devono restare 50 luoghi"
code="$(put s7c comune 016024 "${u2_cookie}")"
[[ "${code}" == "200" ]] || fail "S7: luogo gia' seguito al tetto: atteso 200, ottenuto ${code}"
code="$(put s7d category Altro "${u2_cookie}")"
[[ "${code}" == "200" ]] || fail "S7: le categorie sono esenti dal tetto: atteso 200, ottenuto ${code}"
psql_dev "INSERT INTO user_follows (user_id, kind, key) VALUES ('${u2_user}', 'comune', '000000')" >/dev/null
get_follows s7get "${u2_cookie}" >/dev/null
[[ "$(json_get "${tmp_dir}/s7get.b" 'j.follows.filter((f) => f.key === "000000").map((f) => f.label).join()')" == "Comune non più disponibile" ]] || fail "S7: un comune sparito deve leggersi 'Comune non più disponibile'"
echo "ok  S7: 50o -> 200, 51o -> 409 cap con 50 luoghi, gia' seguito -> 200, categoria esente, comune sparito etichettato"


# --- S8: la cancellazione e' dell'utente della sessione; Origin e sessione ------
code="$(del s8 region toscana "${u2_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/s8.b" 'j.removed')" == "0" ]] || fail "S8: DELETE di un altro utente: atteso 200 removed 0, ottenuto ${code} '$(cat "${tmp_dir}/s8.b")'"
no_store s8 S8
[[ "$(follow_rows "${u1_user}" region toscana)" == "1" ]] || fail "S8: il DELETE di un altro utente ha tolto la riga di u1"
code="$(call s8a PUT /api/v1/me/follows -H "${u1_cookie}" -H 'Content-Type: application/json' --data '{"kind":"region","key":"lombardia"}')"
[[ "${code}" == "403" ]] || fail "S8: PUT senza Origin: atteso 403, ottenuto ${code}"
no_store s8a S8
code="$(call s8b PUT /api/v1/me/follows -H "Origin: ${origin}" -H 'Content-Type: application/json' --data '{"kind":"region","key":"lombardia"}')"
[[ "${code}" == "401" ]] || fail "S8: PUT senza cookie: atteso 401, ottenuto ${code}"
no_store s8b S8
code="$(call s8c GET /api/v1/me/follows)"
[[ "${code}" == "401" ]] || fail "S8: GET senza cookie: atteso 401, ottenuto ${code}"
no_store s8c S8
[[ "$(follow_rows "${u1_user}" region lombardia)" == "0" ]] || fail "S8: una richiesta rifiutata ha scritto una riga"
echo "ok  S8: DELETE di un altro utente -> removed 0 e la riga resta; PUT senza Origin 403, senza cookie 401, GET senza cookie 401, private, no-store"

# --- H1: la provincia si segue dalla sua pagina; HTML del server uguale per tutti --
for who in anon session; do
  if [[ "${who}" == "anon" ]]; then code="$(call "h1${who}" GET /lombardia/bergamo)"; else code="$(call "h1${who}" GET /lombardia/bergamo -H "${u1_cookie}")"; fi
  [[ "${code}" == "200" ]] || fail "H1 (${who}): GET /lombardia/bergamo: atteso 200, ottenuto ${code}"
  grep -q 'aria-label="Segui provincia di Bergamo"' "${tmp_dir}/h1${who}.b" || fail "H1 (${who}): manca aria-label=\"Segui provincia di Bergamo\" (BG non e' il ramo live in locale? aveva 25 eventi futuri il 2026-10-23)"
  grep -q 'aria-pressed="false"' "${tmp_dir}/h1${who}.b" || fail "H1 (${who}): manca aria-pressed=\"false\""
  if grep -q 'aria-pressed="true"' "${tmp_dir}/h1${who}.b"; then fail "H1 (${who}): il server non puo' rendere un bottone seguito"; fi
done
echo "ok  H1: /lombardia/bergamo con e senza sessione contiene 'Segui provincia di Bergamo' con aria-pressed=\"false\", mai \"true\""

# --- H2: PUT della provincia con un utente nuovo -> etichetta del server e GET --
mint_user h2
code="$(put h2p province BG "${h2_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/h2p.b" 'j.label')" == "Provincia di Bergamo" ]] || fail "H2: PUT BG: atteso 200 label 'Provincia di Bergamo', ottenuto ${code} ($(cat "${tmp_dir}/h2p.b"))"
get_follows h2g "${h2_cookie}" >/dev/null
[[ "$(json_get "${tmp_dir}/h2g.b" 'j.follows.map((f) => f.kind + ":" + f.key + ":" + f.label).join()')" == "province:BG:Provincia di Bergamo" ]] || fail "H2: GET deve elencare la provincia BG, corpo '$(cat "${tmp_dir}/h2g.b")'"
echo "ok  H2: PUT province BG -> 200 'Provincia di Bergamo' e GET la elenca"

# --- S9: con l'accesso spento (a runtime) l'API non esiste piu' -----------------
stop_server
bash scripts/dev-db.sh env "${auth_env[@]}" AUTH_ENABLED=false npx next dev -p "${port}" >"${tmp_dir}/dev-server-off.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
code="$(get_follows s9g "${u1_cookie}")"
[[ "${code}" == "404" ]] || fail "S9: GET con accesso spento: atteso 404, ottenuto ${code}"
no_store s9g S9
code="$(put s9p region lombardia "${u1_cookie}")"
[[ "${code}" == "404" ]] || fail "S9: PUT con accesso spento: atteso 404, ottenuto ${code}"
no_store s9p S9
code="$(call s9s GET /api/v1/me/state -H "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/s9s.b" 'JSON.stringify(j)')" == '{"enabled":false,"user":null}' ]] || fail "S9: state con accesso spento: atteso {enabled:false,user:null}, ottenuto ${code} '$(cat "${tmp_dir}/s9s.b")'"
echo "ok  S9: accesso spento -> GET e PUT 404 private, no-store; state {enabled:false,user:null}"

echo "Riepilogo: S1-S9 e H1-H2 verdi"
