#!/usr/bin/env bash
# Gate del link di condivisione della lista (check:share, test:local) - SHARE-02.
#
# Perche' esiste: /l/{codice} e' una pagina pubblica il cui unico segreto e' il
# codice nell'indirizzo. Le cose che la rendono sicura (pagina dinamica, 404 per
# ogni link morto, niente dati del proprietario, header che vietano Referer,
# indicizzazione e cache) non si vedono in un dev server: si provano su una build
# di produzione, servita dallo STESSO server.js standalone che esegue l'immagine
# Docker (assunzione A1 della ricerca: headers() sotto output 'standalone').
#
# Perche' ogni comando passa da scripts/dev-db.sh con valori ESPLICITI: .env.local
# punta a PRODUZIONE. Le variabili di accesso della build sono passate vuote.
#
# Sezioni (il piano 02 le estende):
#   B1  /l/[token] e' dinamica (ƒ) nella tabella delle rotte; nessun loading.* sotto app/l
#       o direttamente sotto app; il codice di app/l non ha Suspense, cookies(, headers(
#       ne' searchParams
#   O1  GET share prima di ogni POST: {link:null, upcoming:1}, private no-store, zero righe;
#       POST -> un path /l/{22 caratteri} con showName false, secondo POST uguale e una riga,
#       due POST insieme di un altro utente -> una riga; il segreto del calendario e' un altro
#   P1  GET del path senza cookie: 200, h1 "Eventi salvati", l'evento in arrivo con il suo
#       link /eventi/{id}, niente passato, niente email, id utente o nome del proprietario;
#       tanti link /eventi/ quanti ne conta GET share (upcoming)
#   D1  GET /l/AAAAAAAAAAAAAAAAAAAAAA -> 404, titolo "Link non disponibile | Fuorirotta" e il testo
#       "Questo link non è disponibile" (vedi la nota su D1: in Next 16.4.1 il corpo del 404 e' il
#       payload che il client rende, non HTML gia' pronto)
#   H1  la risposta viva (P1) e la morta (D1) portano Referrer-Policy no-referrer,
#       X-Robots-Tag "noindex, nofollow" e Cache-Control esattamente no-store
#
# Righe di prova sotto il `source` dedicato '__share_gate__' e utenti
# '<prefisso>-share@fixture.invalid': cancellati prima e all'uscita, nessuna riga reale
# viene letta o toccata.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT per il gate (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il server dello sviluppatore.
port="${SHARE_TEST_PORT:-39890}"
base_url="http://localhost:${port}"
origin="${base_url}"

test_dist_dir=".next-share-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
test_source="__share_gate__"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti ma di forma valida: il segreto ha 40 caratteri (minimo 32).
auth_env=(
  AUTH_ENABLED=true
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=share-gate-test-secret-0123456789abcdefg"
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
    if [[ "${attempts}" -ge 300 ]]; then
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

# Solo gli utenti di QUESTO gate: la cascata porta via saved_events, calendar_feeds e share_links.
delete_users() {
  psql_dev "DELETE FROM auth_user WHERE email LIKE '%-share@fixture.invalid'" >/dev/null 2>&1 || true
}

delete_fixtures() {
  psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null 2>&1 || true
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
if lsof -ti tcp:"${port}" >/dev/null 2>&1; then
  fail "la porta ${port} e' occupata (SHARE_TEST_PORT per sceglierne un'altra)"
fi

# Parte pulita: righe di un giro interrotto.
delete_users
delete_fixtures

# --- Build di produzione ----------------------------------------------------
# NEXT_PUBLIC_AUTH_ENABLED=true viene inlinato nel bundle; i segreti restano vuoti.
bash scripts/dev-db.sh env \
  NEXT_PUBLIC_AUTH_ENABLED=true AUTH_ENABLED=false \
  BETTER_AUTH_URL= BETTER_AUTH_SECRET= GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= \
  npx next build >"${tmp_dir}/build.log" 2>&1 || {
  tail -n 40 "${tmp_dir}/build.log"
  fail "next build e' fallita"
}

# --- B1: la rotta e' dinamica e nulla puo' avviare lo stream prima del 404 ------
route_row() {
  grep -E "^[┌├└] [○ƒ] $1( |$)" "${tmp_dir}/build.log" | head -n 1 || true
}
row="$(route_row '/l/\[token\]')"
[[ "${row}" == *"ƒ"* ]] \
  || { grep -E '^[┌├└] ' "${tmp_dir}/build.log" || true; fail "B1: /l/[token] non e' dinamica (ƒ): '${row}'"; }
loading_files="$(find app/l -name 'loading.*' 2>/dev/null; find app -maxdepth 1 -name 'loading.*' 2>/dev/null)"
[[ -z "${loading_files}" ]] || fail "B1: un file loading.* farebbe rispondere 200 a ogni link morto: ${loading_files}"
# Solo le righe di codice: i commenti spiegano proprio cosa NON si deve fare.
bad="$(find app/l -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | xargs -0 cat | grep -vE '^[[:space:]]*(//|/\*|\*)' | grep -nE 'Suspense|cookies\(|headers\(|searchParams' || true)"
[[ -z "${bad}" ]] || fail "B1: il codice di app/l non deve usare Suspense, cookies(, headers( o searchParams: ${bad}"
echo "ok  B1: /l/[token] dinamica (ƒ), nessun loading.*, nessun Suspense/cookies/headers/searchParams sotto app/l"

# --- Fixture: A in arrivo, P finito, utenti --------------------------------------
psql_dev_id() { psql_dev "$1" | head -n 1; }
a_id="$(psql_dev_id "INSERT INTO events (source, source_id, title, date_start, date_end, canonical_category) VALUES ('${test_source}', 'share-a', 'Gate uno share', now() + interval '3 days', now() + interval '4 days', 'Sagre e feste') RETURNING id")"
p_id="$(psql_dev_id "INSERT INTO events (source, source_id, title, date_start, date_end, canonical_category) VALUES ('${test_source}', 'share-p', 'Gate passato share', now() - interval '21 days', now() - interval '20 days', 'Sagre e feste') RETURNING id")"
[[ "${a_id}" =~ ^[0-9]+$ && "${p_id}" =~ ^[0-9]+$ ]] || fail "fixture non create (A='${a_id}' P='${p_id}')"

# helper <sottocomando> [args...]: stesso ambiente del server, Postgres locale.
helper() {
  bash scripts/dev-db.sh env "${auth_env[@]}" npx tsx scripts/auth-flow.helper.ts "$@"
}
# mint_user <prefisso> <nome> -> ${prefix}_user e ${prefix}_cookie (intestazione Cookie, entrambi i nomi)
mint_user() {
  local prefix="$1" name="$2" uid cookie
  read -r uid cookie _ <<<"$(helper mint "${prefix}-share@fixture.invalid" "${name}" 0 | tail -n 1)"
  [[ -n "${uid}" && -n "${cookie}" ]] || fail "helper mint non ha stampato utente e cookie per ${prefix}"
  printf -v "${prefix}_user" '%s' "${uid}"
  printf -v "${prefix}_cookie" '%s' "Cookie: fuorirotta.session_token=${cookie}; __Secure-fuorirotta.session_token=${cookie}"
}
mint_user u1 'Proprietaria Prova'
mint_user u2 'Altro Utente'
# Salvati diretti di u1: A (in arrivo) e P (finito). Colonne come le scrive la rotta di salvataggio.
save_row() { # <utente> <event_id> <source_id> <titolo> <inizio> <fine>
  psql_dev "INSERT INTO saved_events (user_id, event_id, title, date_start, date_end, canonical_category, source, source_id, saved_at) VALUES ('$1', $2, '$4', $5, $6, 'Sagre e feste', '${test_source}', '$3', now())" >/dev/null
}
save_row "${u1_user}" "${a_id}" share-a 'Gate uno share' "now() + interval '3 days'" "now() + interval '4 days'"
save_row "${u1_user}" "${p_id}" share-p 'Gate passato share' "now() - interval '21 days'" "now() - interval '20 days'"
echo "ok  fixture: A=${a_id} (in arrivo) P=${p_id} (passato), u1 con due salvati, u2 senza"

# --- Server: lo stesso server.js standalone dell'immagine Docker -----------------
standalone="${test_dist_dir}/standalone/server.js"
if [[ -f "${standalone}" ]]; then
  bash scripts/dev-db.sh env "${auth_env[@]}" "PORT=${port}" HOSTNAME=127.0.0.1 node "${standalone}" \
    >"${tmp_dir}/server.log" 2>&1 &
  server_pid=$!
  serve_mode="server.js standalone (come l'immagine Docker)"
else
  echo "ATTENZIONE: ${standalone} non esiste, ripiego su next start: A1 resta provata solo sotto next start"
  bash scripts/dev-db.sh env "${auth_env[@]}" "NEXT_TEST_DIST_DIR=${test_dist_dir}" npx next start -p "${port}" \
    >"${tmp_dir}/server.log" 2>&1 &
  server_pid=$!
  serve_mode="next start (ripiego, A1 non provata su standalone)"
fi
wait_for_port "${port}" || true
echo "ok  server di produzione sulla porta ${port}: ${serve_mode}"

# call <nome> <metodo> <percorso> [argomenti curl...]: header in <nome>.h, corpo in <nome>.b, stampa il codice.
call() {
  local name="$1" method="$2" path="$3"
  shift 3
  curl -s -X "${method}" -D "${tmp_dir}/${name}.h" -o "${tmp_dir}/${name}.b" -w '%{http_code}' \
    --max-time 120 "$@" "http://127.0.0.1:${port}${path}"
}
hdr() { grep -i "^$2:" "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r'; }
json_get() {
  node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = eval(process.argv[2]); console.log(v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v))' "$1" "$2"
}
share_get() { call "$1" GET /api/v1/me/share -H "$2"; }
share_post() { call "$1" POST /api/v1/me/share -H "Origin: ${origin}" -H "$2"; }
share_rows() { psql_dev "SELECT count(*) FROM share_links WHERE user_id = '$1'"; }

# --- O1: il link non nasce da solo; il POST lo crea una volta sola ------------------
code="$(share_get o1get "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "O1: GET share prima del POST: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/o1get.b"))"
[[ "$(json_get "${tmp_dir}/o1get.b" 'j.link === null && j.upcoming === 1')" == "true" ]] || fail "O1: atteso {link:null, upcoming:1}, corpo '$(cat "${tmp_dir}/o1get.b")'"
[[ "$(hdr o1get cache-control)" == "private, no-store" ]] || fail "O1: GET share: cache-control '$(hdr o1get cache-control)'"
[[ "$(share_rows "${u1_user}")" == "0" ]] || fail "O1: il GET non deve creare nessuna riga in share_links"
code="$(share_post o1post "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "O1: POST share: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/o1post.b"))"
share_path="$(json_get "${tmp_dir}/o1post.b" 'j.path')"
[[ "${share_path}" =~ ^/l/[A-Za-z0-9_-]{22}$ ]] || fail "O1: path inatteso '${share_path}'"
[[ "$(json_get "${tmp_dir}/o1post.b" 'j.showName')" == "false" ]] || fail "O1: il nome deve partire spento, corpo '$(cat "${tmp_dir}/o1post.b")'"
code="$(share_post o1post2 "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/o1post2.b" 'j.path')" == "${share_path}" ]] || fail "O1: il secondo POST deve dare lo stesso path, ottenuto ${code} '$(cat "${tmp_dir}/o1post2.b")'"
[[ "$(share_rows "${u1_user}")" == "1" ]] || fail "O1: attesa una sola riga in share_links per u1"
share_post o1p1 "${u2_cookie}" >"${tmp_dir}/o1p1.code" &
pid1=$!
share_post o1p2 "${u2_cookie}" >"${tmp_dir}/o1p2.code" &
pid2=$!
wait "${pid1}" "${pid2}"
[[ "$(cat "${tmp_dir}/o1p1.code")" == "200" && "$(cat "${tmp_dir}/o1p2.code")" == "200" ]] || fail "O1: due POST insieme: attesi 200 e 200, ottenuti $(cat "${tmp_dir}/o1p1.code") e $(cat "${tmp_dir}/o1p2.code")"
[[ "$(share_rows "${u2_user}")" == "1" ]] || fail "O1: due POST insieme di u2 devono lasciare una riga"
[[ "$(json_get "${tmp_dir}/o1p1.b" 'j.path')" == "$(json_get "${tmp_dir}/o1p2.b" 'j.path')" ]] || fail "O1: i due POST insieme devono dare lo stesso path"
code="$(call o1feed POST /api/v1/me/calendar-feed -H "Origin: ${origin}" -H "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "O1: POST calendar-feed: atteso 200, ottenuto ${code}"
feed_code="$(json_get "${tmp_dir}/o1feed.b" 'j.path.replace(/^\/cal\//, "").replace(/\.ics$/, "")')"
[[ -n "${feed_code}" && "${feed_code}" != "undefined" && "${share_path}" != *"${feed_code}"* ]] || fail "O1: il segreto del calendario e quello della condivisione devono essere diversi"
echo "ok  O1: GET non crea nulla ({link:null, upcoming:1}), POST -> ${share_path%/*}/{22 caratteri} senza nome, secondo POST uguale, due POST insieme -> una riga, segreti separati"

# --- P1: lo sconosciuto apre il link senza account ---------------------------------
code="$(call p1 GET "${share_path}")"
[[ "${code}" == "200" ]] || fail "P1: GET ${share_path%/*}/...: atteso 200, ottenuto ${code}"
grep -q '>Eventi salvati</h1>' "${tmp_dir}/p1.b" || fail "P1: manca l'h1 'Eventi salvati'"
grep -q 'Gate uno share' "${tmp_dir}/p1.b" || fail "P1: manca l'evento in arrivo"
grep -q "href=\"/eventi/${a_id}\"" "${tmp_dir}/p1.b" || fail "P1: manca il link /eventi/${a_id}"
if grep -q 'Gate passato share' "${tmp_dir}/p1.b"; then fail "P1: l'evento finito non deve comparire"; fi
u1_email="$(psql_dev "SELECT email FROM auth_user WHERE id = '${u1_user}'")"
for secret in "${u1_email}" "${u1_user}" 'Proprietaria Prova'; do
  if grep -qF "${secret}" "${tmp_dir}/p1.b"; then fail "P1: la pagina pubblica non deve contenere '${secret}'"; fi
done
upcoming="$(json_get "${tmp_dir}/o1get.b" 'j.upcoming')"
shown="$(tr '\n' ' ' <"${tmp_dir}/p1.b" | grep -o '<main.*</main>' | grep -o 'href="/eventi/' | wc -l | tr -d ' ')"
code="$(share_get p1count "${u1_cookie}")"
[[ "$(json_get "${tmp_dir}/p1count.b" 'j.upcoming')" == "${shown}" && "${shown}" == "${upcoming}" ]] || fail "P1: righe nella pagina (${shown}) e upcoming di GET share ($(json_get "${tmp_dir}/p1count.b" 'j.upcoming')) devono coincidere"
echo "ok  P1: senza cookie 200, 'Eventi salvati', l'evento in arrivo col suo link, niente passato, niente email, id o nome; ${shown} riga come upcoming"

# --- D1: un codice ignoto e' la pagina morta, 404 --------------------------------
code="$(call d1 GET /l/AAAAAAAAAAAAAAAAAAAAAA)"
[[ "${code}" == "404" ]] || fail "D1: codice ignoto: atteso 404, ottenuto ${code}"
grep -q '<title>Link non disponibile | Fuorirotta</title>' "${tmp_dir}/d1.b" || fail "D1: manca il titolo 'Link non disponibile | Fuorirotta'"
# In Next 16.4.1 un notFound() lanciato dalla pagina risponde con una conchiglia di recupero
# (<html id="__next_error__"> senza corpo): il not-found.tsx del segmento e' nel payload RSC e lo
# rende il client. Vale anche per i 404 di /[regione]. Per questo qui non si cerca un <h1> nell'HTML
# ma il testo del not-found nella risposta; il titolo, lo stato e gli header sono gia' quelli veri.
grep -q 'Questo link non è disponibile' "${tmp_dir}/d1.b" || fail "D1: il testo 'Questo link non è disponibile' non e' nella risposta"
if grep -q 'Eventi salvati' "${tmp_dir}/d1.b"; then fail "D1: la risposta morta non deve contenere contenuti della pagina viva"; fi
echo "ok  D1: codice ignoto -> 404, titolo 'Link non disponibile | Fuorirotta' e testo 'Questo link non è disponibile' (reso dal client)"

# --- H1: stessi header sulla risposta viva e sulla morta ----------------------------
for name in p1 d1; do
  [[ "$(hdr "${name}" referrer-policy)" == "no-referrer" ]] || fail "H1: ${name}: referrer-policy '$(hdr "${name}" referrer-policy)'"
  [[ "$(hdr "${name}" x-robots-tag)" == "noindex, nofollow" ]] || fail "H1: ${name}: x-robots-tag '$(hdr "${name}" x-robots-tag)'"
  [[ "$(hdr "${name}" cache-control)" == "no-store" ]] || fail "H1: ${name}: cache-control '$(hdr "${name}" cache-control)'"
done
echo "ok  H1: 200 e 404 portano Referrer-Policy no-referrer, X-Robots-Tag 'noindex, nofollow' e Cache-Control no-store (${serve_mode})"
