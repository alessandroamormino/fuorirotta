#!/usr/bin/env bash
# Gate dei salvati (check:saved-flow, test:local): dev server effimero sul
# Postgres LOCALE (scripts/dev-db.sh, mai produzione), con le variabili di
# accesso passate ESPLICITE e valori finti, come scripts/auth-flow.test.sh.
# La rotta dei salvati degli ospiti (R1-R7) non ha bisogno di utenti; quelle
# dell'account (S1-S9) si, creati con scripts/auth-flow.helper.ts (e-mail
# @fixture.invalid, cancellati a fine prova: la cascata porta via i salvati).
#
# Sezioni:
#   R1  POST /api/v1/saved/resolve [A, M, 999999999]: tre righe, il membro M risolve
#       alla canonica A, A ha un'istantanea viva, l'id sconosciuto ha eventId e live nulli
#   R2  101 id, un id stringa, 0, 1000000000, un corpo non JSON -> 400 ciascuno
#   R3  la risposta 200 ha cache-control "private, no-store" e nessun set-cookie
#   R4  GET /salvati -> 200, contiene >Salvati</h1> e un meta robots noindex
#   R5  GET / -> 200, i cuori del server sono il contorno non salvato per tutti
#   R6  GET /eventi/{A} -> 200, il cuore del dettaglio e' il contorno non salvato "Salva: Gate A"
#   R7  GET / e GET /salvati hanno il cuore "Salvati" verso /salvati (anche con l'accesso spento
#       nell'ambiente di prova non cambia nulla: non legge il flag), /salvati con aria-current,
#       nessuna delle due con il punto data-saved-dot
#
#   S1  PUT /api/v1/me/saved/A con sessione e Origin -> 200 e UNA riga con event_id A, titolo
#       'Gate A', source '__saved_gate__'
#   S2  secondo PUT -> 200 e ancora una riga; due PUT in parallelo su B -> una riga
#   S3  GET /api/v1/me/saved/ids contiene A e B
#   S4  riga a mano sul membro M: GET ids elenca A una volta sola; DELETE A -> removed 2, zero righe su A e M
#   S5  DELETE A di nuovo -> 200 removed 0
#   S6  PUT senza Origin -> 403, senza cookie -> 401, id 'abc' / 1234567890 / 999999999 (sconosciuto) -> 404,
#       tutte private, no-store
#   S7  DELETE A di un altro utente mentre u1 ha una riga su A -> 200 removed 0, la riga di u1 resta
#   S8  499 righe di sola istantanea: PUT A -> 200 (la 500a), PUT B -> 409 {error:'cap'} e 500 righe,
#       PUT A di nuovo -> 200 (gia' salvato al tetto)
#   S9  GET ids senza cookie -> 401 private, no-store
#
#   M1  POST merge [A, B] con savedAt due ore e un'ora fa -> added 2, righe su A e B con saved_at uguali
#       agli istanti mandati (al secondo)
#   M2  lo stesso corpo di nuovo -> added 0 e righe invariate; due merge in parallelo di [C] -> una riga su C
#   M3  101 elementi -> 400, items non array -> 400, items [] -> 200 added 0, esattamente 100 -> 200
#   M4  id sconosciuto con istantanea valida finita 20 giorni fa -> riga con event_id NULL; finita 13 mesi fa,
#       sourceUrl javascript:, categoria 'Hacker', riga che esiste sotto un altro id -> nessuna riga;
#       A con snap.title 'EVIL' -> il titolo della riga e' 'Gate A'
#       date fuori intervallo (2100+), NUL nel titolo, savedAt prima del 2000 -> 200 e nessuna riga, mai 500;
#       la voce buona accanto alle guaste entra
#   M5  499 righe + tre elementi nuovi -> added 1, overCap 2
#   M6  merge senza Origin -> 403, senza cookie -> 401, entrambi private, no-store
#
#   L1  GET /api/v1/me/saved con A (viva) e una riga di sola istantanea G -> due elementi, A con eventId e live,
#       G con eventId e live nulli e titolo di G
#   L2  DELETE gone/{G} -> removed 1, di nuovo -> 0, DELETE gone/{riga di A} -> 0 e la riga resta,
#       DELETE gone/{G'} di un altro utente -> 0
#   L3  GET lista senza cookie -> 401, ogni risposta private, no-store
#
#   A1  GET /eventi/{torino +5} contiene >Altre date</h2>, i link alle date +12 e +19 con un cuore
#       "Salva: Gate Serie, {data}", nessun link alla data finita ne' al decoy che differisce solo
#       nei due '_' iniziali (un LIKE lo abbinerebbe, starts_with no)
#   A2  GET /eventi/{roma d1 piazza-a} linka d2 (stessa sede) e non d3 (altra sede)
#   A3  GET /eventi/{A} (sorgente senza serie) non ha 'Altre date'
#
#   D1  POST resolve [torino +5] -> l'elemento ha siblings con esattamente gli id +12 e +19
#   D2  PUT torino +5, psql sposta di tre giorni indietro le date dell'istantanea, GET lista le mostra
#       diverse da quelle vive, POST ack {eventIds:[id]} -> updated 1 e l'istantanea torna uguale
#       all'evento; ack senza Origin -> 403; l'ack di un altro utente -> updated 0
#
#   F1  utente con salvati su A (in arrivo), P (finito 20 giorni fa) e una riga di sola istantanea finita 40 giorni
#       fa: POST calendar-feed -> 200 con path /cal/{22 caratteri}.ics, secondo POST -> lo stesso path, una riga
#   F2  GET path -> 200 con i quattro header, esattamente due BEGIN:VEVENT (A e P), un solo BEGIN:VALARM con
#       TRIGGER:-PT6H, UID saved-{riga}@fuori-rotta.it, nessuna riga oltre 75 ottetti, secondo GET identico al byte
#   F3  POST rotate -> path diverso; il vecchio path risponde un 404 uguale (corpo e header senza Date) a un token
#       ignoto di 22 caratteri, a /cal/short.ics e a un token valido con .txt; il nuovo path risponde 200
#   F4  utente senza salvati -> 200, un VCALENDAR e zero VEVENT
#   F5  POST calendar-feed senza Origin -> 403, senza cookie -> 401
#   F6  server riavviato con AUTH_ENABLED=false: il nuovo path risponde il 404 di F3, GET ids con cookie -> 404,
#       POST resolve [A] -> 200
#
# Righe di prova sotto il `source` dedicato '__saved_gate__' e, per le serie, sotto i source reali
# 'torino' e 'roma' con source_id che contiene 'saved_gate__': cancellate prima e all'uscita,
# nessuna riga reale viene letta o toccata.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il dev server dello sviluppatore.
port="${SAVED_FLOW_TEST_PORT:-39887}"
base_url="http://localhost:${port}"
origin="${base_url}"

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
  psql_dev "DELETE FROM events WHERE source = '${test_source}' OR (source IN ('torino', 'roma') AND position('saved_gate__' in source_id) > 0)" >/dev/null 2>&1 || true
}

# Gli utenti di prova @fixture.invalid: la FK in cascata porta via saved_events e calendar_feeds.
delete_users() {
  psql_dev "DELETE FROM auth_user WHERE email LIKE '%@fixture.invalid'" >/dev/null 2>&1 || true
}

cleanup() {
  stop_server
  delete_users
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
delete_users
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

# Serie a piu' date (SAVE-06): source reali 'torino' e 'roma', source_id riconoscibili per la pulizia.
insert_series() {
  # insert_series <source> <source_id> <titolo> <giorni di inizio da oggi> -> id (solo data, senza ora)
  psql_dev "INSERT INTO events (source, source_id, title, date_start) VALUES ('$1', '$2', '$3', date_trunc('day', now()) + interval '$4 days') RETURNING id" | head -n 1
}
day_str() { psql_dev "SELECT to_char(now() + interval '$1 days', 'YYYY-MM-DD')" | head -n 1; }
s5_day="$(day_str 5)"; s12_day="$(day_str 12)"; s19_day="$(day_str 19)"; sold_day="$(day_str -10)"; s8_day="$(day_str 8)"
t5_id="$(insert_series torino "__saved_gate__serie#${s5_day}" 'Gate Serie' 5)"
t12_id="$(insert_series torino "__saved_gate__serie#${s12_day}" 'Gate Serie' 12)"
t19_id="$(insert_series torino "__saved_gate__serie#${s19_day}" 'Gate Serie' 19)"
told_id="$(insert_series torino "__saved_gate__serie#${sold_day}" 'Gate Serie' -10)"
tdecoy_id="$(insert_series torino "ZZsaved_gate__serie#${s8_day}" 'Gate Serie' 8)"
r1_id="$(insert_series roma "__saved_gate__roma#${s5_day}#piazza-a" 'Gate Roma' 5)"
r2_id="$(insert_series roma "__saved_gate__roma#${s12_day}#piazza-a" 'Gate Roma' 12)"
r3_id="$(insert_series roma "__saved_gate__roma#${s19_day}#piazza-b" 'Gate Roma' 19)"
[[ -n "${t5_id}" && -n "${t12_id}" && -n "${t19_id}" && -n "${told_id}" && -n "${tdecoy_id}" && -n "${r1_id}" && -n "${r2_id}" && -n "${r3_id}" ]] || fail "fixture delle serie non create"
echo "ok  fixture serie: torino ${t5_id}/${t12_id}/${t19_id} (+ finita ${told_id}, decoy ${tdecoy_id}), roma ${r1_id}/${r2_id}/${r3_id}"

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

# helper <sottocomando> [args...]: stesso ambiente del dev server, Postgres locale.
helper() {
  bash scripts/dev-db.sh env "${auth_env[@]}" npx tsx scripts/auth-flow.helper.ts "$@"
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

# --- R6: il dettaglio porta il cuore a pillola, non salvato, per tutti -------
code="$(call r6 GET "/eventi/${a_id}")"
[[ "${code}" == "200" ]] || fail "R6: GET /eventi/${a_id}: atteso 200, ottenuto ${code}"
grep -q 'aria-label="Salva: Gate A"' "${tmp_dir}/r6.b" || fail "R6: manca il cuore 'Salva: Gate A' nell'HTML del dettaglio"
grep -q 'aria-pressed="false"' "${tmp_dir}/r6.b" || fail "R6: il cuore del dettaglio deve avere aria-pressed=\"false\""
echo "ok  R6: il dettaglio di A contiene il cuore 'Salva: Gate A' con aria-pressed=\"false\""

# --- R7: il cuore della testata e' per tutti, senza punto lato server -------
for page in "/" "/salvati"; do
  name="r7$(echo "${page}" | tr -d '/')"
  code="$(call "${name}" GET "${page}")"
  [[ "${code}" == "200" ]] || fail "R7: GET ${page}: atteso 200, ottenuto ${code}"
  grep -q 'aria-label="Salvati"' "${tmp_dir}/${name}.b" || fail "R7: ${page}: manca aria-label=\"Salvati\""
  grep -q 'href="/salvati"' "${tmp_dir}/${name}.b" || fail "R7: ${page}: manca href=\"/salvati\""
  if grep -q 'data-saved-dot' "${tmp_dir}/${name}.b"; then fail "R7: ${page}: il punto non puo' stare nell'HTML del server"; fi
done
grep -q 'aria-current="page"' "${tmp_dir}/r7salvati.b" || fail "R7: /salvati: manca aria-current=\"page\" sul cuore"
echo "ok  R7: / e /salvati hanno il cuore Salvati verso /salvati, aria-current su /salvati, mai il punto"

# --- A1: l'altra data di una serie torino, con il suo cuore ------------------
code="$(call a1 GET "/eventi/${t5_id}")"
[[ "${code}" == "200" ]] || fail "A1: GET /eventi/${t5_id}: atteso 200, ottenuto ${code}"
grep -q '>Altre date</h2>' "${tmp_dir}/a1.b" || fail "A1: manca >Altre date</h2>"
grep -q "href=\"/eventi/${t12_id}\"" "${tmp_dir}/a1.b" || fail "A1: manca il link alla data +12 (${t12_id})"
grep -q "href=\"/eventi/${t19_id}\"" "${tmp_dir}/a1.b" || fail "A1: manca il link alla data +19 (${t19_id})"
if grep -q "href=\"/eventi/${told_id}\"" "${tmp_dir}/a1.b"; then fail "A1: la data finita (${told_id}) non deve essere elencata"; fi
if grep -q "href=\"/eventi/${tdecoy_id}\"" "${tmp_dir}/a1.b"; then fail "A1: il decoy (${tdecoy_id}) non deve essere elencato: il prefisso e' un parametro di starts_with, non un LIKE"; fi
[[ "$(grep -o 'aria-label="Salva: Gate Serie, ' "${tmp_dir}/a1.b" | wc -l | tr -d ' ')" == "2" ]] || fail "A1: attesi due cuori 'Salva: Gate Serie, {data}' nelle Altre date"
echo "ok  A1: la serie torino elenca +12 e +19 con un cuore ciascuno, non la data finita ne' il decoy"

# --- A2: roma, solo la stessa sede --------------------------------------------
code="$(call a2 GET "/eventi/${r1_id}")"
[[ "${code}" == "200" ]] || fail "A2: GET /eventi/${r1_id}: atteso 200, ottenuto ${code}"
grep -q "href=\"/eventi/${r2_id}\"" "${tmp_dir}/a2.b" || fail "A2: manca il link alla stessa sede (${r2_id})"
if grep -q "href=\"/eventi/${r3_id}\"" "${tmp_dir}/a2.b"; then fail "A2: un'altra sede (${r3_id}) non e' della serie"; fi
echo "ok  A2: roma elenca la data della stessa sede e non quella di un'altra sede"

# --- A3: una sorgente senza serie non mostra nulla ----------------------------
code="$(call a3 GET "/eventi/${a_id}")"
[[ "${code}" == "200" ]] || fail "A3: GET /eventi/${a_id}: atteso 200, ottenuto ${code}"
if grep -q 'Altre date' "${tmp_dir}/a3.b"; then fail "A3: una sorgente senza serie non deve mostrare 'Altre date'"; fi
echo "ok  A3: un evento di una sorgente senza serie non ha 'Altre date'"

# ============================ Salvati dell'account ============================
# mint_user <prefisso> -> imposta ${prefix}_user e ${prefix}_cookie (intestazione Cookie)
mint_user() {
  local prefix="$1" uid cookie
  read -r uid cookie _ <<<"$(helper mint "${prefix}-saved@fixture.invalid" "Prova ${prefix}" 0 | tail -n 1)"
  [[ -n "${uid}" && -n "${cookie}" ]] || fail "helper mint non ha stampato utente e cookie per ${prefix}"
  printf -v "${prefix}_user" '%s' "${uid}"
  printf -v "${prefix}_cookie" '%s' "Cookie: fuorirotta.session_token=${cookie}"
}
saved_rows() { # <utente> <event_id> -> numero di righe
  psql_dev "SELECT count(*) FROM saved_events WHERE user_id = '$1' AND event_id = $2"
}
put() { call "$1" PUT "/api/v1/me/saved/$2" -H "Origin: ${origin}" -H "$3"; }
del() { call "$1" DELETE "/api/v1/me/saved/$2" -H "Origin: ${origin}" -H "$3"; }
get_ids() { call "$1" GET /api/v1/me/saved/ids -H "$2"; }

mint_user u1
b_id="$(insert_event gate-b 'Gate B' "now() + interval '5 days'" "now() + interval '6 days'" NULL)"
[[ -n "${b_id}" ]] || fail "fixture B non creata"

# --- S1: il salvataggio crea una riga con l'istantanea del server -------------
code="$(put s1 "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "S1: PUT A: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s1.b"))"
[[ "$(saved_rows "${u1_user}" "${a_id}")" == "1" ]] || fail "S1: attesa una riga per A"
row="$(psql_dev "SELECT title || '|' || source FROM saved_events WHERE user_id = '${u1_user}' AND event_id = ${a_id}")"
[[ "${row}" == "Gate A|${test_source}" ]] || fail "S1: istantanea attesa 'Gate A|${test_source}', ottenuto '${row}'"
echo "ok  S1: PUT A -> 200, una riga con event_id A, titolo 'Gate A', source '${test_source}'"

# --- S2: idempotente e sicuro in parallelo ------------------------------------
code="$(put s2 "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "S2: secondo PUT A: atteso 200, ottenuto ${code}"
[[ "$(saved_rows "${u1_user}" "${a_id}")" == "1" ]] || fail "S2: dopo il secondo PUT deve restare una riga su A"
put s2p1 "${b_id}" "${u1_cookie}" >"${tmp_dir}/s2p1.code" &
pid1=$!
put s2p2 "${b_id}" "${u1_cookie}" >"${tmp_dir}/s2p2.code" &
pid2=$!
wait "${pid1}" "${pid2}"
[[ "$(cat "${tmp_dir}/s2p1.code")" == "200" && "$(cat "${tmp_dir}/s2p2.code")" == "200" ]] || fail "S2: due PUT in parallelo su B: attesi 200 e 200, ottenuti $(cat "${tmp_dir}/s2p1.code") e $(cat "${tmp_dir}/s2p2.code")"
[[ "$(saved_rows "${u1_user}" "${b_id}")" == "1" ]] || fail "S2: due PUT in parallelo su B devono lasciare una riga"
echo "ok  S2: secondo PUT -> 200 e una riga; due PUT in parallelo su B -> una riga"

# --- S3: gli id per i cuori ---------------------------------------------------
code="$(get_ids s3 "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "S3: GET ids: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/s3.b" "[${a_id},${b_id}].every((x) => j.ids.includes(x)) && j.ids.length === 2")" == "true" ]] || fail "S3: ids attesi [${a_id},${b_id}], corpo '$(cat "${tmp_dir}/s3.b")'"
echo "ok  S3: GET ids contiene A e B"

# --- S4: salvato prima della fusione e sulla canonica = un salvato solo -------
psql_dev "INSERT INTO saved_events (user_id, event_id, title, date_start, canonical_category, source, source_id)
          SELECT '${u1_user}', id, title, date_start, canonical_category, source, source_id FROM events WHERE id = ${m_id}" >/dev/null
code="$(get_ids s4 "${u1_cookie}")"
[[ "$(json_get "${tmp_dir}/s4.b" "j.ids.filter((x) => x === ${a_id}).length")" == "1" ]] || fail "S4: A deve comparire una volta sola negli id, corpo '$(cat "${tmp_dir}/s4.b")'"
[[ "$(json_get "${tmp_dir}/s4.b" "j.ids.includes(${m_id})")" == "false" ]] || fail "S4: il membro M non deve comparire negli id"
code="$(del s4d "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/s4d.b" 'j.removed')" == "2" ]] || fail "S4: DELETE A: atteso 200 removed 2, ottenuto ${code} '$(cat "${tmp_dir}/s4d.b")'"
[[ "$(saved_rows "${u1_user}" "${a_id}")" == "0" && "$(saved_rows "${u1_user}" "${m_id}")" == "0" ]] || fail "S4: dopo DELETE A devono sparire le righe su A e su M"
echo "ok  S4: riga su M + riga su A -> id A una volta sola, DELETE A -> removed 2, zero righe su A e M"

# --- S5: togliere due volte non e' un errore ----------------------------------
code="$(del s5 "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/s5.b" 'j.removed')" == "0" ]] || fail "S5: secondo DELETE A: atteso 200 removed 0, ottenuto ${code} '$(cat "${tmp_dir}/s5.b")'"
echo "ok  S5: secondo DELETE A -> 200 removed 0"

# --- S6: Origin, sessione e id sono controllati prima di ogni query ----------
no_store() { # <nome-file> <sezione>
  local cc
  cc="$(grep -i '^cache-control:' "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r')"
  [[ "${cc}" == "private, no-store" ]] || fail "$2: cache-control atteso 'private, no-store' su $1, ottenuto '${cc}'"
}
code="$(call s6a PUT "/api/v1/me/saved/${a_id}" -H "${u1_cookie}")"
[[ "${code}" == "403" ]] || fail "S6: PUT senza Origin: atteso 403, ottenuto ${code}"
no_store s6a S6
code="$(call s6b PUT "/api/v1/me/saved/${a_id}" -H "Origin: ${origin}")"
[[ "${code}" == "401" ]] || fail "S6: PUT senza cookie: atteso 401, ottenuto ${code}"
no_store s6b S6
for bad in abc 1234567890 999999999; do
  code="$(put s6c "${bad}" "${u1_cookie}")"
  [[ "${code}" == "404" ]] || fail "S6: PUT /api/v1/me/saved/${bad}: atteso 404, ottenuto ${code}"
  no_store s6c S6
done
[[ "$(saved_rows "${u1_user}" "${a_id}")" == "0" ]] || fail "S6: una richiesta rifiutata ha scritto una riga"
echo "ok  S6: PUT senza Origin -> 403, senza cookie -> 401, id abc / 1234567890 / sconosciuto -> 404, sempre private, no-store"

# --- S7: la cancellazione e' sempre dell'utente della sessione ----------------
mint_user u2
code="$(put s7p "${a_id}" "${u1_cookie}")"
[[ "${code}" == "200" && "$(saved_rows "${u1_user}" "${a_id}")" == "1" ]] || fail "S7: u1 deve avere una riga su A (PUT ${code})"
code="$(del s7 "${a_id}" "${u2_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/s7.b" 'j.removed')" == "0" ]] || fail "S7: DELETE A di u2: atteso 200 removed 0, ottenuto ${code} '$(cat "${tmp_dir}/s7.b")'"
no_store s7 S7
[[ "$(saved_rows "${u1_user}" "${a_id}")" == "1" ]] || fail "S7: il DELETE di un altro utente ha tolto la riga di u1"
echo "ok  S7: DELETE A dell'utente 2 -> 200 removed 0, la riga dell'utente 1 resta"

# --- S8: tetto di 500 sull'account --------------------------------------------
mint_user u3
psql_dev "INSERT INTO saved_events (user_id, title, date_start, canonical_category, source, source_id)
          SELECT '${u3_user}', 'Tetto ' || n, now() + interval '30 days', 'Altro', '${test_source}', 'cap-' || n FROM generate_series(1, 499) AS n" >/dev/null
code="$(put s8a "${a_id}" "${u3_cookie}")"
[[ "${code}" == "200" ]] || fail "S8: la 500a riga: atteso 200, ottenuto ${code} '$(cat "${tmp_dir}/s8a.b")'"
code="$(put s8b "${b_id}" "${u3_cookie}")"
[[ "${code}" == "409" && "$(json_get "${tmp_dir}/s8b.b" 'j.error')" == "cap" ]] || fail "S8: la 501a: atteso 409 cap, ottenuto ${code} '$(cat "${tmp_dir}/s8b.b")'"
no_store s8b S8
[[ "$(psql_dev "SELECT count(*) FROM saved_events WHERE user_id = '${u3_user}'")" == "500" ]] || fail "S8: dopo il 409 devono restare 500 righe"
code="$(put s8c "${a_id}" "${u3_cookie}")"
[[ "${code}" == "200" ]] || fail "S8: A gia' salvato al tetto: atteso 200, ottenuto ${code}"
echo "ok  S8: 499 righe + A -> 200, B -> 409 cap con 500 righe, A di nuovo -> 200"

# --- S9: gli id richiedono la sessione ----------------------------------------
code="$(call s9 GET /api/v1/me/saved/ids)"
[[ "${code}" == "401" ]] || fail "S9: GET ids senza cookie: atteso 401, ottenuto ${code}"
no_store s9 S9
echo "ok  S9: GET ids senza cookie -> 401 private, no-store"

# ============================ Unione della lista (AUTH-09) ===================
c_id="$(insert_event gate-c 'Gate C' "now() + interval '7 days'" "now() + interval '8 days'" NULL)"
[[ -n "${c_id}" ]] || fail "fixture C non creata"
merge() { # <nome> <cookie> <corpo json> -> codice HTTP
  call "$1" POST /api/v1/me/saved/merge -H "Origin: ${origin}" -H "$2" -H 'Content-Type: application/json' --data "$3"
}
user_rows() { psql_dev "SELECT count(*) FROM saved_events WHERE user_id = '$1'"; }
# snap_json <sourceId> <titolo> <giorniFaDiInizio> <giorniFaDiFine> [categoria] [sourceUrl] -> JSON dell'istantanea
snap_json() {
  node -e '
    const [sid, title, s, e, cat, url] = process.argv.slice(1)
    const d = (days) => new Date(Date.now() - Number(days) * 86400000).toISOString()
    console.log(JSON.stringify({ title, dateStart: d(s), dateEnd: d(e), place: "Altrove (XX)", category: cat || "Sagre e feste",
      source: process.argv[7], sourceId: sid, sourceUrl: url || "https://example.it/e" }))' "$1" "$2" "$3" "$4" "${5:-}" "${6:-}" "${test_source}"
}

# --- M1: l'unione tiene l'ordine di salvataggio del dispositivo ---------------
mint_user u4
t1="$(node -e 'console.log(new Date(Date.now() - 2 * 3600000).toISOString())')"
t2="$(node -e 'console.log(new Date(Date.now() - 3600000).toISOString())')"
body="{\"items\":[{\"id\":${a_id},\"savedAt\":\"${t1}\",\"snap\":null},{\"id\":${b_id},\"savedAt\":\"${t2}\"}]}"
code="$(merge m1 "${u4_cookie}" "${body}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m1.b" 'j.added')" == "2" && "$(json_get "${tmp_dir}/m1.b" 'j.overCap')" == "0" ]] || fail "M1: atteso 200 added 2 overCap 0, ottenuto ${code} '$(cat "${tmp_dir}/m1.b")'"
for pair in "${a_id}|${t1}" "${b_id}|${t2}"; do
  ev="${pair%%|*}"; want="${pair#*|}"
  got="$(psql_dev "SELECT to_char(saved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') FROM saved_events WHERE user_id = '${u4_user}' AND event_id = ${ev}")"
  [[ "${got}" == "${want:0:19}" ]] || fail "M1: saved_at della riga su ${ev}: atteso '${want:0:19}', ottenuto '${got}'"
done
echo "ok  M1: merge [A, B] -> added 2, saved_at delle righe uguali agli istanti del dispositivo"

# --- M2: idempotente e sicuro in parallelo ------------------------------------
code="$(merge m2 "${u4_cookie}" "${body}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m2.b" 'j.added')" == "0" ]] || fail "M2: secondo merge: atteso 200 added 0, ottenuto ${code} '$(cat "${tmp_dir}/m2.b")'"
[[ "$(user_rows "${u4_user}")" == "2" ]] || fail "M2: dopo il secondo merge devono restare 2 righe"
cbody="{\"items\":[{\"id\":${c_id},\"savedAt\":\"${t1}\"}]}"
merge m2p1 "${u4_cookie}" "${cbody}" >"${tmp_dir}/m2p1.code" &
pid1=$!
merge m2p2 "${u4_cookie}" "${cbody}" >"${tmp_dir}/m2p2.code" &
pid2=$!
wait "${pid1}" "${pid2}"
[[ "$(cat "${tmp_dir}/m2p1.code")" == "200" && "$(cat "${tmp_dir}/m2p2.code")" == "200" ]] || fail "M2: due merge in parallelo: attesi 200 e 200"
[[ "$(saved_rows "${u4_user}" "${c_id}")" == "1" ]] || fail "M2: due merge in parallelo di C devono lasciare una riga"
echo "ok  M2: stesso corpo di nuovo -> added 0 e 2 righe; due merge in parallelo di C -> una riga"

# --- M3: da 0 a 100 elementi, tutto il resto e' 400 ---------------------------
many() { node -e 'console.log(JSON.stringify({items: Array.from({length: Number(process.argv[1])}, (_, i) => ({id: 900000000 + i, savedAt: new Date().toISOString()}))}))' "$1"; }
code="$(merge m3a "${u4_cookie}" "$(many 101)")"
[[ "${code}" == "400" ]] || fail "M3: 101 elementi: atteso 400, ottenuto ${code}"
no_store m3a M3
for bad in '{"items":{}}' '{"items":"x"}' '{}' 'non json'; do
  code="$(merge m3b "${u4_cookie}" "${bad}")"
  [[ "${code}" == "400" ]] || fail "M3: corpo '${bad}': atteso 400, ottenuto ${code}"
done
code="$(merge m3c "${u4_cookie}" '{"items":[]}')"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m3c.b" 'j.added')" == "0" ]] || fail "M3: lista vuota: atteso 200 added 0, ottenuto ${code} '$(cat "${tmp_dir}/m3c.b")'"
code="$(merge m3d "${u4_cookie}" "$(many 100)")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m3d.b" 'j.added')" == "0" ]] || fail "M3: esattamente 100: atteso 200 added 0, ottenuto ${code} '$(cat "${tmp_dir}/m3d.b")'"
echo "ok  M3: 101 -> 400, non array / corpo vuoto / non JSON -> 400, [] -> added 0, 100 -> 200"

# --- M4: il testo del browser entra solo per le righe sparite e validato ------
mint_user u5
gone_try() { # <nome> <sourceId> <titolo> <inizio> <fine> [categoria] [sourceUrl] -> codice HTTP del merge di un id sconosciuto
  local name="$1" snap
  snap="$(snap_json "$2" "$3" "$4" "$5" "${6:-}" "${7:-}")"
  merge "${name}" "${u5_cookie}" "{\"items\":[{\"id\":999999998,\"savedAt\":\"${t1}\",\"snap\":${snap}}]}"
}
gone_rows() { psql_dev "SELECT count(*) FROM saved_events WHERE user_id = '${u5_user}' AND event_id IS NULL AND source_id = '$1'"; }
code="$(gone_try m4a gone-ok Fantasma 21 20)"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m4a.b" 'j.added')" == "1" ]] || fail "M4: istantanea valida: atteso added 1, ottenuto ${code} '$(cat "${tmp_dir}/m4a.b")'"
[[ "$(psql_dev "SELECT title FROM saved_events WHERE user_id = '${u5_user}' AND event_id IS NULL AND source_id = 'gone-ok'")" == "Fantasma" ]] || fail "M4: la riga sparita deve avere event_id NULL e titolo 'Fantasma'"
gone_try m4b gone-old Vecchio 400 396 >/dev/null
[[ "$(gone_rows gone-old)" == "0" ]] || fail "M4: un evento finito 13 mesi fa non deve entrare"
gone_try m4c gone-js Cattivo 21 20 "Sagre e feste" "javascript:alert(1)" >/dev/null
[[ "$(gone_rows gone-js)" == "0" ]] || fail "M4: sourceUrl javascript: non deve entrare"
gone_try m4d gone-cat Cattivo 21 20 Hacker >/dev/null
[[ "$(gone_rows gone-cat)" == "0" ]] || fail "M4: categoria 'Hacker' non deve entrare"
gone_try m4e gate-a EVIL 21 20 >/dev/null
[[ "$(psql_dev "SELECT count(*) FROM saved_events WHERE user_id = '${u5_user}' AND title = 'EVIL'")" == "0" ]] || fail "M4: testo del browser per un evento che esiste ancora (sotto un altro id)"
snap_a="$(snap_json gate-a EVIL 21 20)"
code="$(merge m4f "${u5_cookie}" "{\"items\":[{\"id\":${a_id},\"savedAt\":\"${t1}\",\"snap\":${snap_a}}]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m4f.b" 'j.added')" == "1" ]] || fail "M4: A: atteso added 1, ottenuto ${code} '$(cat "${tmp_dir}/m4f.b")'"
[[ "$(psql_dev "SELECT title FROM saved_events WHERE user_id = '${u5_user}' AND event_id = ${a_id}")" == "Gate A" ]] || fail "M4: il titolo della riga su A deve essere quello del server ('Gate A')"
echo "ok  M4: sparito valido -> riga con event_id NULL; 13 mesi, javascript:, categoria Hacker, evento vivo sotto altro id -> nessuna riga; A ignora 'EVIL'"

# M4 (WR-02): date fuori intervallo e NUL non fanno 500; la voce guasta si scarta e le buone entrano
poison_body() { # <guasto: date|nul|savedat> -> corpo con una voce guasta (id 999999997) e una buona (id 999999998)
  node -e '
    const [kind, source] = process.argv.slice(1)
    const d = (days) => new Date(Date.now() - days * 86400000).toISOString()
    const snap = (sid, o = {}) => ({ title: "Poison", dateStart: d(21), dateEnd: d(20), place: "Altrove (XX)", category: "Sagre e feste", source, sourceId: sid, sourceUrl: "https://example.it/e", ...o })
    const bad = kind === "date" ? snap("gone-poison", { dateStart: "+275760-09-13T00:00:00.000Z" })
      : kind === "nul" ? snap("gone-poison", { title: "a\u0000b" })
      : snap("gone-poison")
    const badAt = kind === "savedat" ? "-271821-04-20T00:00:00.000Z" : d(1)
    console.log(JSON.stringify({ items: [{ id: 999999997, savedAt: badAt, snap: bad }, { id: 999999998, savedAt: d(1), snap: snap("gone-mix", { title: "Buona" }) }] }))
  ' "$1" "${test_source}"
}
for kind in date nul savedat; do
  code="$(merge "m4p-${kind}" "${u5_cookie}" "$(poison_body "${kind}")")"
  [[ "${code}" == "200" ]] || fail "M4: voce guasta (${kind}): atteso 200 (mai 500), ottenuto ${code} '$(cat "${tmp_dir}/m4p-${kind}.b")'"
  [[ "$(gone_rows gone-poison)" == "0" ]] || fail "M4: voce guasta (${kind}): non deve entrare nessuna riga"
done
[[ "$(gone_rows gone-mix)" == "1" ]] || fail "M4: la voce buona accanto a quelle guaste deve entrare (una riga)"
echo "ok  M4: date fuori intervallo, NUL nel titolo e savedAt fuori intervallo -> 200 senza 500, voce guasta scartata, voce buona unita"

# --- M5: il tetto di 500 sull'account -----------------------------------------
mint_user u6
psql_dev "INSERT INTO saved_events (user_id, title, date_start, canonical_category, source, source_id)
          SELECT '${u6_user}', 'Tetto ' || n, now() + interval '30 days', 'Altro', '${test_source}', 'mcap-' || n FROM generate_series(1, 499) AS n" >/dev/null
code="$(merge m5 "${u6_cookie}" "{\"items\":[{\"id\":${a_id},\"savedAt\":\"${t1}\"},{\"id\":${b_id},\"savedAt\":\"${t1}\"},{\"id\":${c_id},\"savedAt\":\"${t1}\"}]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/m5.b" 'j.added')" == "1" && "$(json_get "${tmp_dir}/m5.b" 'j.overCap')" == "2" ]] || fail "M5: atteso added 1 overCap 2, ottenuto ${code} '$(cat "${tmp_dir}/m5.b")'"
[[ "$(user_rows "${u6_user}")" == "500" ]] || fail "M5: devono restare 500 righe"
echo "ok  M5: 499 righe + 3 nuovi -> added 1, overCap 2, 500 righe"

# --- M6: Origin e sessione prima di ogni query --------------------------------
code="$(call m6a POST /api/v1/me/saved/merge -H "${u4_cookie}" -H 'Content-Type: application/json' --data '{"items":[]}')"
[[ "${code}" == "403" ]] || fail "M6: senza Origin: atteso 403, ottenuto ${code}"
no_store m6a M6
code="$(call m6b POST /api/v1/me/saved/merge -H "Origin: ${origin}" -H 'Content-Type: application/json' --data '{"items":[]}')"
[[ "${code}" == "401" ]] || fail "M6: senza cookie: atteso 401, ottenuto ${code}"
no_store m6b M6
no_store m2 M6
echo "ok  M6: merge senza Origin -> 403, senza cookie -> 401, sempre private, no-store"

# ============================ Lista dell'account e righe sparite =============
# --- L1: la lista porta istantanea e riga viva --------------------------------
mint_user u7
mint_user u8
code="$(put l1p "${a_id}" "${u7_cookie}")"
[[ "${code}" == "200" ]] || fail "L1: PUT A: atteso 200, ottenuto ${code}"
psql_dev "INSERT INTO saved_events (user_id, title, date_start, canonical_category, source, source_id)
          VALUES ('${u7_user}', 'Sparito G', now() - interval '30 days', 'Altro', '${test_source}', 'list-g'),
                 ('${u8_user}', 'Sparito G2', now() - interval '30 days', 'Altro', '${test_source}', 'list-g2')" >/dev/null
code="$(call l1 GET /api/v1/me/saved -H "${u7_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/l1.b" 'j.items.length')" == "2" ]] || fail "L1: attesi 200 e 2 elementi, ottenuto ${code} '$(cat "${tmp_dir}/l1.b")'"
[[ "$(json_get "${tmp_dir}/l1.b" "j.items.filter((i) => i.eventId === ${a_id} && i.live !== null && i.live.title === 'Gate A' && i.snap.title === 'Gate A').length")" == "1" ]] || fail "L1: A deve avere eventId, live e snap, corpo '$(cat "${tmp_dir}/l1.b")'"
[[ "$(json_get "${tmp_dir}/l1.b" "j.items.filter((i) => i.eventId === null && i.live === null && i.snap.title === 'Sparito G').length")" == "1" ]] || fail "L1: G deve avere eventId e live nulli e titolo 'Sparito G', corpo '$(cat "${tmp_dir}/l1.b")'"
echo "ok  L1: GET lista -> A con eventId e live, G (sparito) con eventId e live nulli e la sua istantanea"

# --- L2: la riga sparita la toglie solo il suo proprietario -------------------
g_ref="$(psql_dev "SELECT id FROM saved_events WHERE user_id = '${u7_user}' AND source_id = 'list-g'")"
g2_ref="$(psql_dev "SELECT id FROM saved_events WHERE user_id = '${u8_user}' AND source_id = 'list-g2'")"
a_ref="$(psql_dev "SELECT id FROM saved_events WHERE user_id = '${u7_user}' AND event_id = ${a_id}")"
gone_del() { call "$1" DELETE "/api/v1/me/saved/gone/$2" -H "Origin: ${origin}" -H "$3"; }
code="$(gone_del l2a "${g2_ref}" "${u7_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/l2a.b" 'j.removed')" == "0" ]] || fail "L2: la riga di un altro utente: atteso removed 0, ottenuto ${code} '$(cat "${tmp_dir}/l2a.b")'"
[[ "$(user_rows "${u8_user}")" == "1" ]] || fail "L2: la riga di u8 e' stata tolta da u7"
code="$(gone_del l2b "${a_ref}" "${u7_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/l2b.b" 'j.removed')" == "0" ]] || fail "L2: riga viva (A): atteso removed 0, ottenuto ${code} '$(cat "${tmp_dir}/l2b.b")'"
[[ "$(saved_rows "${u7_user}" "${a_id}")" == "1" ]] || fail "L2: la riga viva su A e' stata tolta da gone"
code="$(gone_del l2c "${g_ref}" "${u7_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/l2c.b" 'j.removed')" == "1" ]] || fail "L2: riga sparita: atteso removed 1, ottenuto ${code} '$(cat "${tmp_dir}/l2c.b")'"
code="$(gone_del l2d "${g_ref}" "${u7_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/l2d.b" 'j.removed')" == "0" ]] || fail "L2: secondo DELETE: atteso removed 0, ottenuto ${code} '$(cat "${tmp_dir}/l2d.b")'"
code="$(call l2e DELETE "/api/v1/me/saved/gone/abc" -H "Origin: ${origin}" -H "${u7_cookie}")"
[[ "${code}" == "404" ]] || fail "L2: ref 'abc': atteso 404, ottenuto ${code}"
echo "ok  L2: DELETE gone -> removed 1 una volta sola; riga viva e riga altrui -> removed 0 e restano"

# --- L3: sessione, Origin e cache ---------------------------------------------
code="$(call l3a GET /api/v1/me/saved)"
[[ "${code}" == "401" ]] || fail "L3: GET lista senza cookie: atteso 401, ottenuto ${code}"
no_store l3a L3
no_store l1 L3
code="$(call l3b DELETE "/api/v1/me/saved/gone/${g2_ref}" -H "${u8_cookie}")"
[[ "${code}" == "403" ]] || fail "L3: DELETE gone senza Origin: atteso 403, ottenuto ${code}"
no_store l3b L3
code="$(call l3c DELETE "/api/v1/me/saved/gone/${g2_ref}" -H "Origin: ${origin}")"
[[ "${code}" == "401" ]] || fail "L3: DELETE gone senza cookie: atteso 401, ottenuto ${code}"
no_store l3c L3
no_store l2c L3
echo "ok  L3: lista senza cookie -> 401; DELETE gone senza Origin -> 403, senza cookie -> 401; sempre private, no-store"

# ============================ Altre date e "Data cambiata" ===================
# --- D1: resolve porta le altre date future della serie ----------------------
code="$(post_ids d1 "{\"ids\":[${t5_id}]}")"
[[ "${code}" == "200" ]] || fail "D1: resolve: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/d1.b" 'j.items[0].siblings.map((s) => s.id).join(",")')" == "${t12_id},${t19_id}" ]] || fail "D1: siblings attesi ${t12_id},${t19_id} (non la data finita ne' il decoy), corpo '$(cat "${tmp_dir}/d1.b")'"
echo "ok  D1: resolve [torino +5] -> siblings esattamente +12 e +19"

# --- D2: l'ack porta l'istantanea alle date vive, solo per chi lo chiede -------
mint_user u9
mint_user u10
code="$(put d2p "${t5_id}" "${u9_cookie}")"
[[ "${code}" == "200" ]] || fail "D2: PUT torino +5: atteso 200, ottenuto ${code}"
psql_dev "UPDATE saved_events SET date_start = date_start - interval '3 days', date_end = date_end - interval '3 days' WHERE user_id = '${u9_user}' AND event_id = ${t5_id}" >/dev/null
code="$(call d2g GET /api/v1/me/saved -H "${u9_cookie}")"
[[ "${code}" == "200" ]] || fail "D2: GET lista: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/d2g.b" "j.items.filter((i) => i.eventId === ${t5_id} && i.live !== null && i.snap.dateStart !== i.live.dateStart).length")" == "1" ]] || fail "D2: l'istantanea spostata deve avere date diverse da quelle vive, corpo '$(cat "${tmp_dir}/d2g.b")'"
stale() { psql_dev "SELECT count(*) FROM saved_events s JOIN events e ON e.id = s.event_id WHERE s.user_id = '${u9_user}' AND s.event_id = ${t5_id} AND (s.date_start <> e.date_start OR s.date_end IS DISTINCT FROM e.date_end)"; }
# La sola lettura della lista non riallinea nulla (anti-pattern "ack su GET").
[[ "$(stale)" == "1" ]] || fail "D2: il GET della lista non deve riallineare l'istantanea"
ack() { call "$1" POST /api/v1/me/saved/ack -H "Origin: ${origin}" -H "$2" -H 'Content-Type: application/json' --data "$3"; }
code="$(ack d2o "${u10_cookie}" "{\"eventIds\":[${t5_id}]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/d2o.b" 'j.updated')" == "0" ]] || fail "D2: l'ack di un altro utente: atteso updated 0, ottenuto ${code} '$(cat "${tmp_dir}/d2o.b")'"
[[ "$(stale)" == "1" ]] || fail "D2: l'ack di un altro utente ha toccato la riga di u9"
code="$(ack d2a "${u9_cookie}" "{\"eventIds\":[${t5_id}]}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/d2a.b" 'j.updated')" == "1" ]] || fail "D2: ack: atteso updated 1, ottenuto ${code} '$(cat "${tmp_dir}/d2a.b")'"
[[ "$(stale)" == "0" ]] || fail "D2: dopo l'ack l'istantanea deve avere le date dell'evento"
no_store d2a D2
code="$(call d2n POST /api/v1/me/saved/ack -H "${u9_cookie}" -H 'Content-Type: application/json' --data "{\"eventIds\":[${t5_id}]}")"
[[ "${code}" == "403" ]] || fail "D2: ack senza Origin: atteso 403, ottenuto ${code}"
code="$(call d2c POST /api/v1/me/saved/ack -H "Origin: ${origin}" -H 'Content-Type: application/json' --data "{\"eventIds\":[${t5_id}]}")"
[[ "${code}" == "401" ]] || fail "D2: ack senza cookie: atteso 401, ottenuto ${code}"
for bad in '{"eventIds":[]}' '{"eventIds":["7"]}' '{"eventIds":[0]}' 'non json'; do
  code="$(ack d2b "${u9_cookie}" "${bad}")"
  [[ "${code}" == "400" ]] || fail "D2: corpo '${bad}': atteso 400, ottenuto ${code}"
done
echo "ok  D2: ack -> updated 1 e istantanea uguale all'evento (mai sul GET); altro utente -> updated 0; senza Origin -> 403, senza cookie -> 401, corpo errato -> 400"

# ============================ Feed del calendario (CAL-03) ===================
mint_user u11
mint_user u12
code="$(put f1a "${a_id}" "${u11_cookie}")"
[[ "${code}" == "200" ]] || fail "F1: PUT A: atteso 200, ottenuto ${code}"
code="$(put f1p "${p_id}" "${u11_cookie}")"
[[ "${code}" == "200" ]] || fail "F1: PUT P (passato): atteso 200, ottenuto ${code} '$(cat "${tmp_dir}/f1p.b")'"
psql_dev "INSERT INTO saved_events (user_id, title, date_start, date_end, canonical_category, source, source_id)
          VALUES ('${u11_user}', 'Feed Vecchio', now() - interval '41 days', now() - interval '40 days', 'Altro', '${test_source}', 'feed-old')" >/dev/null
a_row="$(psql_dev "SELECT id FROM saved_events WHERE user_id = '${u11_user}' AND event_id = ${a_id}")"
p_row="$(psql_dev "SELECT id FROM saved_events WHERE user_id = '${u11_user}' AND event_id = ${p_id}")"
feed_post() { call "$1" POST /api/v1/me/calendar-feed -H "Origin: ${origin}" -H "$2"; }

# --- F1: il link si crea una volta e resta lo stesso --------------------------
code="$(feed_post f1 "${u11_cookie}")"
[[ "${code}" == "200" ]] || fail "F1: POST calendar-feed: atteso 200, ottenuto ${code} '$(cat "${tmp_dir}/f1.b")'"
feed_path="$(json_get "${tmp_dir}/f1.b" 'j.path')"
[[ "${feed_path}" =~ ^/cal/[A-Za-z0-9_-]{22}\.ics$ ]] || fail "F1: path inatteso '${feed_path}'"
code="$(feed_post f1b "${u11_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/f1b.b" 'j.path')" == "${feed_path}" ]] || fail "F1: il secondo POST deve dare lo stesso path, ottenuto ${code} '$(cat "${tmp_dir}/f1b.b")'"
[[ "$(psql_dev "SELECT count(*) FROM calendar_feeds WHERE user_id = '${u11_user}'")" == "1" ]] || fail "F1: attesa una sola riga in calendar_feeds"
echo "ok  F1: POST calendar-feed -> path /cal/{22 caratteri}.ics, secondo POST uguale, una riga"

# --- F2: il feed ---------------------------------------------------------------
hdr() { grep -i "^$2:" "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r'; }
code="$(call f2 GET "${feed_path}")"
[[ "${code}" == "200" ]] || fail "F2: GET feed: atteso 200, ottenuto ${code}"
[[ "$(hdr f2 content-type)" == "text/calendar; charset=utf-8" ]] || fail "F2: content-type '$(hdr f2 content-type)'"
[[ "$(hdr f2 cache-control)" == "private, no-cache" ]] || fail "F2: cache-control '$(hdr f2 cache-control)'"
[[ "$(hdr f2 referrer-policy)" == "no-referrer" ]] || fail "F2: referrer-policy '$(hdr f2 referrer-policy)'"
[[ "$(hdr f2 x-robots-tag)" == "noindex" ]] || fail "F2: x-robots-tag '$(hdr f2 x-robots-tag)'"
feed_lines() { tr -d '\r' <"${tmp_dir}/$1.b"; }
[[ "$(feed_lines f2 | grep -c '^BEGIN:VEVENT$')" == "2" ]] || fail "F2: attesi due BEGIN:VEVENT (A e P, non la riga finita 40 giorni fa), ottenuti $(feed_lines f2 | grep -c '^BEGIN:VEVENT$')"
feed_lines f2 | grep -q '^SUMMARY:Gate A$' || fail "F2: manca Gate A"
feed_lines f2 | grep -q '^SUMMARY:Gate P$' || fail "F2: manca Gate P"
if feed_lines f2 | grep -q 'Feed Vecchio'; then fail "F2: la riga finita 40 giorni fa non deve esserci"; fi
[[ "$(feed_lines f2 | grep -c '^BEGIN:VALARM$')" == "1" && "$(feed_lines f2 | grep -c '^TRIGGER:-PT6H$')" == "1" ]] || fail "F2: atteso un solo VALARM con TRIGGER:-PT6H"
feed_lines f2 | grep -q "^UID:saved-${a_row}@fuori-rotta.it$" || fail "F2: manca UID saved-${a_row}@fuori-rotta.it"
feed_lines f2 | grep -q "^UID:saved-${p_row}@fuori-rotta.it$" || fail "F2: manca UID saved-${p_row}@fuori-rotta.it"
[[ "$(LC_ALL=C awk '{ if (length($0) > 76) n++ } END { print n + 0 }' "${tmp_dir}/f2.b")" == "0" ]] || fail "F2: righe oltre 75 ottetti"
code="$(call f2b GET "${feed_path}")"
[[ "${code}" == "200" ]] && cmp -s "${tmp_dir}/f2.b" "${tmp_dir}/f2b.b" || fail "F2: due GET devono dare gli stessi byte"
echo "ok  F2: feed 200, quattro header, due VEVENT (A, P), un VALARM -PT6H, UID saved-{riga}, righe <= 75, due GET identici"

# --- F3: rigenerare uccide il vecchio link, e ogni 404 e' lo stesso -----------
same_404() { # <nome> <riferimento> <sezione>: stato, header senza Date e corpo identici
  grep -qE '^HTTP/[0-9.]+ 404' "${tmp_dir}/$1.h" || fail "$3: $1 non e' un 404"
  [[ "$(grep -vi '^date:' "${tmp_dir}/$1.h" | tr -d '\r' | sort)" == "$(grep -vi '^date:' "${tmp_dir}/$2.h" | tr -d '\r' | sort)" ]] || fail "$3: gli header di $1 e $2 differiscono"
  cmp -s "${tmp_dir}/$1.b" "${tmp_dir}/$2.b" || fail "$3: il corpo di $1 e $2 differisce"
}
code="$(call f3rot POST /api/v1/me/calendar-feed/rotate -H "Origin: ${origin}" -H "${u11_cookie}")"
[[ "${code}" == "200" ]] || fail "F3: rotate: atteso 200, ottenuto ${code} '$(cat "${tmp_dir}/f3rot.b")'"
new_path="$(json_get "${tmp_dir}/f3rot.b" 'j.path')"
[[ "${new_path}" =~ ^/cal/[A-Za-z0-9_-]{22}\.ics$ && "${new_path}" != "${feed_path}" ]] || fail "F3: il nuovo path deve essere valido e diverso, ottenuto '${new_path}'"
code="$(call f3old GET "${feed_path}")"
[[ "${code}" == "404" ]] || fail "F3: il vecchio path: atteso 404, ottenuto ${code}"
code="$(call f3unk GET "/cal/AAAAAAAAAAAAAAAAAAAAAA.ics")"
[[ "${code}" == "404" ]] || fail "F3: token ignoto: atteso 404, ottenuto ${code}"
code="$(call f3short GET "/cal/short.ics")"
[[ "${code}" == "404" ]] || fail "F3: nome corto: atteso 404, ottenuto ${code}"
code="$(call f3txt GET "${new_path%.ics}.txt")"
[[ "${code}" == "404" ]] || fail "F3: token valido con .txt: atteso 404, ottenuto ${code}"
same_404 f3old f3unk F3
same_404 f3short f3unk F3
same_404 f3txt f3unk F3
code="$(call f3new GET "${new_path}")"
[[ "${code}" == "200" ]] || fail "F3: il nuovo path: atteso 200, ottenuto ${code}"
[[ "$(psql_dev "SELECT count(*) FROM calendar_feeds WHERE user_id = '${u11_user}'")" == "1" ]] || fail "F3: rotate deve lasciare una sola riga"
echo "ok  F3: rotate -> path nuovo 200; il vecchio, un token ignoto, un nome corto e .txt rispondono lo stesso 404 (header senza Date e corpo)"

# --- F4: senza salvati il calendario e' valido e vuoto -------------------------
code="$(feed_post f4p "${u12_cookie}")"
[[ "${code}" == "200" ]] || fail "F4: POST calendar-feed: atteso 200, ottenuto ${code}"
empty_path="$(json_get "${tmp_dir}/f4p.b" 'j.path')"
code="$(call f4 GET "${empty_path}")"
[[ "${code}" == "200" ]] || fail "F4: GET feed vuoto: atteso 200, ottenuto ${code}"
[[ "$(feed_lines f4 | grep -c '^BEGIN:VCALENDAR$')" == "1" && "$(feed_lines f4 | grep -c '^END:VCALENDAR$')" == "1" ]] || fail "F4: atteso un solo VCALENDAR"
[[ "$(feed_lines f4 | grep -c '^BEGIN:VEVENT$')" == "0" ]] || fail "F4: nessun VEVENT atteso"
echo "ok  F4: utente senza salvati -> 200, un VCALENDAR e zero VEVENT"

# --- F5: creare il link richiede Origin e sessione ----------------------------
code="$(call f5a POST /api/v1/me/calendar-feed -H "${u11_cookie}")"
[[ "${code}" == "403" ]] || fail "F5: senza Origin: atteso 403, ottenuto ${code}"
no_store f5a F5
code="$(call f5b POST /api/v1/me/calendar-feed -H "Origin: ${origin}")"
[[ "${code}" == "401" ]] || fail "F5: senza cookie: atteso 401, ottenuto ${code}"
no_store f5b F5
code="$(call f5c POST /api/v1/me/calendar-feed/rotate -H "${u11_cookie}")"
[[ "${code}" == "403" ]] || fail "F5: rotate senza Origin: atteso 403, ottenuto ${code}"
code="$(call f5d POST /api/v1/me/calendar-feed/rotate -H "Origin: ${origin}")"
[[ "${code}" == "401" ]] || fail "F5: rotate senza cookie: atteso 401, ottenuto ${code}"
echo "ok  F5: calendar-feed senza Origin -> 403, senza cookie -> 401 (anche rotate), private, no-store"

# --- F6: con l'accesso spento il feed non esiste piu', i salvati degli ospiti si ----
stop_server
bash scripts/dev-db.sh env "${auth_env[@]}" AUTH_ENABLED=false npx next dev -p "${port}" >"${tmp_dir}/dev-server-off.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
code="$(call f6 GET "${new_path}")"
[[ "${code}" == "404" ]] || fail "F6: feed con accesso spento: atteso 404, ottenuto ${code}"
same_404 f6 f3unk F6
code="$(call f6ids GET /api/v1/me/saved/ids -H "${u11_cookie}")"
[[ "${code}" == "404" ]] || fail "F6: GET ids con accesso spento: atteso 404, ottenuto ${code}"
code="$(post_ids f6res "{\"ids\":[${a_id}]}")"
[[ "${code}" == "200" ]] || fail "F6: resolve con accesso spento: atteso 200, ottenuto ${code}"
echo "ok  F6: accesso spento -> il feed risponde il 404 di F3, GET ids 404, resolve [A] 200"

echo "Riepilogo: R1-R7, A1-A3, S1-S9, M1-M6, L1-L3, D1-D2, F1-F6 verdi"
