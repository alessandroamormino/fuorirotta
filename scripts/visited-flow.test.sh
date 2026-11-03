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
#   VS1 PUT /visited/saved/{ref}: riga salvata su un evento in corso -> 200, giorno di oggi; riga sparita (event_id NULL) finita 21 giorni fa -> 200, primo giorno
#   VS2 salvato di un evento futuro -> 409 too-early; ref di un altro utente -> 404 e zero righe; 'abc' -> 404; senza Origin 403; senza cookie 401
#   VS3 GET /visited/ids: l'id canonico una volta sola con righe su canonica e membro
#   VS4 DELETE /visited/gone/{ref}: solo righe con event_id NULL e solo dell'utente della sessione; secondo giro removed 0
#   VM1 merge [A, B] -> added 2, di nuovo -> added 0, due merge in parallelo di [C] -> una riga
#   VM2 101 -> 400, non array -> 400, [] -> added 0, evento futuro saltato, visitDay del client tenuto solo dentro [primo giorno, min(ultimo giorno, oggi)]
#   VM3 istantanea del client solo per righe sparite e validata; testo del client ignorato per l'evento vivo; NUL / date assurde -> 200 senza righe
#   VM4 tetto 500: 499 righe + tre nuove -> added 1, overCap 2; senza Origin 403, senza cookie 401
#   R1  savedEndedOn(ieri): solo il salvato finito ieri e non visitato (non quello visitato, ne' finito l'altroieri, ne' in corso)
#   R2  stesso con una fine in formato UTC (T23:59:59.999Z) e una in formato Roma (mezzanotte di Roma): entrambe trovate nel giorno giusto
#   R3  un secondo utente con un salvato finito ieri compare a parte; l'hook non scrive nulla
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
q1_id="$(insert_event gate-q1 'Visita Q1' "$(noon -8)" "$(noon -6)" NULL)"
q2_id="$(insert_event gate-q2 'Visita Q2' "$(noon -8)" "$(noon -6)" NULL)"
[[ -n "${a_id}" && -n "${m_id}" && -n "${b_id}" && -n "${c_id}" && -n "${p_id}" && -n "${f_id}" && -n "${q1_id}" && -n "${q2_id}" ]] || fail "fixture non create"
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

# --- Aiuti per VS e VM ----------------------------------------------------------
saved_row() { # <utente> <event_id|NULL> <source_id> <titolo> <inizio> <fine> -> id della riga salvata
  psql_dev "INSERT INTO saved_events (user_id, event_id, title, date_start, date_end, canonical_category, source, source_id)
            VALUES ('$1', $2, '$4', $5, $6, 'Sagre e feste', '${test_source}', '$3') RETURNING id" | head -n 1
}
visited_row() { # <utente> <event_id|NULL> <source_id> -> id della riga visitata
  psql_dev "INSERT INTO visited_events (user_id, event_id, title, date_start, canonical_category, source, source_id, visit_day)
            VALUES ('$1', $2, 'Prova', now() - interval '30 days', 'Sagre e feste', '${test_source}', '$3', current_date) RETURNING id" | head -n 1
}
put_saved() { call "$1" PUT "/api/v1/me/visited/saved/$2" -H "Origin: ${origin}" -H "$3"; }
del_gone() { call "$1" DELETE "/api/v1/me/visited/gone/$2" -H "Origin: ${origin}" -H "$3"; }
merge() { call "$1" POST /api/v1/me/visited/merge -H "Origin: ${origin}" -H "$2" -H 'Content-Type: application/json' --data "$3"; }
visited_by_source() { # <utente> <source_id> -> numero di righe
  psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '$1' AND source_id = '$2'"
}
day_of_source() { # <utente> <source_id> -> visit_day
  psql_dev "SELECT to_char(visit_day, 'YYYY-MM-DD') FROM visited_events WHERE user_id = '$1' AND source_id = '$2'"
}

# --- VS1: marcare da una riga salvata, anche quando l'evento non c'e' piu' ---------
mint_user u5
sa_ref="$(saved_row "${u5_user}" "${a_id}" gate-a 'Visita A' "$(noon -1)" "$(noon 1)")"
sg_ref="$(saved_row "${u5_user}" NULL gone-p 'Fantasma' "$(noon -21)" "$(noon -20)")"
[[ "${sa_ref}" =~ ^[0-9]+$ && "${sg_ref}" =~ ^[0-9]+$ ]] || fail "VS1: righe salvate di prova non inserite"
code="$(put_saved vs1a "${sa_ref}" "${u5_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vs1a.b" 'j.visitDay')" == "${rome_today}" ]] || fail "VS1: salvato su A in corso: atteso 200 visitDay ${rome_today}, ottenuto ${code} '$(cat "${tmp_dir}/vs1a.b")'"
[[ "$(visited_rows "${u5_user}" "${a_id}")" == "1" && "$(visit_day_of "${u5_user}" "${a_id}")" == "${rome_today}" ]] || fail "VS1: attesa una riga visitata su A con visit_day di oggi"
code="$(put_saved vs1b "${sg_ref}" "${u5_cookie}")"
gone_first_day="$(day_str -21)"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vs1b.b" 'j.visitDay')" == "${gone_first_day}" ]] || fail "VS1: salvato sparito: atteso 200 visitDay ${gone_first_day}, ottenuto ${code} '$(cat "${tmp_dir}/vs1b.b")'"
[[ "$(psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '${u5_user}' AND event_id IS NULL AND source_id = 'gone-p'")" == "1" && "$(day_of_source "${u5_user}" gone-p)" == "${gone_first_day}" ]] || fail "VS1: attesa una riga con event_id NULL e visit_day ${gone_first_day}"
code="$(put_saved vs1c "${sg_ref}" "${u5_cookie}")"
[[ "${code}" == "200" && "$(visited_by_source "${u5_user}" gone-p)" == "1" ]] || fail "VS1: secondo PUT sulla stessa riga: atteso 200 e ancora una riga, ottenuto ${code}"
echo "ok  VS1: salvato su A in corso -> 200, visit_day oggi; salvato sparito (event_id NULL) -> 200, visit_day = primo giorno (${gone_first_day}); ripetuto -> una riga"

# --- VS2: futuro, altrui, malformato, senza Origin, senza sessione --------------
sf_ref="$(saved_row "${u5_user}" "${f_id}" gate-f 'Visita F' "$(noon 2)" "$(noon 3)")"
code="$(put_saved vs2a "${sf_ref}" "${u5_cookie}")"
[[ "${code}" == "409" && "$(json_get "${tmp_dir}/vs2a.b" 'j.error')" == "too-early" ]] || fail "VS2: salvato di un evento futuro: atteso 409 too-early, ottenuto ${code} '$(cat "${tmp_dir}/vs2a.b")'"
[[ "$(visited_by_source "${u5_user}" gate-f)" == "0" ]] || fail "VS2: un evento futuro ha scritto una riga"
no_store vs2a VS2
mint_user u6
code="$(put_saved vs2b "${sa_ref}" "${u6_cookie}")"
[[ "${code}" == "404" && "$(psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '${u6_user}'")" == "0" ]] || fail "VS2: ref di un altro utente: atteso 404 e zero righe, ottenuto ${code}"
no_store vs2b VS2
code="$(put_saved vs2c abc "${u5_cookie}")"
[[ "${code}" == "404" ]] || fail "VS2: ref 'abc': atteso 404, ottenuto ${code}"
code="$(call vs2d PUT "/api/v1/me/visited/saved/${sa_ref}" -H "${u5_cookie}")"
[[ "${code}" == "403" ]] || fail "VS2: senza Origin: atteso 403, ottenuto ${code}"
code="$(call vs2e PUT "/api/v1/me/visited/saved/${sa_ref}" -H "Origin: ${origin}")"
[[ "${code}" == "401" ]] || fail "VS2: senza cookie: atteso 401, ottenuto ${code}"
echo "ok  VS2: salvato futuro -> 409 too-early senza righe; ref altrui -> 404 e zero righe; 'abc' -> 404; senza Origin 403; senza cookie 401"

# --- VS3: gli id canonici, una volta sola ------------------------------------------
mint_user u7
visited_row "${u7_user}" "${a_id}" gate-a >/dev/null
visited_row "${u7_user}" "${m_id}" gate-m >/dev/null
visited_row "${u7_user}" NULL gone-ids >/dev/null
code="$(call vs3 GET /api/v1/me/visited/ids -H "${u7_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vs3.b" 'JSON.stringify(j.ids)')" == "[${a_id}]" ]] || fail "VS3: ids: atteso [${a_id}] una volta sola (riga su A, riga sul membro M, una sparita), ottenuto ${code} '$(cat "${tmp_dir}/vs3.b")'"
no_store vs3 VS3
code="$(call vs3b GET /api/v1/me/visited/ids)"
[[ "${code}" == "401" ]] || fail "VS3: ids senza cookie: atteso 401, ottenuto ${code}"
echo "ok  VS3: ids con righe su canonica, membro e una sparita -> [${a_id}] una volta sola"

# --- VS4: togliere una riga sparita ----------------------------------------------
mint_user u8
g_ref="$(visited_row "${u8_user}" NULL gone-del)"
l_ref="$(visited_row "${u8_user}" "${a_id}" gate-a)"
code="$(del_gone vs4a "${g_ref}" "${u8_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vs4a.b" 'j.removed')" == "1" ]] || fail "VS4: DELETE gone: atteso removed 1, ottenuto ${code} '$(cat "${tmp_dir}/vs4a.b")'"
code="$(del_gone vs4b "${g_ref}" "${u8_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vs4b.b" 'j.removed')" == "0" ]] || fail "VS4: secondo DELETE gone: atteso removed 0, ottenuto ${code}"
code="$(del_gone vs4c "${l_ref}" "${u8_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vs4c.b" 'j.removed')" == "0" && "$(visited_rows "${u8_user}" "${a_id}")" == "1" ]] || fail "VS4: DELETE gone su una riga con evento: atteso removed 0 e la riga resta, ottenuto ${code}"
g2_ref="$(visited_row "${u8_user}" NULL gone-del2)"
code="$(del_gone vs4d "${g2_ref}" "${u7_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vs4d.b" 'j.removed')" == "0" && "$(visited_by_source "${u8_user}" gone-del2)" == "1" ]] || fail "VS4: DELETE gone di un altro utente: atteso removed 0 e la riga resta, ottenuto ${code}"
no_store vs4d VS4
code="$(call vs4e DELETE "/api/v1/me/visited/gone/${g2_ref}" -H "${u8_cookie}")"
[[ "${code}" == "403" ]] || fail "VS4: DELETE gone senza Origin: atteso 403, ottenuto ${code}"
echo "ok  VS4: DELETE gone -> removed 1, poi 0; riga con evento e riga altrui restano (removed 0); senza Origin 403"

# --- VM1: l'unione e' idempotente e sicura in parallelo --------------------------
t1="$(node -e 'console.log(new Date(Date.now() - 3600e3).toISOString())')"
mint_user u9
code="$(merge vm1a "${u9_cookie}" "{\"items\":[{\"id\":${a_id},\"savedAt\":\"${t1}\"},{\"id\":${b_id},\"savedAt\":\"${t1}\"}]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vm1a.b" 'j.added')" == "2" ]] || fail "VM1: merge [A, B]: atteso added 2, ottenuto ${code} '$(cat "${tmp_dir}/vm1a.b")'"
no_store vm1a VM1
[[ "$(psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '${u9_user}' AND visited_at < now() - interval '30 minutes'")" == "2" ]] || fail "VM1: visited_at deve essere l'istante mandato dal dispositivo (un'ora fa)"
code="$(merge vm1b "${u9_cookie}" "{\"items\":[{\"id\":${a_id},\"savedAt\":\"${t1}\"},{\"id\":${b_id},\"savedAt\":\"${t1}\"}]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vm1b.b" 'j.added')" == "0" ]] || fail "VM1: stesso corpo di nuovo: atteso added 0, ottenuto ${code} '$(cat "${tmp_dir}/vm1b.b")'"
body_c="{\"items\":[{\"id\":${c_id},\"savedAt\":\"${t1}\"}]}"
merge vm1p1 "${u9_cookie}" "${body_c}" >"${tmp_dir}/vm1p1.code" &
pid1=$!
merge vm1p2 "${u9_cookie}" "${body_c}" >"${tmp_dir}/vm1p2.code" &
pid2=$!
wait "${pid1}" "${pid2}"
[[ "$(cat "${tmp_dir}/vm1p1.code")" == "200" && "$(cat "${tmp_dir}/vm1p2.code")" == "200" ]] || fail "VM1: due merge in parallelo: attesi 200 e 200"
[[ "$(visited_rows "${u9_user}" "${c_id}")" == "1" ]] || fail "VM1: due merge in parallelo di [C] devono lasciare una riga"
echo "ok  VM1: [A, B] -> added 2 con visited_at del dispositivo; di nuovo -> added 0; due merge in parallelo di [C] -> una riga"

# --- VM2: confini della richiesta, evento futuro, visitDay del client -------------
mint_user u10
many() { node -e 'console.log(JSON.stringify({items: Array.from({length: Number(process.argv[1])}, (_, i) => ({id: 900000000 + i, savedAt: new Date().toISOString()}))}))' "$1"; }
code="$(merge vm2a "${u10_cookie}" "$(many 101)")"
[[ "${code}" == "400" ]] || fail "VM2: 101 elementi: atteso 400, ottenuto ${code}"
no_store vm2a VM2
for bad in '{"items":{}}' '{"items":"x"}' '{}' 'non json'; do
  code="$(merge vm2b "${u10_cookie}" "${bad}")"
  [[ "${code}" == "400" ]] || fail "VM2: corpo '${bad}': atteso 400, ottenuto ${code}"
done
code="$(merge vm2c "${u10_cookie}" '{"items":[]}')"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vm2c.b" 'j.added')" == "0" ]] || fail "VM2: lista vuota: atteso added 0, ottenuto ${code}"
p_keep="$(day_str -11)"
y_keep="$(day_str -1)"
item() { echo "{\"id\":$1,\"savedAt\":\"${t1}\",\"visitDay\":\"$2\"}"; }
code="$(merge vm2d "${u10_cookie}" "{\"items\":[$(item "${f_id}" "$(day_str 2)"),$(item "${p_id}" "${p_keep}"),$(item "${q1_id}" "$(day_str -9)"),$(item "${q2_id}" "$(day_str -5)"),$(item "${a_id}" "$(day_str 1)"),$(item "${b_id}" banana),$(item "${c_id}" "${y_keep}")]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vm2d.b" 'j.added')" == "6" ]] || fail "VM2: 7 elementi di cui uno futuro: atteso added 6, ottenuto ${code} '$(cat "${tmp_dir}/vm2d.b")'"
[[ "$(visited_by_source "${u10_user}" gate-f)" == "0" ]] || fail "VM2: l'evento futuro non deve entrare"
[[ "$(day_of_source "${u10_user}" gate-p)" == "${p_keep}" ]] || fail "VM2: visitDay valido del client (${p_keep}) deve restare, ottenuto '$(day_of_source "${u10_user}" gate-p)'"
[[ "$(day_of_source "${u10_user}" gate-c)" == "${y_keep}" ]] || fail "VM2: visitDay di ieri su un evento in corso deve restare, ottenuto '$(day_of_source "${u10_user}" gate-c)'"
[[ "$(day_of_source "${u10_user}" gate-q1)" == "$(day_str -8)" ]] || fail "VM2: visitDay prima del primo giorno: atteso il primo giorno $(day_str -8), ottenuto '$(day_of_source "${u10_user}" gate-q1)'"
[[ "$(day_of_source "${u10_user}" gate-q2)" == "$(day_str -8)" ]] || fail "VM2: visitDay dopo l'ultimo giorno: atteso il primo giorno $(day_str -8), ottenuto '$(day_of_source "${u10_user}" gate-q2)'"
[[ "$(day_of_source "${u10_user}" gate-a)" == "${rome_today}" && "$(day_of_source "${u10_user}" gate-b)" == "${rome_today}" ]] || fail "VM2: visitDay futuro o non valido su un evento in corso: atteso oggi ${rome_today}"
echo "ok  VM2: 101 -> 400, non array / vuoto / non JSON -> 400, [] -> added 0; futuro saltato; visitDay del client tenuto solo dentro [primo giorno, min(ultimo, oggi)]"

# --- VM3: il testo del client conta solo per le righe sparite, e validato -----------
mint_user u11
snap_json() { # <sourceId> <titolo> <giorni-fa inizio> <giorni-fa fine> [categoria] [sourceUrl] -> istantanea JSON
  node -e '
    const [sid, title, s, e, cat, url] = process.argv.slice(1)
    // Mezzogiorno UTC: lo stesso giorno a Roma in ogni stagione, come noon().
    const d = (n) => { const x = new Date(); x.setUTCHours(12, 0, 0, 0); return new Date(x.getTime() - Number(n) * 86400000).toISOString() }
    console.log(JSON.stringify({ title: title.replace("@NUL", "\u0000"), dateStart: d(s), dateEnd: d(e), place: null, category: cat || "Sagre e feste", source: process.argv[7], sourceId: sid, sourceUrl: url || null }))
  ' "$1" "$2" "$3" "$4" "${5:-}" "${6:-}" "${test_source}"
}
gone_try() { # <nome> <sourceId> <titolo> <inizio> <fine> [categoria] [sourceUrl] -> codice HTTP del merge di un id sconosciuto
  merge "$1" "${u11_cookie}" "{\"items\":[{\"id\":999999998,\"savedAt\":\"${t1}\",\"snap\":$(snap_json "$2" "$3" "$4" "$5" "${6:-}" "${7:-}")}]}"
}
code="$(gone_try vm3a gone-ok Fantasma 21 20)"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vm3a.b" 'j.added')" == "1" ]] || fail "VM3: istantanea valida: atteso added 1, ottenuto ${code} '$(cat "${tmp_dir}/vm3a.b")'"
[[ "$(psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '${u11_user}' AND event_id IS NULL AND source_id = 'gone-ok'")" == "1" ]] || fail "VM3: la riga sparita deve avere event_id NULL"
[[ "$(day_of_source "${u11_user}" gone-ok)" == "$(day_str -21)" ]] || fail "VM3: visit_day della riga sparita = primo giorno dell'istantanea"
gone_try vm3b gone-js Cattivo 21 20 "Sagre e feste" "javascript:alert(1)" >/dev/null
gone_try vm3c gone-cat Cattivo 21 20 Hacker >/dev/null
gone_try vm3d gate-a EVIL 21 20 >/dev/null
[[ "$(visited_by_source "${u11_user}" gone-js)" == "0" && "$(visited_by_source "${u11_user}" gone-cat)" == "0" ]] || fail "VM3: sourceUrl javascript: o categoria Hacker hanno scritto una riga"
[[ "$(psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '${u11_user}' AND title = 'EVIL'")" == "0" ]] || fail "VM3: testo del browser per un evento che esiste ancora sotto un altro id"
code="$(merge vm3e "${u11_cookie}" "{\"items\":[{\"id\":${a_id},\"savedAt\":\"${t1}\",\"snap\":$(snap_json gate-a EVIL 21 20)}]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vm3e.b" 'j.added')" == "1" ]] || fail "VM3: A con testo del client: atteso added 1, ottenuto ${code}"
[[ "$(psql_dev "SELECT title FROM visited_events WHERE user_id = '${u11_user}' AND event_id = ${a_id}")" == "Visita A" ]] || fail "VM3: il titolo della riga su A deve essere quello del server ('Visita A')"
code="$(gone_try vm3f gone-nul 'Con@NUL' 21 20)"
[[ "${code}" == "200" && "$(visited_by_source "${u11_user}" gone-nul)" == "0" ]] || fail "VM3: NUL nel titolo: atteso 200 senza righe, ottenuto ${code}"
code="$(merge vm3g "${u11_cookie}" "{\"items\":[{\"id\":999999998,\"savedAt\":\"9999-01-01T00:00:00.000Z\",\"snap\":$(snap_json gone-year 'Anno' 21 20)},{\"id\":999999997,\"savedAt\":\"${t1}\",\"snap\":{\"title\":\"Anno 2100\",\"dateStart\":\"2100-06-01T00:00:00.000Z\",\"dateEnd\":null,\"place\":null,\"category\":\"Altro\",\"source\":\"${test_source}\",\"sourceId\":\"gone-2100\",\"sourceUrl\":null}}]}")"
[[ "${code}" == "200" && "$(visited_by_source "${u11_user}" gone-year)" == "0" && "$(visited_by_source "${u11_user}" gone-2100)" == "0" ]] || fail "VM3: savedAt assurdo o evento del 2100: atteso 200 senza righe, ottenuto ${code} '$(cat "${tmp_dir}/vm3g.b")'"
echo "ok  VM3: sparito valido -> event_id NULL; javascript:, Hacker, evento vivo sotto altro id -> nessuna riga; A ignora 'EVIL'; NUL, savedAt 9999 e 2100 -> 200 senza righe"

# --- VM4: tetto di 500 e guardie -----------------------------------------------------
mint_user u12
psql_dev "INSERT INTO visited_events (user_id, title, date_start, canonical_category, source, source_id, visit_day)
          SELECT '${u12_user}', 'Tetto ' || n, now() - interval '30 days', 'Altro', '${test_source}', 'cap-' || n, current_date FROM generate_series(1, 499) AS n" >/dev/null
code="$(merge vm4a "${u12_cookie}" "{\"items\":[{\"id\":${a_id},\"savedAt\":\"${t1}\"},{\"id\":${b_id},\"savedAt\":\"${t1}\"},{\"id\":${c_id},\"savedAt\":\"${t1}\"}]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/vm4a.b" 'j.added + ":" + j.overCap')" == "1:2" ]] || fail "VM4: 499 righe + 3: atteso added 1 overCap 2, ottenuto ${code} '$(cat "${tmp_dir}/vm4a.b")'"
[[ "$(psql_dev "SELECT count(*) FROM visited_events WHERE user_id = '${u12_user}'")" == "500" ]] || fail "VM4: devono restare 500 righe"
code="$(call vm4b POST /api/v1/me/visited/merge -H "${u12_cookie}" -H 'Content-Type: application/json' --data '{"items":[]}')"
[[ "${code}" == "403" ]] || fail "VM4: merge senza Origin: atteso 403, ottenuto ${code}"
code="$(call vm4c POST /api/v1/me/visited/merge -H "Origin: ${origin}" -H 'Content-Type: application/json' --data '{"items":[]}')"
[[ "${code}" == "401" ]] || fail "VM4: merge senza cookie: atteso 401, ottenuto ${code}"
echo "ok  VM4: 499 righe + 3 nuove -> added 1, overCap 2, 500 righe; senza Origin 403; senza cookie 401"

# --- R1-R3: l'aggancio della Fase 28 ("Ci sei stato?") -------------------------------
# I giorni sono quelli di Roma, calcolati qui e passati come testo: il gate non dipende dall'ora a cui gira.
rome_day() { node -e 'const d = new Date(process.argv[1] + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + Number(process.argv[2])); console.log(d.toISOString().slice(0, 10))' "${rome_today}" "$1"; }
r_yest="$(rome_day -1)"; r_2="$(rome_day -2)"; r_3="$(rome_day -3)"; r_4="$(rome_day -4)"; r_tom="$(rome_day 1)"
noon_of() { echo "'$1T12:00:00'::timestamp"; }
ended_on() { # <giorno> -> JSON delle righe di savedEndedOn, filtrate dopo sugli utenti di prova
  bash scripts/dev-db.sh npx tsx -e "import('./lib/visited/reminder.ts').then(async (mod) => { const m = mod.default ?? mod; console.log(JSON.stringify(await m.savedEndedOn('$1'))) }).finally(() => process.exit(0))" | tail -n 1
}
mint_user u13
mint_user u14
saved_row "${u13_user}" NULL r-a 'Finito ieri' "$(noon_of "${r_3}")" "$(noon_of "${r_yest}")" >/dev/null
saved_row "${u13_user}" NULL r-b 'Finito ieri, visitato' "$(noon_of "${r_3}")" "$(noon_of "${r_yest}")" >/dev/null
visited_row "${u13_user}" NULL r-b >/dev/null
saved_row "${u13_user}" NULL r-c 'Finito l altroieri' "$(noon_of "${r_4}")" "$(noon_of "${r_2}")" >/dev/null
saved_row "${u13_user}" NULL r-d 'In corso' "$(noon_of "${r_yest}")" "$(noon_of "${r_tom}")" >/dev/null
out="$(ended_on "${r_yest}")"
echo "${out}" > "${tmp_dir}/r1.b"
[[ "$(json_get "${tmp_dir}/r1.b" "j.filter((r) => r.userId === '${u13_user}').map((r) => r.sourceId).join()")" == "r-a" ]] || fail "R1: savedEndedOn(${r_yest}) per l'utente di prova: atteso solo r-a, ottenuto '${out}'"
[[ "$(json_get "${tmp_dir}/r1.b" "Object.keys(j.find((r) => r.sourceId === 'r-a')).sort().join()")" == "savedRef,source,sourceId,title,userId" ]] || fail "R1: le righe devono avere userId, savedRef, title, source, sourceId: '${out}'"
echo "ok  R1: savedEndedOn(ieri) -> solo il salvato finito ieri e non visitato (non il visitato, non l'altroieri, non quello in corso)"

# --- R2: i due formati di data della fine --------------------------------------------
saved_row "${u13_user}" NULL r-utc 'Fine formato UTC' "'${r_yest}T00:00:00'::timestamp" "'${r_yest}T23:59:59.999'::timestamp" >/dev/null
rome_midnight() { echo "((('$1'::date)::timestamp AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC')"; }
saved_row "${u13_user}" NULL r-rome 'Fine formato Roma' "$(rome_midnight "${r_yest}")" "$(rome_midnight "${rome_today}") - interval '1 millisecond'" >/dev/null
out="$(ended_on "${r_yest}")"
echo "${out}" > "${tmp_dir}/r2.b"
[[ "$(json_get "${tmp_dir}/r2.b" "j.filter((r) => r.userId === '${u13_user}').map((r) => r.sourceId).sort().join()")" == "r-a,r-rome,r-utc" ]] || fail "R2: savedEndedOn(${r_yest}): attesi r-a, r-rome, r-utc, ottenuto '${out}'"
out="$(ended_on "${rome_today}")"
echo "${out}" > "${tmp_dir}/r2b.b"
[[ "$(json_get "${tmp_dir}/r2b.b" "j.filter((r) => r.userId === '${u13_user}').length")" == "0" ]] || fail "R2: savedEndedOn(oggi): nessuno dei salvati di prova finisce oggi, ottenuto '${out}'"
echo "ok  R2: fine in formato UTC (23:59:59.999Z) e in formato Roma (mezzanotte di Roma) trovate nel loro giorno, non in quello dopo"

# --- R3: piu' utenti, nessuna scrittura -----------------------------------------------
saved_row "${u14_user}" NULL r-a2 'Finito ieri, altro utente' "$(noon_of "${r_3}")" "$(noon_of "${r_yest}")" >/dev/null
rows_before="$(psql_dev "SELECT (SELECT count(*) FROM saved_events) || ':' || (SELECT count(*) FROM visited_events)")"
out="$(ended_on "${r_yest}")"
echo "${out}" > "${tmp_dir}/r3.b"
[[ "$(json_get "${tmp_dir}/r3.b" "j.filter((r) => r.userId === '${u14_user}').map((r) => r.sourceId).join()")" == "r-a2" ]] || fail "R3: il secondo utente deve comparire con r-a2, ottenuto '${out}'"
[[ "$(json_get "${tmp_dir}/r3.b" "j.filter((r) => r.userId === '${u13_user}').length")" == "3" ]] || fail "R3: il primo utente conserva le sue 3 righe (r-a, r-utc, r-rome), ottenuto '${out}'"
[[ "$(psql_dev "SELECT (SELECT count(*) FROM saved_events) || ':' || (SELECT count(*) FROM visited_events)")" == "${rows_before}" ]] || fail "R3: savedEndedOn ha scritto o tolto righe"
echo "ok  R3: due utenti compaiono ciascuno con le proprie righe; saved_events e visited_events invariati dopo la chiamata"

echo "Riepilogo: V1-V9, VS1-VS4, VM1-VM4, R1-R3 verdi"
