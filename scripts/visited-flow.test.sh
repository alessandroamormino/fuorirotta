#!/usr/bin/env bash
# Gate di "Ci sono stato" (check:visited-flow, test:local): dev server effimero
# sul Postgres LOCALE (scripts/dev-db.sh, mai produzione), con le variabili di
# accesso passate ESPLICITE e valori finti, come scripts/saved-flow.test.sh.
# Utenti creati con scripts/auth-flow.helper.ts (e-mail @fixture.invalid,
# cancellati a fine prova: la cascata porta via i visited_events).
#
# Sezioni:
#   V1  evento iniziato ieri e in corso fino a domani -> PUT 200 e UNA riga con visit_day = oggi a Roma (D-05)
#   V2  evento di tre giorni finito 10 giorni fa -> PUT 200 e visit_day = il suo primo giorno (D-05)
#   V3  evento che inizia fra due giorni -> 409 {error:'too-early'} e zero righe (D-02)
#   V4  secondo PUT su V1 -> 200, una riga, visit_day invariato; due PUT in parallelo su un evento fresco -> una riga
#   V5  riga su A e riga a mano sul membro M: DELETE A -> removed 2, zero righe su A e M; di nuovo -> removed 0
#   V6  PUT senza Origin -> 403, senza cookie -> 401, id 'abc' / 1234567890 / 999999999 -> 404, sempre private, no-store
#   V7  DELETE A di un altro utente mentre u1 ha una riga su A -> 200 removed 0, la riga di u1 resta
#   V8  499 righe: PUT A -> 200 (la 500a), PUT C -> 409 {error:'cap'}, PUT A di nuovo -> 200 (D-07)
#   V9  D-04: DELETE visited non toglie il salvato, DELETE saved non toglie il visitato
#
# Righe di prova sotto il `source` dedicato '__visited_gate__': cancellate prima
# e all'uscita, nessuna riga reale viene letta o toccata.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il dev server dello sviluppatore.
port="${VISITED_FLOW_TEST_PORT:-39896}"
base_url="http://localhost:${port}"
origin="${base_url}"

test_dist_dir=".next-visited-flow-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
test_source="__visited_gate__"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti, ma di forma valida: il segreto ha 40 caratteri (minimo 32).
auth_env=(
  AUTH_ENABLED=true
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=visited-flow-test-secret-0123456789abcd"
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
  psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null 2>&1 || true
}

# Gli utenti di prova @fixture.invalid: la FK in cascata porta via saved_events e visited_events.
delete_users() {
  psql_dev "DELETE FROM auth_user WHERE email LIKE '%@fixture.invalid'" >/dev/null 2>&1 || true
}

cleanup() {
  stop_server
  delete_users
  delete_fixtures
  rm -rf "${tmp_dir:?}"
  rm -rf "${repo_root:?}/${test_dist_dir:?}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Parte pulita: righe di un giro interrotto.
delete_users
delete_fixtures

# --- Fixture -----------------------------------------------------------------
# Le date sono a mezzogiorno UTC (stesso giorno a Roma in ogni stagione), cosi'
# il confronto con "oggi a Roma" non dipende dall'ora a cui gira il gate.
insert_event() {
  # insert_event <source_id> <titolo> <date_start> <date_end> <canonical_event_id|NULL> -> id
  psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, canonical_event_id) VALUES ('${test_source}', '$1', '$2', $3, $4, $5) RETURNING id" | head -n 1
}
noon() { echo "date_trunc('day', now()) + interval '12 hours' + interval '$1 days'"; }
day_str() { psql_dev "SELECT to_char(date_trunc('day', now()) + interval '$1 days', 'YYYY-MM-DD')" | head -n 1; }

a_id="$(insert_event gate-a 'Visita A' "$(noon -1)" "$(noon 1)" NULL)"
m_id="$(insert_event gate-m 'Visita M' "$(noon -1)" "$(noon 1)" "${a_id}")"
b_id="$(insert_event gate-b 'Visita B' "$(noon -1)" "$(noon 1)" NULL)"
c_id="$(insert_event gate-c 'Visita C' "$(noon -1)" "$(noon 1)" NULL)"
p_id="$(insert_event gate-p 'Visita P' "$(noon -12)" "$(noon -10)" NULL)"
f_id="$(insert_event gate-f 'Visita F' "$(noon 2)" "$(noon 3)" NULL)"
[[ -n "${a_id}" && -n "${m_id}" && -n "${b_id}" && -n "${c_id}" && -n "${p_id}" && -n "${f_id}" ]] || fail "fixture non create"
p_first_day="$(day_str -12)"
rome_today="$(TZ=Europe/Rome date +%F)"
echo "ok  fixture create: A=${a_id} M=${m_id} (membro di A) B=${b_id} C=${c_id} P=${p_id} (finito) F=${f_id} (futuro), oggi a Roma ${rome_today}"

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
  read -r uid cookie _ <<<"$(helper mint "${prefix}-visited@fixture.invalid" "Prova ${prefix}" 0 | tail -n 1)"
  [[ -n "${uid}" && -n "${cookie}" ]] || fail "helper mint non ha stampato utente e cookie per ${prefix}"
  printf -v "${prefix}_user" '%s' "${uid}"
  printf -v "${prefix}_cookie" '%s' "Cookie: fuorirotta.session_token=${cookie}"
}
visited_rows() { # <utente> <event_id> -> numero di righe
  psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '$1' AND event_id = $2"
}
visit_day_of() { # <utente> <event_id> -> visit_day
  psql_dev "SELECT to_char(visit_day, 'YYYY-MM-DD') FROM visited_events WHERE user_id = '$1' AND event_id = $2"
}
put() { call "$1" PUT "/api/v1/me/visited/$2" -H "Origin: ${origin}" -H "$3"; }
del() { call "$1" DELETE "/api/v1/me/visited/$2" -H "Origin: ${origin}" -H "$3"; }

mint_user u1

# --- V1: evento in corso -> visit_day = oggi a Roma ----------------------------
code="$(put v1 "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "V1: PUT A: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/v1.b"))"
[[ "$(visited_rows "${u1_user}" "${a_id}")" == "1" ]] || fail "V1: attesa una riga per A"
[[ "$(visit_day_of "${u1_user}" "${a_id}")" == "${rome_today}" ]] || fail "V1: visit_day atteso ${rome_today}, ottenuto '$(visit_day_of "${u1_user}" "${a_id}")'"
[[ "$(json_get "${tmp_dir}/v1.b" 'j.visitDay')" == "${rome_today}" ]] || fail "V1: il corpo deve riportare visitDay ${rome_today}, corpo '$(cat "${tmp_dir}/v1.b")'"
echo "ok  V1: PUT A in corso -> 200, una riga, visit_day = oggi a Roma (${rome_today})"

# --- V2: evento finito -> visit_day = il primo giorno ---------------------------
code="$(put v2 "${p_id}" "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "V2: PUT P: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/v2.b"))"
[[ "$(visit_day_of "${u1_user}" "${p_id}")" == "${p_first_day}" ]] || fail "V2: visit_day atteso ${p_first_day}, ottenuto '$(visit_day_of "${u1_user}" "${p_id}")'"
echo "ok  V2: PUT P finito -> 200, visit_day = il suo primo giorno (${p_first_day})"

# --- V3: evento non ancora iniziato -> 409 too-early, nessuna riga --------------
code="$(put v3 "${f_id}" "${u1_cookie}")"
[[ "${code}" == "409" && "$(json_get "${tmp_dir}/v3.b" 'j.error')" == "too-early" ]] || fail "V3: PUT F: atteso 409 too-early, ottenuto ${code} '$(cat "${tmp_dir}/v3.b")'"
[[ "$(visited_rows "${u1_user}" "${f_id}")" == "0" ]] || fail "V3: un evento futuro ha scritto una riga"
echo "ok  V3: PUT F futuro -> 409 too-early, zero righe"

# --- V4: idempotente, il giorno non cambia, sicuro in parallelo ----------------
code="$(put v4 "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "V4: secondo PUT A: atteso 200, ottenuto ${code}"
[[ "$(visited_rows "${u1_user}" "${a_id}")" == "1" && "$(visit_day_of "${u1_user}" "${a_id}")" == "${rome_today}" ]] || fail "V4: dopo il secondo PUT una riga con visit_day invariato"
put v4p1 "${b_id}" "${u1_cookie}" >"${tmp_dir}/v4p1.code" &
pid1=$!
put v4p2 "${b_id}" "${u1_cookie}" >"${tmp_dir}/v4p2.code" &
pid2=$!
wait "${pid1}" "${pid2}"
[[ "$(cat "${tmp_dir}/v4p1.code")" == "200" && "$(cat "${tmp_dir}/v4p2.code")" == "200" ]] || fail "V4: due PUT in parallelo su B: attesi 200 e 200, ottenuti $(cat "${tmp_dir}/v4p1.code") e $(cat "${tmp_dir}/v4p2.code")"
[[ "$(visited_rows "${u1_user}" "${b_id}")" == "1" ]] || fail "V4: due PUT in parallelo su B devono lasciare una riga"
echo "ok  V4: secondo PUT -> 200, una riga, visit_day invariato; due PUT in parallelo su B -> una riga"

# --- V5: si toglie tutto il gruppo, e togliere due volte non e' un errore ------
psql_dev "INSERT INTO visited_events (user_id, event_id, title, date_start, canonical_category, source, source_id, visit_day)
          SELECT '${u1_user}', id, title, date_start, canonical_category, source, source_id, current_date FROM events WHERE id = ${m_id}" >/dev/null
code="$(del v5 "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/v5.b" 'j.removed')" == "2" ]] || fail "V5: DELETE A: atteso 200 removed 2, ottenuto ${code} '$(cat "${tmp_dir}/v5.b")'"
[[ "$(visited_rows "${u1_user}" "${a_id}")" == "0" && "$(visited_rows "${u1_user}" "${m_id}")" == "0" ]] || fail "V5: dopo DELETE A devono sparire le righe su A e su M"
code="$(del v5b "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/v5b.b" 'j.removed')" == "0" ]] || fail "V5: secondo DELETE A: atteso 200 removed 0, ottenuto ${code} '$(cat "${tmp_dir}/v5b.b")'"
echo "ok  V5: riga su A + riga su M -> DELETE A removed 2, zero righe su A e M; di nuovo -> 200 removed 0"

# --- V6: Origin, sessione e id sono controllati prima di ogni query -------------
no_store() { # <nome-file> <sezione>
  local cc
  cc="$(grep -i '^cache-control:' "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r')"
  [[ "${cc}" == "private, no-store" ]] || fail "$2: cache-control atteso 'private, no-store' su $1, ottenuto '${cc}'"
}
code="$(call v6a PUT "/api/v1/me/visited/${a_id}" -H "${u1_cookie}")"
[[ "${code}" == "403" ]] || fail "V6: PUT senza Origin: atteso 403, ottenuto ${code}"
no_store v6a V6
code="$(call v6b PUT "/api/v1/me/visited/${a_id}" -H "Origin: ${origin}")"
[[ "${code}" == "401" ]] || fail "V6: PUT senza cookie: atteso 401, ottenuto ${code}"
no_store v6b V6
for bad in abc 1234567890 999999999; do
  code="$(put v6c "${bad}" "${u1_cookie}")"
  [[ "${code}" == "404" ]] || fail "V6: PUT /api/v1/me/visited/${bad}: atteso 404, ottenuto ${code}"
  no_store v6c V6
  code="$(del v6d "${bad}" "${u1_cookie}")"
  [[ "${code}" == "200" || "${code}" == "404" ]] || fail "V6: DELETE /api/v1/me/visited/${bad}: atteso 200 o 404, ottenuto ${code}"
  no_store v6d V6
done
[[ "$(visited_rows "${u1_user}" "${a_id}")" == "0" ]] || fail "V6: una richiesta rifiutata ha scritto una riga"
echo "ok  V6: PUT senza Origin -> 403, senza cookie -> 401, id abc / 1234567890 / sconosciuto -> 404, sempre private, no-store"

# --- V7: la cancellazione e' sempre dell'utente della sessione ------------------
mint_user u2
code="$(put v7p "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" && "$(visited_rows "${u1_user}" "${a_id}")" == "1" ]] || fail "V7: u1 deve avere una riga su A (PUT ${code})"
code="$(del v7 "${a_id}" "${u2_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/v7.b" 'j.removed')" == "0" ]] || fail "V7: DELETE A di u2: atteso 200 removed 0, ottenuto ${code} '$(cat "${tmp_dir}/v7.b")'"
no_store v7 V7
[[ "$(visited_rows "${u1_user}" "${a_id}")" == "1" ]] || fail "V7: il DELETE di un altro utente ha tolto la riga di u1"
echo "ok  V7: DELETE A dell'utente 2 -> 200 removed 0, la riga dell'utente 1 resta"

# --- V8: tetto di 500 sull'account ----------------------------------------------
mint_user u3
psql_dev "INSERT INTO visited_events (user_id, title, date_start, canonical_category, source, source_id, visit_day)
          SELECT '${u3_user}', 'Tetto ' || n, now() - interval '30 days', 'Altro', '${test_source}', 'cap-' || n, current_date FROM generate_series(1, 499) AS n" >/dev/null
code="$(put v8a "${a_id}" "${u3_cookie}")"
[[ "${code}" == "200" ]] || fail "V8: la 500a riga: atteso 200, ottenuto ${code} '$(cat "${tmp_dir}/v8a.b")'"
code="$(put v8b "${c_id}" "${u3_cookie}")"
[[ "${code}" == "409" && "$(json_get "${tmp_dir}/v8b.b" 'j.error')" == "cap" ]] || fail "V8: la 501a: atteso 409 cap, ottenuto ${code} '$(cat "${tmp_dir}/v8b.b")'"
no_store v8b V8
[[ "$(psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '${u3_user}'")" == "500" ]] || fail "V8: dopo il 409 devono restare 500 righe"
code="$(put v8c "${a_id}" "${u3_cookie}")"
[[ "${code}" == "200" ]] || fail "V8: A gia' segnato al tetto: atteso 200, ottenuto ${code}"
echo "ok  V8: 499 righe + A -> 200, C -> 409 cap con 500 righe, A di nuovo -> 200"

# --- V9: D-04, le due liste non si toccano --------------------------------------
mint_user u4
saved_rows() { psql_dev "SELECT count(*) FROM saved_events WHERE user_id = '$1' AND event_id = $2"; }
code="$(call v9s PUT "/api/v1/me/saved/${b_id}" -H "Origin: ${origin}" -H "${u4_cookie}")"
[[ "${code}" == "200" ]] || fail "V9: PUT saved B: atteso 200, ottenuto ${code}"
code="$(put v9v "${b_id}" "${u4_cookie}")"
[[ "${code}" == "200" ]] || fail "V9: PUT visited B: atteso 200, ottenuto ${code}"
code="$(del v9d1 "${b_id}" "${u4_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/v9d1.b" 'j.removed')" == "1" ]] || fail "V9: DELETE visited B: atteso 200 removed 1, ottenuto ${code}"
[[ "$(saved_rows "${u4_user}" "${b_id}")" == "1" && "$(visited_rows "${u4_user}" "${b_id}")" == "0" ]] || fail "V9: togliere il visitato non deve toccare il salvato"
code="$(put v9v2 "${b_id}" "${u4_cookie}")"
[[ "${code}" == "200" ]] || fail "V9: PUT visited B di nuovo: atteso 200, ottenuto ${code}"
code="$(call v9d2 DELETE "/api/v1/me/saved/${b_id}" -H "Origin: ${origin}" -H "${u4_cookie}")"
[[ "${code}" == "200" ]] || fail "V9: DELETE saved B: atteso 200, ottenuto ${code}"
[[ "$(saved_rows "${u4_user}" "${b_id}")" == "0" && "$(visited_rows "${u4_user}" "${b_id}")" == "1" ]] || fail "V9: togliere il salvato non deve toccare il visitato"
echo "ok  V9: DELETE visited lascia il salvato, DELETE saved lascia il visitato"

echo "Riepilogo: V1-V9 verdi"
