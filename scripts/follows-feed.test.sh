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
#   Eventi di prova in una regione R senza eventi veri, con due comuni C1, C2 della stessa
#   provincia P: E1 C1 Sagre +3, E2 C1 Musica +5, E3 senza comune Sagre +4, E4 membro di E1,
#   E5 C1 passato, E6 C2 Arte +6, E7 C1 Altro in corso (da -10 a +10 giorni).
#   FE4  segui R -> total 5, ordine E7, E1, E3, E2, E6 (l'in corso conta da oggi), E4 e E5 assenti
#   FE5  segui solo P -> total 4 (E3 non ha comune)
#   FE6  segui solo C1 -> total 3 (E7, E1, E2)
#   FE7  C1 + categoria Sagre e feste -> esattamente E1 (AND)
#   FE8  R + P + C1 -> total 5 e nessun id ripetuto
#   FE9  solo categoria Sagre e feste -> E1 e E3 presenti, total = tutti i canonici disponibili Sagre
#   FE10 limit=2, offset=2&limit=2, limit=999 (al piu' 24), limit=abc (al piu' 10)
#   FE11 utente senza follow -> {items:[], total:0, follows:0}
#   FE15 con AUTH_ENABLED=false: /per-te 200 (guscio) e /api/v1/me/state -> {"enabled":false,"user":null}
#   FE13 GET /per-te con e senza sessione -> 200, h1 'Per te', meta robots noindex, corpi identici
#   FE14 utente con follow su R -> total 5 con limit=12 (una pagina); limit=2 a offset 0, 2, 4 -> 2, 2, 1 voci
#   FE12 senza cookie -> 401 private, no-store; server riavviato con AUTH_ENABLED=false -> 404
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
# Soglia della FINE (windowEndFloor): mezzanotte UTC del giorno di Roma, cioe' le cifre del giorno di Roma a 00:00.
end_floor="$(psql_dev "SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Rome')")"
[[ -n "${end_floor}" ]] || fail "soglia di fine di oggi non calcolata"

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
want="$(psql_dev "SELECT count(*) FROM events WHERE region = 'lombardia' AND canonical_event_id IS NULL AND (date_end >= '${end_floor}' OR (date_end IS NULL AND date_start >= '${window_start}'))")"
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

# --- Eventi di prova: una regione senza eventi veri e due comuni della stessa provincia --
region_slug="" ; region_name=""
for cand in "molise|Molise" "basilicata|Basilicata" "umbria|Umbria" "calabria|Calabria"; do
  slug="${cand%%|*}"
  if [[ "$(psql_dev "SELECT count(*) FROM events WHERE region = '${slug}' AND source <> '__follows_feed_gate__'")" == "0" ]]; then
    region_slug="${slug}" ; region_name="${cand##*|}" ; break
  fi
done
[[ -n "${region_slug}" ]] || fail "nessuna regione silenziosa fra molise, basilicata, umbria, calabria: il DB locale ha eventi dappertutto?"
prov="$(psql_dev "SELECT province_code FROM comuni WHERE region_name = '${region_name}' GROUP BY province_code HAVING count(*) >= 2 ORDER BY province_code LIMIT 1")"
[[ -n "${prov}" ]] || fail "nessuna provincia di ${region_name} con due comuni"
c1="$(psql_dev "SELECT istat_code FROM comuni WHERE province_code = '${prov}' ORDER BY istat_code LIMIT 1")"
c2="$(psql_dev "SELECT istat_code FROM comuni WHERE province_code = '${prov}' ORDER BY istat_code OFFSET 1 LIMIT 1")"
[[ -n "${c1}" && -n "${c2}" && "${c1}" != "${c2}" ]] || fail "due comuni distinti di ${prov} non trovati"

# new_event <sorgente-id> <titolo> <comune|-> <categoria> <da giorni> <a giorni|-> [canonica]
new_event() {
  local sid="$1" title="$2" comune="$3" cat="$4" from="$5" to="$6" canonical="${7:-NULL}" cid end
  if [[ "${comune}" == "-" ]]; then cid="NULL"; else cid="(SELECT id FROM comuni WHERE istat_code = '${comune}')"; fi
  if [[ "${to}" == "-" ]]; then end="NULL"; else end="now() + interval '${to} days'"; fi
  psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, comune_id, location_name, region, canonical_category, canonical_event_id) VALUES ('__follows_feed_gate__', '${sid}', '${title}', now() + interval '${from} days', ${end}, ${cid}, 'Piazza di prova', '${region_slug}', '${cat}', ${canonical}) RETURNING id" | head -n 1
}
e1="$(new_event e1 'Gate feed E1' "${c1}" 'Sagre e feste' 3 4)"
e2="$(new_event e2 'Gate feed E2' "${c1}" 'Musica e spettacolo' 5 6)"
e3="$(new_event e3 'Gate feed E3' - 'Sagre e feste' 4 5)"
e4="$(new_event e4 'Gate feed E4' "${c1}" 'Sagre e feste' 3 4 "${e1}")"
e5="$(new_event e5 'Gate feed E5' "${c1}" 'Sagre e feste' -20 -19)"
e6="$(new_event e6 'Gate feed E6' "${c2}" 'Arte e cultura' 6 7)"
e7="$(new_event e7 'Gate feed E7' "${c1}" 'Altro' -10 10)"
for v in e1 e2 e3 e4 e5 e6 e7; do [[ -n "${!v}" ]] || fail "fixture ${v} non creata"; done

mint_user fx
# follows <kind:key> ... : sostituisce i follow di fx con quelli indicati
set_follows() {
  psql_dev "DELETE FROM user_follows WHERE user_id = '${fx_user}'" >/dev/null
  local f
  for f in "$@"; do add_follow "${fx_user}" "${f%%:*}" "${f#*:}"; done
}
ids_of() { json_get "${tmp_dir}/$1.b" 'j.items.map((e) => e.id).join(",")'; }
total_of() { json_get "${tmp_dir}/$1.b" 'j.total'; }

# --- FE4: la regione, l'in corso conta da oggi, il membro e il passato fuori -----
set_follows "region:${region_slug}"
code="$(get_feed fe4 "${fx_cookie}" '?limit=24')"
[[ "${code}" == "200" ]] || fail "FE4: atteso 200, ottenuto ${code}"
[[ "$(total_of fe4)" == "5" ]] || fail "FE4: total atteso 5, ottenuto $(total_of fe4) ($(ids_of fe4))"
[[ "$(ids_of fe4)" == "${e7},${e1},${e3},${e2},${e6}" ]] || fail "FE4: ordine atteso E7,E1,E3,E2,E6 (${e7},${e1},${e3},${e2},${e6}), ottenuto $(ids_of fe4) (E4=${e4} E5=${e5})"
echo "ok  FE4: regione ${region_slug} -> total 5, ordine E7,E1,E3,E2,E6; membro E4 e passato E5 assenti"

# --- FE5: la provincia non prende gli eventi senza comune -------------------------
set_follows "province:${prov}"
get_feed fe5 "${fx_cookie}" '?limit=24' >/dev/null
[[ "$(total_of fe5)" == "4" && "$(ids_of fe5)" == "${e7},${e1},${e2},${e6}" ]] || fail "FE5: attesi E7,E1,E2,E6 (total 4), ottenuti $(ids_of fe5) (total $(total_of fe5))"
echo "ok  FE5: provincia ${prov} -> total 4 (E3 senza comune resta fuori)"

# --- FE6: il comune ---------------------------------------------------------------
set_follows "comune:${c1}"
get_feed fe6 "${fx_cookie}" '?limit=24' >/dev/null
[[ "$(total_of fe6)" == "3" && "$(ids_of fe6)" == "${e7},${e1},${e2}" ]] || fail "FE6: attesi E7,E1,E2 (total 3), ottenuti $(ids_of fe6) (total $(total_of fe6))"
echo "ok  FE6: comune ${c1} -> total 3 (E7, E1, E2)"

# --- FE7: luogo E categoria sono in AND -------------------------------------------
set_follows "comune:${c1}" "category:Sagre e feste"
get_feed fe7 "${fx_cookie}" '?limit=24' >/dev/null
[[ "$(total_of fe7)" == "1" && "$(ids_of fe7)" == "${e1}" ]] || fail "FE7: atteso solo E1 (${e1}), ottenuti $(ids_of fe7) (total $(total_of fe7))"
echo "ok  FE7: comune ${c1} + categoria Sagre e feste -> solo E1 (AND)"

# --- FE8: follow sovrapposti non duplicano ----------------------------------------
set_follows "region:${region_slug}" "province:${prov}" "comune:${c1}"
get_feed fe8 "${fx_cookie}" '?limit=24' >/dev/null
[[ "$(total_of fe8)" == "5" ]] || fail "FE8: total atteso 5, ottenuto $(total_of fe8)"
[[ "$(json_get "${tmp_dir}/fe8.b" 'new Set(j.items.map((e) => e.id)).size === j.items.length')" == "true" ]] || fail "FE8: un id compare due volte ($(ids_of fe8))"
echo "ok  FE8: regione + provincia + comune -> total 5 e nessun id ripetuto"

# --- FE9: solo la categoria, in tutte le regioni ----------------------------------
set_follows "category:Sagre e feste"
get_feed fe9 "${fx_cookie}" '?limit=24' >/dev/null
want="$(psql_dev "SELECT count(*) FROM events WHERE canonical_category = 'Sagre e feste' AND canonical_event_id IS NULL AND (date_end >= '${end_floor}' OR (date_end IS NULL AND date_start >= '${window_start}'))")"
[[ "$(total_of fe9)" == "${want}" ]] || fail "FE9: total $(total_of fe9), atteso ${want} (tutti i canonici disponibili Sagre e feste)"
# Il feed e' limitato a 24, E1 ed E3 possono non stare nella prima pagina: si leggono tutte le pagine.
all_ids=""
off=0
while [[ "${off}" -lt "${want}" ]]; do
  get_feed fe9p "${fx_cookie}" "?limit=24&offset=${off}" >/dev/null
  all_ids="${all_ids},$(ids_of fe9p),"
  off=$((off + 24))
done
[[ "${all_ids}" == *",${e1},"* && "${all_ids}" == *",${e3},"* ]] || fail "FE9: E1 (${e1}) e E3 (${e3}) devono comparire fra le pagine"
echo "ok  FE9: categoria Sagre e feste -> total ${want}, E1 ed E3 presenti"

# --- FE10: paginazione e limiti ----------------------------------------------------
set_follows "region:${region_slug}"
get_feed fe10a "${fx_cookie}" '?limit=2' >/dev/null
[[ "$(ids_of fe10a)" == "${e7},${e1}" ]] || fail "FE10: limit=2 -> attesi E7,E1, ottenuti $(ids_of fe10a)"
get_feed fe10b "${fx_cookie}" '?limit=2&offset=2' >/dev/null
[[ "$(ids_of fe10b)" == "${e3},${e2}" && "$(total_of fe10b)" == "5" ]] || fail "FE10: offset=2&limit=2 -> attesi E3,E2 con total 5, ottenuti $(ids_of fe10b)"
get_feed fe10c "${u1_cookie}" '?limit=999' >/dev/null
[[ "$(json_get "${tmp_dir}/fe10c.b" 'j.items.length')" == "24" ]] || fail "FE10: limit=999 -> attese 24 voci, ottenute $(json_get "${tmp_dir}/fe10c.b" 'j.items.length')"
get_feed fe10d "${u1_cookie}" '?limit=abc&offset=x' >/dev/null
[[ "$(json_get "${tmp_dir}/fe10d.b" 'j.items.length')" == "10" ]] || fail "FE10: limit=abc -> attese 10 voci, ottenute $(json_get "${tmp_dir}/fe10d.b" 'j.items.length')"
echo "ok  FE10: limit=2, offset=2, limit=999 -> 24, limit=abc -> 10"

# --- FE11: nessun follow -----------------------------------------------------------
set_follows
code="$(get_feed fe11 "${fx_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/fe11.b" 'JSON.stringify(j)')" == '{"items":[],"total":0,"follows":0}' ]] || fail "FE11: atteso {items:[],total:0,follows:0}, ottenuto ${code} '$(cat "${tmp_dir}/fe11.b")'"
no_store fe11 FE11
echo "ok  FE11: utente senza follow -> {items:[], total:0, follows:0}"

# --- FE13: /per-te e' un guscio statico, uguale per tutti ---------------------------
for who in anon session; do
  if [[ "${who}" == "anon" ]]; then code="$(call "fe13${who}" GET /per-te)"; else code="$(call "fe13${who}" GET /per-te -H "${u1_cookie}")"; fi
  [[ "${code}" == "200" ]] || fail "FE13 (${who}): GET /per-te: atteso 200, ottenuto ${code}"
  grep -q '>Per te</h1>' "${tmp_dir}/fe13${who}.b" || fail "FE13 (${who}): manca l'h1 'Per te'"
  grep -qE '<meta name="robots" content="[^"]*noindex' "${tmp_dir}/fe13${who}.b" || fail "FE13 (${who}): manca il meta robots noindex"
done
# Il dev server stampa un id casuale per richiesta (self.__next_r): fuori dal confronto, il resto deve coincidere.
[[ "$(sed 's/__next_r="[^"]*"//' "${tmp_dir}/fe13anon.b" | cksum)" == "$(sed 's/__next_r="[^"]*"//' "${tmp_dir}/fe13session.b" | cksum)" ]] || fail "FE13: /per-te con e senza sessione ha corpi diversi"
echo "ok  FE13: /per-te con e senza sessione -> 200, h1 'Per te', noindex, corpi identici"

# --- FE14: l'aritmetica di pagina del client (12 per pagina) ---------------------
set_follows "region:${region_slug}"
get_feed fe14a "${fx_cookie}" '?limit=12' >/dev/null
[[ "$(total_of fe14a)" == "5" && "$(json_get "${tmp_dir}/fe14a.b" 'j.items.length')" == "5" ]] || fail "FE14: limit=12 -> attesi total 5 e 5 voci (una sola pagina), ottenuti total $(total_of fe14a)"
get_feed fe14b "${fx_cookie}" '?limit=2&offset=0' >/dev/null
get_feed fe14c "${fx_cookie}" '?limit=2&offset=2' >/dev/null
get_feed fe14d "${fx_cookie}" '?limit=2&offset=4' >/dev/null
[[ "$(ids_of fe14b),$(ids_of fe14c),$(ids_of fe14d)" == "${e7},${e1},${e3},${e2},${e6}" ]] || fail "FE14: pagine da 2 attese E7,E1 | E3,E2 | E6, ottenuto $(ids_of fe14b) | $(ids_of fe14c) | $(ids_of fe14d)"
[[ "$(json_get "${tmp_dir}/fe14d.b" 'j.items.length')" == "1" && "$(total_of fe14d)" == "5" ]] || fail "FE14: l'ultima pagina attesa di 1 voce con total 5"
echo "ok  FE14: limit=12 -> 5 voci in una pagina; limit=2 a offset 0, 2, 4 -> 2, 2, 1 voci nell'ordine di FE4"

# --- FE12: sessione e interruttore --------------------------------------------------
code="$(call fe12a GET /api/v1/me/feed)"
[[ "${code}" == "401" ]] || fail "FE12: senza cookie atteso 401, ottenuto ${code}"
no_store fe12a FE12
stop_server
bash scripts/dev-db.sh env "${auth_env[@]}" AUTH_ENABLED=false npx next dev -p "${port}" >"${tmp_dir}/dev-server-off.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
code="$(get_feed fe12b "${u1_cookie}")"
[[ "${code}" == "404" ]] || fail "FE12: con l'accesso spento atteso 404, ottenuto ${code}"
no_store fe12b FE12
echo "ok  FE12: senza cookie 401 private, no-store; con AUTH_ENABLED=false 404 private, no-store"

# --- FE15: accesso spento sul server, flag di build acceso -------------------------
# Il guscio resta 200 (statico) e lo stato risponde enabled:false: su questa risposta il client
# mostra "Per te non è disponibile". Solo la build senza flag e' un 404 (ramo di notFound).
code="$(call fe15a GET /per-te)"
[[ "${code}" == "200" ]] || fail "FE15: GET /per-te con AUTH_ENABLED=false: atteso 200, ottenuto ${code}"
code="$(call fe15b GET /api/v1/me/state)"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/fe15b.b" 'JSON.stringify(j)')" == '{"enabled":false,"user":null}' ]] || fail "FE15: /api/v1/me/state atteso {\"enabled\":false,\"user\":null}, ottenuto ${code} '$(cat "${tmp_dir}/fe15b.b")'"
echo "ok  FE15: AUTH_ENABLED=false -> /per-te 200 (guscio statico) e /api/v1/me/state {enabled:false,user:null}"

echo "Riepilogo: FE1-FE15 verdi"
