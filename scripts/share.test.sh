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
# Un link morto, per qualunque causa, deve essere indistinguibile da uno mai esistito:
# stesso stato, stessi header (senza Date e Content-Length) e stessi byte DOPO aver
# sostituito il codice richiesto con __TOKEN__ (Next 16.4.1 lo scrive nel payload).
# Il confronto e il normalizzatore sono provati non vacui (D2).
#
# Sezioni:
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
#   D2  DELETE -> {removed:1}/{removed:0}, zero righe; vecchio indirizzo = codice mai esistito
#       (byte normalizzati); un byte in piu' rompe il confronto, i corpi grezzi differiscono
#   H2  gli stessi header su tutti i 404 di D2
#   O2  rotate: path nuovo vivo subito, precedente morto, solo l'ultimo vale; senza link 404, zero righe
#   D3  i link rigenerati sono il 404 dei codici ignoti
#   O3  PATCH showName: titolo e h1 'I salvati di {nome}' sullo stesso codice; corpi non validi 400
#   O4  rotate tiene showName, DELETE poi POST lo azzera
#   O5  senza Origin 403, senza sessione 401, sempre private no-store
#   O6  un altro utente non tocca la riga del proprietario (l'utente viene solo dalla sessione)
#   P2  ordine (primo giorno, titolo, id), canonica+membro una riga, istantanea sola e passato assenti,
#       senza luogo solo le date, 'Altro' senza categoria
#   P3  lista vuota = 200 con il suo testo; un evento = '1 evento in arrivo'
#   P4  niente email, id utente, saved_at o immagine del proprietario nell'HTML
#   P5  stessi byte e header senza cookie, col cookie del proprietario e con quello di un altro
#   H3  robots noindex/nofollow, twitter:card summary, niente og:image e og:url
#   D4  codici malformati e strani: 404 identico a un codice ignoto
#   D5  account cancellato: cascata e stesso 404
#   D6  nessuna parola che separi le cause (revocato, scaduto, eliminato)
#   D7  accesso spento (server riavviato con AUTH_ENABLED=false): stesso 404; GET share 404
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

# --- Confronto dei link morti (D2 e seguenti) ---------------------------------------
# Un link morto, per qualunque causa, deve essere indistinguibile da uno mai esistito:
# stesso stato, stessi header (Date e Content-Length esclusi: il secondo segue la
# lunghezza del codice richiesto) e stessi byte DOPO aver sostituito il codice richiesto
# con __TOKEN__ (Next 16.4.1 lo scrive nel payload della pagina: ricerca, spike 24-RESEARCH).
# dead <nome> <codice>: GET senza cookie; corpo in <nome>.b, header filtrati in <nome>.hh.
dead() {
  local name="$1" token="$2" status
  status="$(call "${name}" GET "/l/${token}" --path-as-is)"
  tr -d '\r' <"${tmp_dir}/${name}.h" | grep -viE '^(date|content-length):' >"${tmp_dir}/${name}.hh" || true
  printf '%s' "${status}"
}
# norm <codice> <entrata> <uscita>: sostituzione di testo semplice (split/join), mai una regex:
# '.' o '-' in un codice non devono significare altro.
norm() {
  node -e 'const fs = require("fs"); const [t, i, o] = process.argv.slice(1); fs.writeFileSync(o, fs.readFileSync(i, "latin1").split(t).join("__TOKEN__"), "latin1")' "$1" "$2" "$3"
}
# same_dead <etichetta> <nomeA> <codiceA> <nomeB> <codiceB>
same_dead() {
  local label="$1" a="$2" ta="$3" b="$4" tb="$5"
  norm "${ta}" "${tmp_dir}/${a}.b" "${tmp_dir}/${a}.n"
  norm "${tb}" "${tmp_dir}/${b}.b" "${tmp_dir}/${b}.n"
  cmp -s "${tmp_dir}/${a}.n" "${tmp_dir}/${b}.n" \
    || { echo "--- corpo ${a} vs ${b} (normalizzati), attorno al primo byte diverso:"
         node -e 'const fs = require("fs"); const [x, y] = process.argv.slice(1).map((f) => fs.readFileSync(f, "latin1")); let i = 0; while (i < x.length && x[i] === y[i]) i++; console.log("A: " + JSON.stringify(x.slice(Math.max(0, i - 120), i + 120))); console.log("B: " + JSON.stringify(y.slice(Math.max(0, i - 120), i + 120)))' "${tmp_dir}/${a}.n" "${tmp_dir}/${b}.n"
         fail "${label}: i corpi normalizzati di ${a} e ${b} differiscono"; }
  diff "${tmp_dir}/${a}.hh" "${tmp_dir}/${b}.hh" >"${tmp_dir}/hdr.diff" \
    || { head -n 20 "${tmp_dir}/hdr.diff"; fail "${label}: gli header di ${a} e ${b} differiscono"; }
}

# --- D2: disattivare toglie la riga e il vecchio indirizzo e' un 404 come un altro -------
old_path="${share_path}"
old_token="${old_path#/l/}"
code="$(call d2del DELETE /api/v1/me/share -H "Origin: ${origin}" -H "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/d2del.b" 'j.removed')" == "1" ]] || fail "D2: DELETE: atteso 200 {removed:1}, ottenuto ${code} '$(cat "${tmp_dir}/d2del.b")'"
[[ "$(share_rows "${u1_user}")" == "0" ]] || fail "D2: dopo DELETE share_links deve avere zero righe per u1"
code="$(call d2del2 DELETE /api/v1/me/share -H "Origin: ${origin}" -H "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/d2del2.b" 'j.removed')" == "0" ]] || fail "D2: secondo DELETE: atteso 200 {removed:0}, ottenuto ${code} '$(cat "${tmp_dir}/d2del2.b")'"
unknown_a="AAAAAAAAAAAAAAAAAAAAAA"
unknown_b="BBBBBBBBBBBBBBBBBBBBBB"
[[ "$(dead d2old "${old_token}")" == "404" ]] || fail "D2: il vecchio indirizzo deve dare 404"
[[ "$(dead d2a "${unknown_a}")" == "404" && "$(dead d2b "${unknown_b}")" == "404" ]] || fail "D2: i codici mai esistiti devono dare 404"
same_dead "D2 (due codici mai esistiti)" d2a "${unknown_a}" d2b "${unknown_b}"
same_dead "D2 (disattivato contro mai esistito)" d2old "${old_token}" d2a "${unknown_a}"
# Il confronto sa fallire: un byte in piu' su una copia normalizzata lo rompe.
cp "${tmp_dir}/d2a.n" "${tmp_dir}/d2a.plus"
printf 'x' >>"${tmp_dir}/d2a.plus"
if cmp -s "${tmp_dir}/d2a.n" "${tmp_dir}/d2a.plus"; then fail "D2: il confronto e' vacuo, un byte in piu' non lo rompe"; fi
# E il normalizzatore serve: senza, i corpi grezzi dei due codici ignoti differiscono (il codice e' nel payload).
if cmp -s "${tmp_dir}/d2a.b" "${tmp_dir}/d2b.b"; then fail "D2: i corpi grezzi di due codici diversi sono uguali, il normalizzatore non servirebbe: il test non prova nulla"; fi
# Poi si ricrea il link: le sezioni dopo hanno bisogno di un link vivo per u1.
code="$(share_post d2new "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "D2: POST dopo DELETE: atteso 200, ottenuto ${code}"
share_path="$(json_get "${tmp_dir}/d2new.b" 'j.path')"
[[ "${share_path}" =~ ^/l/[A-Za-z0-9_-]{22}$ && "${share_path}" != "${old_path}" ]] || fail "D2: dopo DELETE il POST deve dare un codice nuovo, vecchio '${old_path}' nuovo '${share_path}'"
[[ "$(dead d2oldagain "${old_token}")" == "404" ]] || fail "D2: il vecchio codice non deve tornare in vita dopo il nuovo POST"
echo "ok  D2: DELETE -> {removed:1} poi {removed:0}, zero righe; vecchio indirizzo = mai esistito (stato, header, byte normalizzati); confronto e normalizzatore provati non vacui; nuovo POST = codice nuovo"

# --- H2: la pagina morta, in ogni causa, ha gli header della viva ---------------------
for name in d2old d2a d2b d2oldagain; do
  [[ "$(hdr "${name}" referrer-policy)" == "no-referrer" ]] || fail "H2: ${name}: referrer-policy '$(hdr "${name}" referrer-policy)'"
  [[ "$(hdr "${name}" x-robots-tag)" == "noindex, nofollow" ]] || fail "H2: ${name}: x-robots-tag '$(hdr "${name}" x-robots-tag)'"
  [[ "$(hdr "${name}" cache-control)" == "no-store" ]] || fail "H2: ${name}: cache-control '$(hdr "${name}" cache-control)'"
done
echo "ok  H2: i 404 dei link disattivati e mai esistiti portano no-referrer, 'noindex, nofollow' e no-store"

# --- Rotazione e nome: le rotte del proprietario (O2-O6, D3) ---------------------------
mint_user u3 'Senza Link'
mint_user u6 'Altro Estraneo'
share_patch() { call "$1" PATCH /api/v1/me/share -H "Origin: ${origin}" -H "$2" -H 'Content-Type: application/json' --data "$3"; }
share_del() { call "$1" DELETE /api/v1/me/share -H "Origin: ${origin}" -H "$2"; }
share_rot() { call "$1" POST /api/v1/me/share/rotate -H "Origin: ${origin}" -H "$2"; }
tok() { printf '%s' "${1#/l/}"; }

# --- O2: rigenera; il vecchio indirizzo muore subito, vale solo l'ultimo ---------------
path0="${share_path}"
code="$(share_rot o2r1 "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "O2: rotate: atteso 200, ottenuto ${code} '$(cat "${tmp_dir}/o2r1.b")'"
path1="$(json_get "${tmp_dir}/o2r1.b" 'j.path')"
[[ "${path1}" =~ ^/l/[A-Za-z0-9_-]{22}$ && "${path1}" != "${path0}" ]] || fail "O2: il path dopo rotate deve essere nuovo, prima '${path0}' dopo '${path1}'"
[[ "$(json_get "${tmp_dir}/o2r1.b" 'j.showName')" == "false" ]] || fail "O2: rotate deve lasciare showName com'era (false)"
[[ "$(dead o2dead0 "$(tok "${path0}")")" == "404" ]] || fail "O2: il path precedente deve dare 404 subito dopo rotate"
[[ "$(call o2live1 GET "${path1}")" == "200" ]] || fail "O2: il path nuovo deve dare 200 subito"
code="$(share_rot o2r2 "${u1_cookie}")"
path2="$(json_get "${tmp_dir}/o2r2.b" 'j.path')"
[[ "${code}" == "200" && "${path2}" =~ ^/l/[A-Za-z0-9_-]{22}$ && "${path2}" != "${path1}" && "${path2}" != "${path0}" ]] || fail "O2: secondo rotate: atteso un terzo path diverso, ottenuto ${code} '${path2}'"
[[ "$(dead o2dead1 "$(tok "${path1}")")" == "404" ]] || fail "O2: dopo il secondo rotate anche il secondo path deve dare 404"
[[ "$(dead o2dead0b "$(tok "${path0}")")" == "404" ]] || fail "O2: il primo path resta morto"
[[ "$(call o2live2 GET "${path2}")" == "200" ]] || fail "O2: l'ultimo path deve dare 200"
[[ "$(share_rows "${u1_user}")" == "1" ]] || fail "O2: rotate non deve moltiplicare le righe di u1"
code="$(share_rot o2none "${u3_cookie}")"
[[ "${code}" == "404" && "$(json_get "${tmp_dir}/o2none.b" 'j.error')" == "not-found" ]] || fail "O2: rotate senza link: atteso 404 not-found, ottenuto ${code} '$(cat "${tmp_dir}/o2none.b")'"
[[ "$(share_rows "${u3_user}")" == "0" ]] || fail "O2: rotate senza link non deve creare nessuna riga"
share_path="${path2}"
echo "ok  O2: rotate -> path nuovo subito vivo, precedente morto; secondo rotate uccide anche il secondo, vale solo l'ultimo; senza link 404 e nessuna riga"

# --- D3: i link rigenerati sono un 404 come quello di un codice mai esistito ----------------
same_dead "D3 (primo path)" o2dead0 "$(tok "${path0}")" d2a "${unknown_a}"
same_dead "D3 (secondo path)" o2dead1 "$(tok "${path1}")" d2a "${unknown_a}"
same_dead "D3 (primo path, dopo il secondo rotate)" o2dead0b "$(tok "${path0}")" d2b "${unknown_b}"
echo "ok  D3: i link rigenerati rispondono il 404 dei codici ignoti (stato, header, byte normalizzati)"

# --- O3: "Mostra il mio nome" sullo stesso codice ----------------------------------------
code="$(share_patch o3on "${u1_cookie}" '{"showName":true}')"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/o3on.b" 'j.showName')" == "true" ]] || fail "O3: PATCH true: atteso 200 {showName:true}, ottenuto ${code} '$(cat "${tmp_dir}/o3on.b")'"
share_get o3get "${u1_cookie}" >/dev/null
[[ "$(json_get "${tmp_dir}/o3get.b" 'j.link.path')" == "${share_path}" ]] || fail "O3: il codice non deve cambiare con un PATCH"
call o3page GET "${share_path}" >/dev/null
grep -q '>I salvati di Proprietaria Prova</h1>' "${tmp_dir}/o3page.b" || fail "O3: manca l'h1 'I salvati di Proprietaria Prova'"
grep -qF '<title>I salvati di Proprietaria Prova' "${tmp_dir}/o3page.b" || fail "O3: manca il titolo 'I salvati di Proprietaria Prova'"
psql_dev "UPDATE auth_user SET name = 'Proprietaria Rinominata' WHERE id = '${u1_user}'" >/dev/null
call o3renamed GET "${share_path}" >/dev/null
grep -q '>I salvati di Proprietaria Rinominata</h1>' "${tmp_dir}/o3renamed.b" || fail "O3: dopo il cambio di nome manca l'h1 con il nome nuovo"
grep -qF '<title>I salvati di Proprietaria Rinominata' "${tmp_dir}/o3renamed.b" || fail "O3: dopo il cambio di nome manca il titolo con il nome nuovo"
share_get o3get2 "${u1_cookie}" >/dev/null
[[ "$(json_get "${tmp_dir}/o3get2.b" 'j.link.path')" == "${share_path}" ]] || fail "O3: il cambio di nome non deve cambiare il codice"
code="$(share_patch o3off "${u1_cookie}" '{"showName":false}')"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/o3off.b" 'j.showName')" == "false" ]] || fail "O3: PATCH false: atteso 200 {showName:false}, ottenuto ${code}"
call o3back GET "${share_path}" >/dev/null
grep -q '>Eventi salvati</h1>' "${tmp_dir}/o3back.b" || fail "O3: con showName false deve tornare 'Eventi salvati'"
if grep -q 'Proprietaria' "${tmp_dir}/o3back.b"; then fail "O3: con showName false il nome non deve comparire"; fi
for bad in '{"showName":"yes"}' '{}' 'non json' 'null' '{"showName":1}'; do
  code="$(share_patch o3bad "${u1_cookie}" "${bad}")"
  [[ "${code}" == "400" && "$(json_get "${tmp_dir}/o3bad.b" 'j.error')" == "bad-request" ]] || fail "O3: PATCH '${bad}': atteso 400 bad-request, ottenuto ${code} '$(cat "${tmp_dir}/o3bad.b")'"
done
code="$(share_patch o3none "${u3_cookie}" '{"showName":true}')"
[[ "${code}" == "404" ]] || fail "O3: PATCH senza link: atteso 404, ottenuto ${code}"
[[ "$(share_rows "${u3_user}")" == "0" ]] || fail "O3: PATCH senza link non deve creare righe"
echo "ok  O3: PATCH true -> titolo e h1 'I salvati di {nome}' sullo stesso codice, il nome nuovo vale alla richiesta dopo, false -> 'Eventi salvati'; corpi non validi 400; senza link 404"

# --- O4: rigenerare tiene il nome, disattivare lo azzera -------------------------------------
code="$(share_patch o4on "${u1_cookie}" '{"showName":true}')"
[[ "${code}" == "200" ]] || fail "O4: PATCH true: ${code}"
code="$(share_rot o4rot "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/o4rot.b" 'j.showName')" == "true" ]] || fail "O4: rotate deve tenere showName true, ottenuto ${code} '$(cat "${tmp_dir}/o4rot.b")'"
share_path="$(json_get "${tmp_dir}/o4rot.b" 'j.path')"
call o4page GET "${share_path}" >/dev/null
grep -q '>I salvati di Proprietaria Rinominata</h1>' "${tmp_dir}/o4page.b" || fail "O4: dopo rotate la pagina deve mostrare ancora il nome"
code="$(share_del o4del "${u1_cookie}")"
[[ "${code}" == "200" ]] || fail "O4: DELETE: ${code}"
code="$(share_post o4new "${u1_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/o4new.b" 'j.showName')" == "false" ]] || fail "O4: dopo DELETE il POST deve dare showName false, ottenuto ${code} '$(cat "${tmp_dir}/o4new.b")'"
share_path="$(json_get "${tmp_dir}/o4new.b" 'j.path')"
call o4page2 GET "${share_path}" >/dev/null
grep -q '>Eventi salvati</h1>' "${tmp_dir}/o4page2.b" || fail "O4: dopo DELETE e POST la pagina deve dire 'Eventi salvati'"
if grep -q 'Proprietaria' "${tmp_dir}/o4page2.b"; then fail "O4: dopo DELETE e POST il nome non deve comparire"; fi
echo "ok  O4: rotate tiene showName true, DELETE poi POST riparte con showName false (risposta e pagina)"

# --- O5: stesse guardie di ogni scrittura /api/v1/me -----------------------------------------
check_cc() { # <nome> <etichetta>
  local cc
  cc="$(hdr "$1" cache-control)"
  [[ "${cc}" == *private* && "${cc}" == *no-store* ]] || fail "O5: $2: cache-control '${cc}'"
}
code="$(call o5a POST /api/v1/me/share -H "${u1_cookie}")";                       [[ "${code}" == "403" ]] || fail "O5: POST create senza Origin: atteso 403, ottenuto ${code}"; check_cc o5a "POST create senza Origin"
code="$(call o5b PATCH /api/v1/me/share -H "${u1_cookie}" -H 'Content-Type: application/json' --data '{"showName":true}')"; [[ "${code}" == "403" ]] || fail "O5: PATCH senza Origin: atteso 403, ottenuto ${code}"; check_cc o5b "PATCH senza Origin"
code="$(call o5c DELETE /api/v1/me/share -H "${u1_cookie}")";                      [[ "${code}" == "403" ]] || fail "O5: DELETE senza Origin: atteso 403, ottenuto ${code}"; check_cc o5c "DELETE senza Origin"
code="$(call o5d POST /api/v1/me/share/rotate -H "${u1_cookie}")";                 [[ "${code}" == "403" ]] || fail "O5: rotate senza Origin: atteso 403, ottenuto ${code}"; check_cc o5d "rotate senza Origin"
code="$(call o5e POST /api/v1/me/share -H "Origin: ${origin}")";                   [[ "${code}" == "401" ]] || fail "O5: POST create senza sessione: atteso 401, ottenuto ${code}"; check_cc o5e "POST create senza sessione"
code="$(call o5f PATCH /api/v1/me/share -H "Origin: ${origin}" -H 'Content-Type: application/json' --data '{"showName":true}')"; [[ "${code}" == "401" ]] || fail "O5: PATCH senza sessione: atteso 401, ottenuto ${code}"; check_cc o5f "PATCH senza sessione"
code="$(call o5g DELETE /api/v1/me/share -H "Origin: ${origin}")";                 [[ "${code}" == "401" ]] || fail "O5: DELETE senza sessione: atteso 401, ottenuto ${code}"; check_cc o5g "DELETE senza sessione"
code="$(call o5h POST /api/v1/me/share/rotate -H "Origin: ${origin}")";            [[ "${code}" == "401" ]] || fail "O5: rotate senza sessione: atteso 401, ottenuto ${code}"; check_cc o5h "rotate senza sessione"
code="$(call o5i GET /api/v1/me/share)";                                           [[ "${code}" == "401" ]] || fail "O5: GET senza sessione: atteso 401, ottenuto ${code}"; check_cc o5i "GET senza sessione"
# Le scritture respinte non hanno toccato la riga: ancora showName false e lo stesso codice.
[[ "$(psql_dev "SELECT token || '|' || show_name FROM share_links WHERE user_id = '${u1_user}'")" == "$(tok "${share_path}")|false" ]] || fail "O5: una scrittura respinta ha cambiato la riga di u1"
echo "ok  O5: senza Origin 403 e senza sessione 401 su POST, PATCH, DELETE e rotate (GET senza sessione 401); sempre private, no-store; la riga non cambia"

# --- O6: l'utente viene solo dalla sessione ------------------------------------------------------
before="$(psql_dev "SELECT token || '|' || show_name FROM share_links WHERE user_id = '${u1_user}'")"
code="$(share_del o6del "${u6_cookie}")"
[[ "${code}" == "200" && "$(json_get "${tmp_dir}/o6del.b" 'j.removed')" == "0" ]] || fail "O6: DELETE di u6: atteso 200 {removed:0}, ottenuto ${code} '$(cat "${tmp_dir}/o6del.b")'"
code="$(share_patch o6patch "${u6_cookie}" '{"showName":true}')"
[[ "${code}" == "404" ]] || fail "O6: PATCH di u6: atteso 404, ottenuto ${code}"
code="$(share_rot o6rot "${u6_cookie}")"
[[ "${code}" == "404" ]] || fail "O6: rotate di u6: atteso 404, ottenuto ${code}"
[[ "$(psql_dev "SELECT token || '|' || show_name FROM share_links WHERE user_id = '${u1_user}'")" == "${before}" ]] || fail "O6: le scritture di u6 hanno cambiato la riga di u1"
[[ "$(share_rows "${u6_user}")" == "0" ]] || fail "O6: le scritture di u6 non devono creare righe"
[[ "$(call o6page GET "${share_path}")" == "200" ]] || fail "O6: il link di u1 deve restare vivo"
echo "ok  O6: DELETE, PATCH e rotate di un altro utente -> {removed:0}, 404, 404; la riga e il link di u1 restano uguali"

# --- P2: ordine e privacy della pagina viva ----------------------------------------------
mint_user u4 'Quarta Prova'
mint_user u5 'Quinta Prova'
mint_user u7 'Settima Prova'
ev() { # <source_id> <titolo> <inizio> <fine> <categoria> [location_name] [canonical_event_id] -> id
  psql_dev_id "INSERT INTO events (source, source_id, title, date_start, date_end, canonical_category, location_name, canonical_event_id) VALUES ('${test_source}', '$1', '$2', $3, $4, '$5', ${6:-NULL}, ${7:-NULL}) RETURNING id"
}
save_ev() { # <utente> <event_id> <source_id> <titolo> <inizio> <fine> <categoria>
  psql_dev "INSERT INTO saved_events (user_id, event_id, title, date_start, date_end, canonical_category, source, source_id, saved_at) VALUES ('$1', $2, '$4', $5, $6, '$7', '${test_source}', '$3', now())" >/dev/null
}
d5="now() + interval '5 days'"
d6="now() + interval '6 days'"
beta_id="$(ev share-beta 'Gate beta share' "${d5}" "${d6}" 'Sagre e feste')"
alfa_id="$(ev share-alfa 'Gate alfa share' "${d5}" "${d6}" 'Sagre e feste' "'Piazza Gate Alfa'")"
canon_id="$(ev share-canon 'Gate canonica share' "now() + interval '7 days'" "now() + interval '8 days'" 'Sagre e feste')"
membro_id="$(ev share-membro 'Gate membro share' "now() + interval '7 days'" "now() + interval '8 days'" 'Sagre e feste' NULL "${canon_id}")"
nolo_id="$(ev share-nolo 'Gate senza luogo share' "now() + interval '9 days'" "now() + interval '10 days'" 'Altro')"
for v in "${beta_id}" "${alfa_id}" "${canon_id}" "${membro_id}" "${nolo_id}"; do [[ "${v}" =~ ^[0-9]+$ ]] || fail "P2: fixture non create"; done
# Beta salvato per primo (saved_at piu' vecchio): l'ordine non deve seguire il salvataggio.
save_ev "${u4_user}" "${beta_id}" share-beta 'Gate beta share' "${d5}" "${d6}" 'Sagre e feste'
psql_dev "UPDATE saved_events SET saved_at = now() - interval '10 days' WHERE user_id = '${u4_user}'" >/dev/null
save_ev "${u4_user}" "${alfa_id}" share-alfa 'Gate alfa share' "${d5}" "${d6}" 'Sagre e feste'
save_ev "${u4_user}" "${canon_id}" share-canon 'Gate canonica share' "now() + interval '7 days'" "now() + interval '8 days'" 'Sagre e feste'
save_ev "${u4_user}" "${membro_id}" share-membro 'Gate membro share' "now() + interval '7 days'" "now() + interval '8 days'" 'Sagre e feste'
save_ev "${u4_user}" "${nolo_id}" share-nolo 'Gate senza luogo share' "now() + interval '9 days'" "now() + interval '10 days'" 'Altro'
save_ev "${u4_user}" "${p_id}" share-p 'Gate passato share' "now() - interval '21 days'" "now() - interval '20 days'" 'Sagre e feste'
# Solo istantanea, nessun evento vivo: la pagina non ha dove portare.
psql_dev "INSERT INTO saved_events (user_id, event_id, title, date_start, date_end, canonical_category, source, source_id, saved_at) VALUES ('${u4_user}', NULL, 'Gate sparito share', now() + interval '5 days', now() + interval '6 days', 'Sagre e feste', '${test_source}', 'share-sparito', now())" >/dev/null
psql_dev "UPDATE auth_user SET image = 'https://img.fixture.invalid/u4-avatar.png' WHERE id = '${u4_user}'" >/dev/null
code="$(share_post p2post "${u4_cookie}")"
[[ "${code}" == "200" ]] || fail "P2: POST di u4: ${code}"
u4_path="$(json_get "${tmp_dir}/p2post.b" 'j.path')"
[[ "$(call p2 GET "${u4_path}")" == "200" ]] || fail "P2: la pagina di u4 deve dare 200"
# Solo il <main>: il payload della pagina ripete i titoli fuori da qui.
main_of() { tr '\n' ' ' <"${tmp_dir}/$1.b" | grep -o '<main.*</main>' >"${tmp_dir}/$1.main" || true; }
main_of p2
rows_of() { # <nome> -> <nome>.rows (JSON): titolo, riga di luogo e date, categoria di ogni <li>
  node -e '
    const fs = require("fs");
    const main = fs.readFileSync(process.argv[1], "utf8");
    const rows = main.split("<li").slice(1).map((li) => ({
      title: (li.match(/<a [^>]*>([^<]*)<\/a>/) || [])[1],
      meta: (li.match(/<p class="mt-1[^"]*">([^<]*)<\/p>/) || [])[1],
      cat: (li.match(/<p class="mt-2 inline-flex[^"]*">.*?<\/svg>([^<]*)<\/p>/) || [])[1],
    }));
    fs.writeFileSync(process.argv[2], JSON.stringify(rows));
  ' "${tmp_dir}/$1.main" "${tmp_dir}/$1.rows"
}
rows_of p2
titles="$(json_get "${tmp_dir}/p2.rows" 'j.map((r) => r.title).join("|")')"
[[ "${titles}" == "Gate alfa share|Gate beta share|Gate canonica share|Gate senza luogo share" ]] \
  || fail "P2: righe attese alfa, beta, canonica, senza luogo (primo giorno, poi titolo), ottenute '${titles}'"
for absent in 'Gate membro share' 'Gate sparito share' 'Gate passato share'; do
  if grep -qF "${absent}" "${tmp_dir}/p2.main"; then fail "P2: '${absent}' non deve comparire nella pagina"; fi
done
[[ "$(grep -o 'Gate canonica share' "${tmp_dir}/p2.main" | wc -l | tr -d ' ')" == "1" ]] || fail "P2: la canonica e il suo membro salvati insieme devono comparire una volta sola"
grep -q '>I salvati di' "${tmp_dir}/p2.b" && fail "P2: con showName false il nome non deve comparire"
grep -q '4 eventi in arrivo' "${tmp_dir}/p2.main" || fail "P2: manca '4 eventi in arrivo'"
[[ "$(json_get "${tmp_dir}/p2.rows" 'j[0].meta.startsWith("Piazza Gate Alfa · ")')" == "true" ]] || fail "P2: la riga con luogo deve iniziare con 'Piazza Gate Alfa · ', ottenuta '$(json_get "${tmp_dir}/p2.rows" 'j[0].meta')'"
[[ "$(json_get "${tmp_dir}/p2.rows" 'j[3].meta.length > 0 && !j[3].meta.includes("·") && j[3].meta === j[3].meta.trim()')" == "true" ]] || fail "P2: senza luogo la riga deve mostrare solo le date, senza separatore, ottenuta '$(json_get "${tmp_dir}/p2.rows" 'j[3].meta')'"
[[ "$(json_get "${tmp_dir}/p2.rows" 'j[3].cat === undefined')" == "true" ]] || fail "P2: l'evento 'Altro' non deve avere la riga della categoria"
[[ "$(json_get "${tmp_dir}/p2.rows" 'j[0].cat')" == "Sagre e feste" ]] || fail "P2: l'evento 'Sagre e feste' deve mostrare la sua categoria, ottenuta '$(json_get "${tmp_dir}/p2.rows" 'j[0].cat')'"
share_get p2count "${u4_cookie}" >/dev/null
[[ "$(json_get "${tmp_dir}/p2count.b" 'j.upcoming')" == "4" ]] || fail "P2: upcoming di GET share per u4: atteso 4, ottenuto '$(json_get "${tmp_dir}/p2count.b" 'j.upcoming')'"
echo "ok  P2: primo giorno poi titolo (alfa prima di beta anche se salvata dopo), canonica e membro una riga, istantanea sola e passato assenti, senza luogo solo le date, 'Altro' senza categoria, upcoming = righe"

# --- P3: lista vuota e singolare -----------------------------------------------------------
save_ev "${u5_user}" "${p_id}" share-p 'Gate passato share' "now() - interval '21 days'" "now() - interval '20 days'" 'Sagre e feste'
code="$(share_post p3post "${u5_cookie}")"
[[ "${code}" == "200" ]] || fail "P3: POST di u5: ${code}"
u5_path="$(json_get "${tmp_dir}/p3post.b" 'j.path')"
[[ "$(call p3 GET "${u5_path}")" == "200" ]] || fail "P3: la lista senza eventi in arrivo deve dare 200"
main_of p3
grep -q 'Al momento non ci sono eventi in arrivo in questa lista' "${tmp_dir}/p3.main" || fail "P3: manca il testo della lista vuota"
grep -q 'Scopri gli eventi' "${tmp_dir}/p3.main" || fail "P3: manca 'Scopri gli eventi'"
if grep -q 'eventi in arrivo</p>' "${tmp_dir}/p3.main"; then fail "P3: la lista vuota non deve avere la riga riassuntiva"; fi
if grep -q '<ul' "${tmp_dir}/p3.main"; then fail "P3: la lista vuota non deve avere righe"; fi
call p3one GET "${share_path}" >/dev/null
main_of p3one
grep -q '1 evento in arrivo<' "${tmp_dir}/p3one.main" || fail "P3: u1 con un solo evento deve leggere '1 evento in arrivo'"
echo "ok  P3: lista vuota = 200 con il suo testo e 'Scopri gli eventi', senza riassunto ne' righe; un evento = '1 evento in arrivo'"

# --- P4: nulla del proprietario nell'HTML --------------------------------------------------
check_no_account() { # <nome> <utente> <percorso> [url immagine]
  local name="$1" uid="$2" path="$3" img="${4:-}" email sa
  [[ "$(call "${name}" GET "${path}")" == "200" ]] || fail "P4: ${name}: la pagina deve dare 200"
  email="$(psql_dev "SELECT email FROM auth_user WHERE id = '${uid}'")"
  for secret in "${email}" "${uid}" ${img:+"${img}"}; do
    if grep -qF "${secret}" "${tmp_dir}/${name}.b"; then fail "P4: ${name}: la pagina contiene '${secret}'"; fi
  done
  for sa in $(psql_dev "SELECT to_char(saved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') FROM saved_events WHERE user_id = '${uid}'"); do
    if grep -qF "${sa}" "${tmp_dir}/${name}.b"; then fail "P4: ${name}: la pagina contiene saved_at '${sa}'"; fi
  done
}
check_no_account p4u1 "${u1_user}" "${share_path}"
check_no_account p4u4 "${u4_user}" "${u4_path}" 'img.fixture.invalid'
echo "ok  P4: la pagina di u1 e di u4 non contiene email, id utente, saved_at ne' l'immagine del profilo"

# --- P5: la pagina e' la stessa per chiunque ----------------------------------------------
call p5a GET "${share_path}" >/dev/null
call p5b GET "${share_path}" -H "${u1_cookie}" >/dev/null
call p5c GET "${share_path}" -H "${u6_cookie}" >/dev/null
for n in p5a p5b p5c; do tr -d '\r' <"${tmp_dir}/${n}.h" | grep -viE '^date:' >"${tmp_dir}/${n}.hh" || true; done
cmp -s "${tmp_dir}/p5a.b" "${tmp_dir}/p5b.b" && cmp -s "${tmp_dir}/p5a.b" "${tmp_dir}/p5c.b" || fail "P5: i corpi senza cookie, con il cookie del proprietario e con quello di un altro devono essere identici"
diff "${tmp_dir}/p5a.hh" "${tmp_dir}/p5b.hh" >/dev/null && diff "${tmp_dir}/p5a.hh" "${tmp_dir}/p5c.hh" >/dev/null || fail "P5: gli header devono essere identici con e senza cookie"
echo "ok  P5: stessi byte e stessi header senza cookie, col cookie del proprietario e con quello di un altro utente"

# --- H3: metadati della pagina viva ----------------------------------------------------------
grep -qE '<meta name="robots" content="noindex, nofollow"' "${tmp_dir}/p5a.b" || fail "H3: manca <meta robots 'noindex, nofollow'>"
grep -qE '<meta name="twitter:card" content="summary"' "${tmp_dir}/p5a.b" || fail "H3: manca twitter:card summary"
if grep -q 'og:image' "${tmp_dir}/p5a.b"; then fail "H3: non deve esserci og:image"; fi
if grep -q 'og:url' "${tmp_dir}/p5a.b"; then fail "H3: non deve esserci og:url"; fi
echo "ok  H3: robots 'noindex, nofollow', twitter:card summary, nessun og:image ne' og:url"

# --- D4: codici malformati e strani ------------------------------------------------------------
for bad in short AAAAAAAAAAAAAAAAAAAAA AAAAAAAAAAAAAAAAAAAAAAA AAAAAAAAAAAAAAAAAAAA.A AAAAAAAAAAAAAAAAAAAA~A; do
  [[ "$(dead d4 "${bad}")" == "404" ]] || fail "D4: '${bad}': atteso 404"
  same_dead "D4 '${bad}'" d4 "${bad}" d2a "${unknown_a}"
done
title_of() { grep -o '<title>[^<]*</title>' "${tmp_dir}/$1.b" | head -n 1; }
for odd in '%00' 'a%2F..%2Fb' '%E2%82%AC%E2%82%AC'; do
  [[ "$(dead d4odd "${odd}")" == "404" ]] || fail "D4: '${odd}': atteso 404, ottenuto un altro stato"
  [[ "$(title_of d4odd)" == "$(title_of d2a)" && -n "$(title_of d4odd)" ]] || fail "D4: '${odd}': titolo '$(title_of d4odd)' diverso da quello del codice ignoto '$(title_of d2a)'"
  grep -q 'Questo link non è disponibile' "${tmp_dir}/d4odd.b" || fail "D4: '${odd}': manca l'h1 della pagina morta"
done
echo "ok  D4: lunghezze sbagliate e carattere fuori alfabeto = 404 identico al codice ignoto (byte normalizzati); %00, %2F e % multibyte = 404 con lo stesso titolo e h1"

# --- D5: account cancellato ---------------------------------------------------------------------------
code="$(share_post d5post "${u7_cookie}")"
[[ "${code}" == "200" ]] || fail "D5: POST di u7: ${code}"
u7_token="$(tok "$(json_get "${tmp_dir}/d5post.b" 'j.path')")"
[[ "$(call d5live GET "/l/${u7_token}")" == "200" ]] || fail "D5: il link di u7 deve essere vivo prima della cancellazione"
psql_dev "DELETE FROM auth_user WHERE id = '${u7_user}'" >/dev/null
[[ "$(share_rows "${u7_user}")" == "0" ]] || fail "D5: la cancellazione dell'account deve portare via la riga di share_links"
[[ "$(dead d5 "${u7_token}")" == "404" ]] || fail "D5: il link di un account cancellato deve dare 404"
same_dead "D5" d5 "${u7_token}" d2a "${unknown_a}"
echo "ok  D5: account cancellato -> zero righe (cascata) e il vecchio link e' il 404 dei codici ignoti"

# --- D6: nessuna parola che separi le cause ---------------------------------------------------------------
norm "${unknown_a}" "${tmp_dir}/d2a.b" "${tmp_dir}/d6.n"
if grep -qiE 'revocato|scaduto|eliminato' "${tmp_dir}/d6.n"; then fail "D6: la pagina morta contiene parole che separano le cause (revocato, scaduto, eliminato)"; fi
grep -q 'Chi ha condiviso la lista potrebbe averlo disattivato.' "${tmp_dir}/d6.n" || fail "D6: manca 'Chi ha condiviso la lista potrebbe averlo disattivato.'"
echo "ok  D6: la pagina morta non dice revocato, scaduto o eliminato e porta il testo unico"

# --- D7: accesso spento (ultima sezione, come F6 di saved-flow) ------------------------------------------------
stop_server
if [[ -f "${standalone}" ]]; then
  bash scripts/dev-db.sh env AUTH_ENABLED=false BETTER_AUTH_URL= BETTER_AUTH_SECRET= GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= \
    "PORT=${port}" HOSTNAME=127.0.0.1 node "${standalone}" >"${tmp_dir}/server-off.log" 2>&1 &
else
  bash scripts/dev-db.sh env AUTH_ENABLED=false BETTER_AUTH_URL= BETTER_AUTH_SECRET= GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= \
    "NEXT_TEST_DIST_DIR=${test_dist_dir}" npx next start -p "${port}" >"${tmp_dir}/server-off.log" 2>&1 &
fi
server_pid=$!
wait_for_port "${port}" || true
[[ "$(dead d7live "$(tok "${share_path}")")" == "404" ]] || fail "D7: con AUTH_ENABLED spento il link vivo di u1 deve dare 404"
[[ "$(dead d7unk "${unknown_a}")" == "404" ]] || fail "D7: il codice ignoto deve dare 404"
same_dead "D7" d7live "$(tok "${share_path}")" d7unk "${unknown_a}"
code="$(share_get d7api "${u1_cookie}")"
[[ "${code}" == "404" ]] || fail "D7: GET /api/v1/me/share con l'accesso spento: atteso 404, ottenuto ${code}"
echo "ok  D7: con AUTH_ENABLED spento il link vivo = 404 dei codici ignoti (byte normalizzati) e GET share = 404"
