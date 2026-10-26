#!/usr/bin/env bash
# Gate dell'anonimato delle pagine pubbliche (check:anon, test:local) - ACCT-05.
#
# Perche' esiste: l'accesso con Google non deve cambiare di un byte le pagine
# pubbliche. Se / (ISR, cache condivisa), la pagina di un evento o una pagina
# regione leggessero il cookie di sessione, o stampassero qualcosa di
# personale, un visitatore vedrebbe la pagina di un altro. La prova che conta
# non e' "il codice non legge i cookie" ma l'IDENTITA': la stessa richiesta,
# con e senza un cookie di sessione VERO e firmato, restituisce gli stessi byte
# e gli stessi header (Date escluso), con l'interruttore AUTH_ENABLED spento e
# acceso. Prima si confronta una coppia di controllo (due richieste anonime):
# una pagina non deterministica fallisce rumorosamente qui, non viene
# normalizzata fino a sparire.
#
# Perche' la build usa NEXT_PUBLIC_AUTH_ENABLED=true: e' l'HTML del giorno in cui
# si accende l'accesso (icona della persona inclusa, dal piano 21-06 in poi).
# La variante senza icona non si costruisce qui: una build sola resta in pochi
# minuti, e la sua assenza si controlla in produzione dopo il rilascio a
# interruttore spento (21-10).
#
# Perche' ogni comando passa da scripts/dev-db.sh con valori ESPLICITI: .env.local
# punta a PRODUZIONE e `next build` / `next start` leggono il database. Il
# processo vince su .env.local, ma "non impostare" non basta (Next caricherebbe
# i valori del file): per questo le variabili di accesso sono passate vuote.
#
# Sezioni:
#   A1  tabella delle rotte: / statico (o) con 5m, /eventi/[id], /[regione] e
#       /[regione]/[provincia] dinamiche
#   A2  interruttore spento: due richieste anonime identiche (controllo)
#   A3  interruttore spento: anonima contro richiesta col cookie di sessione
#   A4  / ha Cache-Control esatto s-maxage=300, stale-while-revalidate=31535700
#   A5  interruttore spento: /api/auth/ok 404 private no-store, stato spento
#   A6  statico: nessuna entrata pubblica importa lib/auth o legge la richiesta
#   A7  / e la pagina evento hanno il pulsante "Accedi" e UNA regione avvisi vuota
#   A8  interruttore spento: /account risponde 404
#   A9  interruttore spento: /accedi risponde 404
#   A10 /privacy e /cookie: statiche (o) nella tabella delle rotte, 200 con e senza
#       sessione, con il loro h1 (pubbliche anche a interruttore spento, D-16)
#   A11 il piede "Informazioni legali" e' nell'HTML di /, della pagina evento e di
#       /lombardia, con e senza sessione (l'identita' byte per byte e' A3)
#   A12 /salvati: statica (o) nella tabella delle rotte (A1), 200 con e senza sessione,
#       h1 "Salvati" e robots noindex, stessi byte e header per tutti (D-03)
#   A13 / e la pagina evento hanno nell'HTML del server il cuore da non salvato
#       (aria-label "Salva: ...", aria-pressed="false") e il link "Salvati" senza
#       puntino, con e senza sessione (SAVE-01; l'identita' byte per byte e' A3)
#   A14 Fase 23 (PREF-04): su / il riquadro "Per te" e' UN div.per-te-slot vuoto e
#       l'<head> porta lo statement fuorirotta.perte; /lombardia, /lombardia/bergamo
#       e un evento con comune hanno il bottone Segui con aria-pressed="false"; un
#       evento senza comune non ne ha nessuno; mai un aria-pressed="true"
#   A15 /per-te: statica (o) (A1), h1 "Per te" e robots noindex, stessi byte per tutti
#   A16 il CSS compilato contiene .per-te-slot e html[data-perte] .per-te-slot
#   A12 (Fase 24) in piu': l'HTML del server di /salvati non contiene "Condividi la lista"
#       ne' la riga da ospite "averli nel calendario e condividerli" (nascono solo dopo
#       che il client conosce la modalita'), con e senza sessione
#   A17 Fase 24 (SHARE-03): un /l/ morto risponde 404 con l'h1 "Questo link non e'
#       disponibile", stessi byte e header con e senza cookie di sessione
#   A18 robots.txt e sitemap.xml non nominano /l/ (nessun Disallow che nasconda il noindex,
#       nessun indirizzo condiviso pubblicizzato)
#   B2-B4, B7, B10-B15, B17 come A2-A4, A7, A10-A15, A17 con l'interruttore acceso
#   B5  interruttore acceso: /api/auth/ok 200, stato enabled:true e, col cookie,
#       l'utente di prova
#   B8  interruttore acceso: /account da ospite e' un 307 verso /accedi?next=%2Faccount;
#       con la sessione e' 200, private e no-store, noindex, e contiene il nome dell'utente;
#       sezioni nell'ordine Profilo, Sessioni attive, I tuoi dati, Cosa segui, Elimina account
#   B9  interruttore acceso: /accedi da ospite 200, no-store, noindex, "Continua con Google"
#       e (Apple spento) senza "Continua con Apple"; con la sessione reindirizza a /account
#       o al ?next valido, mai fuori sito
#   Run C (Fase 25, interruttore di Apple acceso, variabili Apple finte ma valide):
#   C9  /accedi da ospite contiene "Continua con Apple" PRIMA di "Continua con Google"
#   C16 statico: nessuno script ne' CDN di Apple nel codice dell'app; AppleLogo senza
#       '#', 'http' ne' <img (nessuna richiesta a terzi prima del click)
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il server dello sviluppatore.
port="${ANON_TEST_PORT:-39886}"
base_url="http://localhost:${port}"

test_dist_dir=".next-anon-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti ma di forma valida: il segreto ha 40 caratteri (minimo 32).
test_secret="anon-pages-test-secret-0123456789abcdefg"
auth_env=(
  AUTH_ENABLED=true
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=${test_secret}"
  GOOGLE_CLIENT_ID=test-client-id.apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET=test-client-secret
)
# Apple acceso (run C): valori finti ma validi; la chiave privata e' una P-256 pkcs8 generata
# qui, su una riga in base64. Nessuna richiesta a Apple parte: serve solo ad appleEnabled().
apple_key_b64="$(node -e 'const{generateKeyPairSync}=require("crypto");process.stdout.write(Buffer.from(generateKeyPairSync("ec",{namedCurve:"P-256"}).privateKey.export({type:"pkcs8",format:"pem"})).toString("base64"))')"
[[ -n "${apple_key_b64}" ]] || { echo "FAIL: chiave di prova di Apple non generata"; exit 1; }
apple_env=(
  APPLE_AUTH_ENABLED=true
  APPLE_CLIENT_ID=it.fuorirotta.web.test
  APPLE_TEAM_ID=TEAMID1234
  APPLE_KEY_ID=KEYID12345
  "APPLE_PRIVATE_KEY_B64=${apple_key_b64}"
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

# helper <sottocomando> [args...]: stesso ambiente del server acceso, DB locale.
helper() {
  bash scripts/dev-db.sh env "${auth_env[@]}" npx tsx scripts/auth-flow.helper.ts "$@"
}

cleanup() {
  stop_server
  helper cleanup >/dev/null 2>&1 || true
  psql_dev "DELETE FROM auth_rate_limit WHERE key LIKE '198.51.100.%'" >/dev/null 2>&1 || true
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Un solo `next dev`/`next build` per cartella (Next 16.4): se uno sviluppatore
# ha un dev server attivo sulla cartella .next, questo gate usa un'altra distDir
# ed e' comunque indipendente; la porta pero' deve essere libera.
if lsof -ti tcp:"${port}" >/dev/null 2>&1; then
  fail "la porta ${port} e' occupata (ANON_TEST_PORT per sceglierne un'altra)"
fi

helper cleanup >/dev/null
psql_dev "DELETE FROM auth_rate_limit WHERE key LIKE '198.51.100.%'" >/dev/null

# --- Build di produzione ----------------------------------------------------
# NEXT_PUBLIC_AUTH_ENABLED=true viene inlinato nel bundle; i segreti restano vuoti
# (nessun segreto nella build, D-19).
bash scripts/dev-db.sh env \
  NEXT_PUBLIC_AUTH_ENABLED=true AUTH_ENABLED=false \
  BETTER_AUTH_URL= BETTER_AUTH_SECRET= GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= \
  npx next build >"${tmp_dir}/build.log" 2>&1 || {
  tail -n 40 "${tmp_dir}/build.log"
  fail "next build e' fallita"
}

# --- A1: tabella delle rotte -------------------------------------------------
route_row() {
  # La riga della tabella la cui rotta e' ESATTAMENTE $1 (ultimo campo prima dei
  # tempi di rivalidazione).
  grep -E "^[┌├└] [○ƒ] $1( |$)" "${tmp_dir}/build.log" | head -n 1 || true
}
home_row="$(route_row '/')"
[[ "${home_row}" == *"○ /"* && "${home_row}" == *" 5m "* ]] \
  || { grep -E '^[┌├└] ' "${tmp_dir}/build.log" || true; fail "A1: la riga di / non e' statica (○) con rivalidazione 5m: '${home_row}'"; }
for dyn in '/eventi/\[id\]' '/\[regione\]' '/\[regione\]/\[provincia\]'; do
  row="$(route_row "${dyn}")"
  [[ "${row}" == *"ƒ"* ]] \
    || { grep -E '^[┌├└] ' "${tmp_dir}/build.log" || true; fail "A1: la rotta ${dyn} non e' dinamica (ƒ): '${row}'"; }
done
for stat in /salvati /per-te; do
  row="$(route_row "${stat}")"
  [[ "${row}" == *"○"* ]] \
    || { grep -E '^[┌├└] ' "${tmp_dir}/build.log" || true; fail "A1: la rotta ${stat} non e' statica (○): '${row}'"; }
done
echo "ok  A1: / statico con 5m; /salvati e /per-te statici; /eventi/[id], /[regione], /[regione]/[provincia] dinamiche"
for legal in /privacy /cookie; do
  row="$(route_row "${legal}")"
  [[ "${row}" == *"○"* ]] \
    || { grep -E '^[┌├└] ' "${tmp_dir}/build.log" || true; fail "A10: la rotta ${legal} non e' statica (○): '${row}'"; }
done
echo "ok  A10: /privacy e /cookie statiche (○) nella tabella delle rotte"

# --- Fixture ------------------------------------------------------------------
event_id="$(psql_dev "SELECT id FROM events WHERE canonical_event_id IS NULL ORDER BY id LIMIT 1" | head -n 1)"
[[ "${event_id}" =~ ^[0-9]+$ ]] || fail "nessun evento canonico nel database locale (id ottenuto: '${event_id}')"
# Fase 23: un evento canonico CON comune (bottone "Segui {comune}") e uno SENZA.
event_comune="$(psql_dev "SELECT id FROM events WHERE canonical_event_id IS NULL AND comune_id IS NOT NULL ORDER BY id LIMIT 1" | head -n 1)"
[[ "${event_comune}" =~ ^[0-9]+$ ]] || fail "nessun evento canonico con comune nel database locale (id ottenuto: '${event_comune}')"
event_nocomune="$(psql_dev "SELECT id FROM events WHERE canonical_event_id IS NULL AND comune_id IS NULL ORDER BY id LIMIT 1" | head -n 1)"
[[ "${event_nocomune}" =~ ^[0-9]+$ ]] || fail "nessun evento canonico senza comune nel database locale (id ottenuto: '${event_nocomune}')"
# L'ordine conta: "/" per primo (A4 legge il suo Cache-Control); gli indici 1-7 servono a check_follow.
pages=("/" "/eventi/${event_id}" "/lombardia" "/lombardia/bergamo" "/eventi/${event_comune}" "/eventi/${event_nocomune}" "/per-te")

read -r mint_user mint_cookie _mint_token <<<"$(helper mint anon-pages@fixture.invalid 'Utente Prova' 0 | tail -n 1)"
[[ -n "${mint_user}" && -n "${mint_cookie}" ]] || fail "helper mint non ha stampato utente e cookie"
# Il browser manda il nome con prefisso __Secure- solo in https; il gate manda
# entrambi, cosi' la prova vale per tutti e due i nomi.
session_cookie="fuorirotta.session_token=${mint_cookie}; __Secure-fuorirotta.session_token=${mint_cookie}"

# --- Richieste -------------------------------------------------------------------
# fetch <nome> <percorso> [cookie]: corpo in <nome>.b, header (senza Date, senza
# CR) in <nome>.h. Una richiesta lenta alla prima compilazione: --max-time 60.
fetch() {
  local name="$1" path="$2" cookie="${3:-}" code
  local args=(-s -D "${tmp_dir}/${name}.raw" -o "${tmp_dir}/${name}.b" -w '%{http_code}' --max-time 60
    -H 'X-Real-IP: 198.51.100.61')
  [[ -n "${cookie}" ]] && args+=(-H "Cookie: ${cookie}")
  code="$(curl "${args[@]}" "http://127.0.0.1:${port}${path}")"
  tr -d '\r' <"${tmp_dir}/${name}.raw" | grep -vi '^date:' >"${tmp_dir}/${name}.h" || true
  echo "${code}"
}

header() {
  grep -i "^$2:" "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//'
}

# same <etichetta> <nomeA> <nomeB>: stessi byte e stessi header.
same() {
  local label="$1" a="$2" b="$3"
  if ! cmp -s "${tmp_dir}/${a}.b" "${tmp_dir}/${b}.b"; then
    diff <(head -c 4000 "${tmp_dir}/${a}.b") <(head -c 4000 "${tmp_dir}/${b}.b") | head -n 20 || true
    return 1
  fi
  if ! diff "${tmp_dir}/${a}.h" "${tmp_dir}/${b}.h" >"${tmp_dir}/hdr.diff"; then
    cat "${tmp_dir}/hdr.diff"
    return 1
  fi
}

# check_pages <A|B>: A2/A3/A4 oppure B2/B3/B4 sulle tre pagine.
check_pages() {
  local tag="$1" i=0 path code
  for path in "${pages[@]}"; do
    i=$((i + 1))
    # Riscaldamento: la prima richiesta puo' compilare o riempire la cache.
    code="$(fetch "warm${i}" "${path}")"
    [[ "${code}" == "200" ]] || fail "${tag}: GET ${path}: atteso 200, ottenuto ${code}"
    code="$(fetch "anon1-${i}" "${path}")"; [[ "${code}" == "200" ]] || fail "${tag}2: GET ${path}: atteso 200, ottenuto ${code}"
    code="$(fetch "anon2-${i}" "${path}")"; [[ "${code}" == "200" ]] || fail "${tag}2: GET ${path}: atteso 200, ottenuto ${code}"
    same "${tag}2" "anon1-${i}" "anon2-${i}" \
      || fail "${tag}2: ${path}: pagina non deterministica (due richieste anonime differiscono)"
    code="$(fetch "sess-${i}" "${path}" "${session_cookie}")"
    [[ "${code}" == "200" ]] || fail "${tag}3: GET ${path} con cookie: atteso 200, ottenuto ${code}"
    same "${tag}3" "anon1-${i}" "sess-${i}" \
      || fail "${tag}3: ${path}: la risposta con la sessione differisce da quella anonima"
  done
  echo "ok  ${tag}2: due richieste anonime identiche su ${pages[*]} (controllo)"
  echo "ok  ${tag}3: con il cookie di sessione stessi byte e stessi header su ${pages[*]}"
  local cc
  cc="$(header anon1-1 cache-control)"
  [[ "${cc}" == "s-maxage=300, stale-while-revalidate=31535700" ]] \
    || fail "${tag}4: Cache-Control di / atteso 's-maxage=300, stale-while-revalidate=31535700', ottenuto '${cc}'"
  cc="$(header sess-1 cache-control)"
  [[ "${cc}" == "s-maxage=300, stale-while-revalidate=31535700" ]] \
    || fail "${tag}4: Cache-Control di / con sessione: atteso lo stesso valore, ottenuto '${cc}'"
  echo "ok  ${tag}4: / ha Cache-Control 's-maxage=300, stale-while-revalidate=31535700' con e senza sessione"
}

# check_icon <A|B>: A7/B7. L'icona e la regione degli avvisi sono nell'HTML del
# server, per tutti e uguali (21-06). A3/B3 dicono "identici"; qui si dice
# "e contengono davvero l'icona", perche' due pagine senza icona sarebbero
# identiche lo stesso. La regione e' un <div> (ShareButton ne ha una propria,
# ma e' uno <span>), e deve esserci una volta sola e vuota.
check_icon() {
  local tag="$1" i=0 path name
  for path in "/" "/eventi/${event_id}"; do
    i=$((i + 1))
    for name in "anon1-${i}" "sess-${i}"; do
      grep -qF 'aria-label="Accedi"' "${tmp_dir}/${name}.b" \
        || fail "${tag}7: ${path} (${name}): manca il pulsante da ospite (aria-label=\"Accedi\") nell'HTML del server"
      local regions
      regions="$(grep -oF '<div role="status" aria-live="polite"></div>' "${tmp_dir}/${name}.b" | wc -l | tr -d ' ')"
      [[ "${regions}" == "1" ]] \
        || fail "${tag}7: ${path} (${name}): attesa 1 regione degli avvisi vuota nell'HTML, trovate ${regions}"
    done
  done
  echo "ok  ${tag}7: / e la pagina evento contengono il pulsante \"Accedi\" e una regione degli avvisi vuota, con e senza sessione"
}

# check_legal <A|B>: A10/B10 e A11/B11. Le pagine legali rispondono 200 con e
# senza sessione, con il loro h1 e senza cambiare per chi e' collegato; il piede
# e' nell'HTML del server delle tre pagine pubbliche, per tutti. Il piede e'
# cercato per il suo nav: due pagine senza piede sarebbero identiche lo stesso.
check_legal() {
  local tag="$1" path h1 name code
  for path in /privacy /cookie; do
    case "${path}" in
      /privacy) h1="Informativa sulla privacy" ;;
      /cookie) h1="Informativa sui cookie" ;;
    esac
    name="legal-anon${path#/}"
    code="$(fetch "${name}" "${path}")"
    [[ "${code}" == "200" ]] || fail "${tag}10: GET ${path}: atteso 200, ottenuto ${code}"
    code="$(fetch "legal-sess${path#/}" "${path}" "${session_cookie}")"
    [[ "${code}" == "200" ]] || fail "${tag}10: GET ${path} con cookie: atteso 200, ottenuto ${code}"
    grep -qF ">${h1}</h1>" "${tmp_dir}/${name}.b" \
      || fail "${tag}10: ${path}: manca l'h1 '${h1}' nell'HTML del server"
    same "${tag}10" "${name}" "legal-sess${path#/}" \
      || fail "${tag}10: ${path}: la risposta con la sessione differisce da quella anonima"
  done
  echo "ok  ${tag}10: /privacy e /cookie rispondono 200 con il loro h1, uguali con e senza sessione"
  local i=0
  for path in "${pages[@]}"; do
    i=$((i + 1))
    for name in "anon1-${i}" "sess-${i}"; do
      grep -qF 'aria-label="Informazioni legali"' "${tmp_dir}/${name}.b" \
        || fail "${tag}11: ${path} (${name}): manca il piede (nav \"Informazioni legali\") nell'HTML del server"
      grep -qF 'href="/privacy"' "${tmp_dir}/${name}.b" && grep -qF 'href="/cookie"' "${tmp_dir}/${name}.b" \
        || fail "${tag}11: ${path} (${name}): il piede non collega /privacy e /cookie"
    done
  done
  echo "ok  ${tag}11: il piede \"Informazioni legali\" e' nell'HTML di ${pages[*]}, con e senza sessione"
}

# check_saved <A|B>: A12/B12 e A13/B13. /salvati e' lo stesso guscio per tutti
# (la lista arriva dal client); il cuore e il link "Salvati" sono nell'HTML del
# server come "non salvato", per tutti: lo stato personale nasce solo dopo
# l'idratazione. Due pagine senza cuore sarebbero identiche lo stesso, quindi
# si cerca il cuore davvero, e l'assenza di qualunque stato "salvato".
check_saved() {
  local tag="$1" code name path i
  code="$(fetch saved-anon /salvati)"
  [[ "${code}" == "200" ]] || fail "${tag}12: GET /salvati: atteso 200, ottenuto ${code}"
  code="$(fetch saved-sess /salvati "${session_cookie}")"
  [[ "${code}" == "200" ]] || fail "${tag}12: GET /salvati con cookie: atteso 200, ottenuto ${code}"
  grep -qF '>Salvati</h1>' "${tmp_dir}/saved-anon.b" \
    || fail "${tag}12: /salvati: manca l'h1 'Salvati' nell'HTML del server"
  grep -qiE '<meta name="robots" content="[^"]*noindex' "${tmp_dir}/saved-anon.b" \
    || fail "${tag}12: /salvati: manca il meta robots noindex"
  for name in saved-anon saved-sess; do
    for frag in 'Condividi la lista' 'averli nel calendario e condividerli'; do
      if grep -qF "${frag}" "${tmp_dir}/${name}.b"; then
        fail "${tag}12: /salvati (${name}): l'HTML del server contiene '${frag}' (nasce solo dopo che il client conosce la modalita')"
      fi
    done
  done
  same "${tag}12" saved-anon saved-sess \
    || fail "${tag}12: /salvati: la risposta con la sessione differisce da quella anonima"
  echo "ok  ${tag}12: /salvati 200, h1 e noindex, senza pillola di condivisione ne' riga da ospite, uguale con e senza sessione"
  i=0
  for path in "/" "/eventi/${event_id}"; do
    i=$((i + 1))
    for name in "anon1-${i}" "sess-${i}"; do
      grep -qF 'aria-label="Salva: ' "${tmp_dir}/${name}.b" \
        || fail "${tag}13: ${path} (${name}): manca il cuore (aria-label=\"Salva: ...\") nell'HTML del server"
      grep -qF 'aria-pressed="false"' "${tmp_dir}/${name}.b" \
        || fail "${tag}13: ${path} (${name}): manca aria-pressed=\"false\" nell'HTML del server"
      grep -qF 'aria-label="Salvati"' "${tmp_dir}/${name}.b" \
        || fail "${tag}13: ${path} (${name}): manca il link \"Salvati\" nell'intestazione"
      if grep -qF 'aria-pressed="true"' "${tmp_dir}/${name}.b" || grep -qF 'data-saved-dot' "${tmp_dir}/${name}.b"; then
        fail "${tag}13: ${path} (${name}): l'HTML del server contiene uno stato 'salvato' (aria-pressed=true o data-saved-dot)"
      fi
    done
  done
  echo "ok  ${tag}13: / e la pagina evento hanno il cuore non salvato e il link \"Salvati\" nell'HTML, mai uno stato salvato"
}

# check_follow <A|B>: A14/B14 e A15/B15 (Fase 23). Le pagine toccate dai follow sono
# uguali per tutti (A3/B3 lo dicono byte per byte); qui si dice che contengono
# davvero il riquadro riservato e il Segui, nella forma da non seguito: due
# pagine senza bottone sarebbero identiche lo stesso. Indici di `pages`:
# 1 /, 3 /lombardia, 4 /lombardia/bergamo, 5 evento con comune, 6 evento senza, 7 /per-te.
check_follow() {
  local tag="$1" name slots
  for name in anon1-1 sess-1; do
    slots="$(grep -cE 'class="per-te-slot"[^>]*></div>' "${tmp_dir}/${name}.b" || true)"
    [[ "${slots}" == "1" ]] \
      || fail "${tag}14: / (${name}): atteso esattamente 1 div.per-te-slot vuoto, trovati ${slots}"
    grep -qF 'fuorirotta.perte' "${tmp_dir}/${name}.b" \
      || fail "${tag}14: / (${name}): manca lo statement fuorirotta.perte nell'<head>"
  done
  for name in anon1-3 sess-3; do
    grep -qF 'aria-label="Segui Lombardia"' "${tmp_dir}/${name}.b" \
      || fail "${tag}14: /lombardia (${name}): manca aria-label=\"Segui Lombardia\""
  done
  for name in anon1-4 sess-4; do
    grep -qF 'aria-label="Segui provincia di Bergamo"' "${tmp_dir}/${name}.b" \
      || fail "${tag}14: /lombardia/bergamo (${name}): manca aria-label=\"Segui provincia di Bergamo\""
  done
  for name in anon1-5 sess-5; do
    grep -qF 'aria-label="Segui ' "${tmp_dir}/${name}.b" \
      || fail "${tag}14: evento ${event_comune} con comune (${name}): manca il bottone Segui"
  done
  for name in anon1-6 sess-6; do
    if grep -qF 'aria-label="Segui ' "${tmp_dir}/${name}.b"; then
      fail "${tag}14: evento ${event_nocomune} senza comune (${name}): non deve avere alcun bottone Segui"
    fi
  done
  for name in anon1-1 sess-1 anon1-3 sess-3 anon1-4 sess-4 anon1-5 sess-5 anon1-6 sess-6; do
    if grep -qF 'aria-pressed="true"' "${tmp_dir}/${name}.b"; then
      fail "${tag}14: ${name}: l'HTML del server contiene uno stato seguito/salvato (aria-pressed=true)"
    fi
  done
  for name in anon1-3 sess-3 anon1-4 sess-4 anon1-5 sess-5; do
    grep -qF 'aria-pressed="false"' "${tmp_dir}/${name}.b" \
      || fail "${tag}14: ${name}: il Segui non porta aria-pressed=\"false\""
  done
  echo "ok  ${tag}14: / ha UN riquadro per-te-slot vuoto e lo statement fuorirotta.perte; Segui non seguito su regione, provincia, evento con comune; nessuno sull'evento senza comune"
  for name in anon1-7 sess-7; do
    grep -qF '>Per te</h1>' "${tmp_dir}/${name}.b" \
      || fail "${tag}15: /per-te (${name}): manca l'h1 'Per te'"
    grep -qiE '<meta name="robots" content="[^"]*noindex' "${tmp_dir}/${name}.b" \
      || fail "${tag}15: /per-te (${name}): manca il meta robots noindex"
  done
  echo "ok  ${tag}15: /per-te ha l'h1 \"Per te\" e noindex, uguale con e senza sessione (A3/B3)"
}

# check_share <A|B>: A17/B17 (Fase 24, SHARE-03). Il link morto e' l'UNICA risposta
# per codice ignoto, malformato, disattivato o sostituito: uguale per tutti. Un
# token ben formato che non esiste e' il caso piu' semplice da riprodurre; stesso
# URL con e senza sessione, quindi nessuna normalizzazione. Il testo si cerca nei
# byte della risposta (Next 16.4.1 dopo notFound() lo porta nel payload della
# pagina, non necessariamente come <h1> nell'HTML del server), come fa check:share.
check_share() {
  local tag="$1" code
  code="$(fetch share-anon /l/AAAAAAAAAAAAAAAAAAAAAA)"
  [[ "${code}" == "404" ]] || fail "${tag}17: GET /l/<morto>: atteso 404, ottenuto ${code}"
  code="$(fetch share-sess /l/AAAAAAAAAAAAAAAAAAAAAA "${session_cookie}")"
  [[ "${code}" == "404" ]] || fail "${tag}17: GET /l/<morto> con cookie: atteso 404, ottenuto ${code}"
  for name in share-anon share-sess; do
    grep -qF 'Questo link non è disponibile' "${tmp_dir}/${name}.b" \
      || fail "${tag}17: /l/<morto> (${name}): manca l'h1 'Questo link non è disponibile'"
  done
  same "${tag}17" share-anon share-sess \
    || fail "${tag}17: /l/<morto>: la risposta con la sessione differisce da quella anonima"
  echo "ok  ${tag}17: /l/<morto> 404 con il suo h1, stessi byte e header con e senza sessione"
}

# start_server <env...>: next start di produzione sul DB locale.
start_server() {
  bash scripts/dev-db.sh env "NEXT_TEST_DIST_DIR=${test_dist_dir}" "$@" npx next start -p "${port}" \
    >"${tmp_dir}/server-$$.log" 2>&1 &
  server_pid=$!
  wait_for_port "${port}"
}

# --- Run A: interruttore spento ------------------------------------------------------
start_server AUTH_ENABLED=false BETTER_AUTH_URL= BETTER_AUTH_SECRET= GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET=
echo "ok  next start (produzione) sulla porta ${port}, interruttore spento, Postgres locale"

check_pages A
check_icon A
check_legal A
check_saved A
check_follow A
check_share A

# --- A16: il CSS compilato porta le regole del riquadro (una volta, dopo la build) ----
css_files="$(find "${test_dist_dir}/static" -name '*.css' 2>/dev/null || true)"
[[ -n "${css_files}" ]] || fail "A16: nessun file CSS in ${test_dist_dir}/static"
# shellcheck disable=SC2086
grep -q 'per-te-slot' ${css_files} || fail "A16: il CSS compilato non contiene .per-te-slot"
# shellcheck disable=SC2086
grep -qF 'html[data-perte] .per-te-slot' ${css_files} || fail "A16: il CSS compilato non contiene html[data-perte] .per-te-slot"
echo "ok  A16: il CSS compilato contiene .per-te-slot e html[data-perte] .per-te-slot"

# --- A18: nessun /l/ ai crawler (T-24-25) -----------------------------------------------
# Un Disallow su /l/ nasconderebbe il noindex della pagina; la sitemap non deve
# pubblicizzare indirizzi condivisi. Si cerca "/l/" nei due file serviti dalla build.
for f in robots.txt sitemap.xml; do
  code="$(fetch "a18-${f%%.*}" "/${f}")"
  [[ "${code}" == "200" ]] || fail "A18: GET /${f}: atteso 200, ottenuto ${code}"
  if grep -qF '/l/' "${tmp_dir}/a18-${f%%.*}.b"; then
    fail "A18: /${f} nomina /l/"
  fi
done
echo "ok  A18: robots.txt e sitemap.xml non nominano /l/"

code="$(fetch a5ok /api/auth/ok)"
[[ "${code}" == "404" ]] || fail "A5: /api/auth/ok a interruttore spento: atteso 404, ottenuto ${code}"
cc="$(header a5ok cache-control)"
[[ "${cc}" == *private* && "${cc}" == *no-store* ]] || fail "A5: /api/auth/ok: Cache-Control atteso con private e no-store, ottenuto '${cc}'"
code="$(fetch a5state /api/v1/me/state)"
[[ "${code}" == "200" ]] || fail "A5: /api/v1/me/state: atteso 200, ottenuto ${code}"
[[ "$(cat "${tmp_dir}/a5state.b")" == '{"enabled":false,"user":null}' ]] \
  || fail "A5: /api/v1/me/state: corpo inatteso '$(cat "${tmp_dir}/a5state.b")'"
echo "ok  A5: /api/auth/ok 404 con private, no-store; stato {\"enabled\":false,\"user\":null}"

# --- A6: statico ---------------------------------------------------------------------
# Solo righe di codice: i commenti possono nominare cio' che e' vietato.
code_lines() { grep -vE '^[[:space:]]*(//|\*|/\*)' "$1" || true; }
entries=(app/layout.tsx app/page.tsx "app/eventi/[id]/page.tsx" "app/[regione]/page.tsx" "app/[regione]/[provincia]/page.tsx")
for f in "${entries[@]}"; do
  [[ -f "${f}" ]] || fail "A6: ${f} non esiste"
  if code_lines "${f}" | grep -E "lib/auth|(^|[^A-Za-z0-9_])(cookies|headers)\(" >/dev/null; then
    code_lines "${f}" | grep -nE "lib/auth|(^|[^A-Za-z0-9_])(cookies|headers)\(" || true
    fail "A6: ${f} importa lib/auth o legge la richiesta (cookies/headers)"
  fi
done
for f in app/layout.tsx app/page.tsx; do
  if code_lines "${f}" | grep -F searchParams >/dev/null; then
    fail "A6: ${f} legge searchParams: renderebbe la pagina dinamica"
  fi
done
echo "ok  A6: nessuna entrata pubblica importa lib/auth o legge cookies(), headers(), searchParams"

# --- A8: /account non esiste con l'interruttore spento (D-16) ----------------------------
code="$(fetch a8account /account)"
[[ "${code}" == "404" ]] || fail "A8: /account a interruttore spento: atteso 404, ottenuto ${code}"
echo "ok  A8: /account risponde 404 con l'interruttore spento"

code="$(fetch a9accedi /accedi)"
[[ "${code}" == "404" ]] || fail "A9: /accedi a interruttore spento: atteso 404, ottenuto ${code}"
echo "ok  A9: /accedi risponde 404 con l'interruttore spento"

stop_server

# --- Run B: interruttore acceso ----------------------------------------------------------
start_server "${auth_env[@]}"
echo "ok  next start (produzione) sulla porta ${port}, interruttore acceso con valori finti"

check_pages B
check_icon B
check_legal B
check_saved B
check_follow B
check_share B

code="$(fetch b5ok /api/auth/ok)"
[[ "${code}" == "200" ]] || fail "B5: /api/auth/ok a interruttore acceso: atteso 200, ottenuto ${code}"
code="$(fetch b5state /api/v1/me/state)"
[[ "${code}" == "200" ]] || fail "B5: /api/v1/me/state: atteso 200, ottenuto ${code}"
[[ "$(cat "${tmp_dir}/b5state.b")" == '{"enabled":true,"user":null}' ]] \
  || fail "B5: stato anonimo inatteso '$(cat "${tmp_dir}/b5state.b")'"
code="$(fetch b5user /api/v1/me/state "${session_cookie}")"
[[ "${code}" == "200" ]] || fail "B5: /api/v1/me/state con cookie: atteso 200, ottenuto ${code}"
email="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).user?.email ?? "")' "${tmp_dir}/b5user.b")"
[[ "${email}" == "anon-pages@fixture.invalid" ]] \
  || fail "B5: con il cookie l'utente atteso e' anon-pages@fixture.invalid, corpo: '$(cat "${tmp_dir}/b5user.b")'"
echo "ok  B5: /api/auth/ok 200; stato enabled:true e, col cookie, l'utente di prova"

# --- B8: /account (D-06, D-16) ------------------------------------------------------------
code="$(fetch b8guest /account)"
[[ "${code}" == "307" ]] || fail "B8: /account da ospite: atteso 307, ottenuto ${code}"
loc="$(header b8guest location)"
[[ "${loc}" == "/accedi?next=%2Faccount" ]] || fail "B8: /account da ospite: Location attesa '/accedi?next=%2Faccount', ottenuta '${loc}'"
code="$(fetch b8user /account "${session_cookie}")"
[[ "${code}" == "200" ]] || fail "B8: /account con la sessione: atteso 200, ottenuto ${code}"
cc="$(header b8user cache-control)"
[[ "${cc}" == *private* && "${cc}" == *no-store* ]] \
  || fail "B8: /account: Cache-Control atteso con private e no-store, ottenuto '${cc}'"
grep -qiE '<meta name="robots" content="[^"]*noindex' "${tmp_dir}/b8user.b" \
  || fail "B8: /account: manca il meta robots noindex"
grep -qF 'Utente Prova' "${tmp_dir}/b8user.b" \
  || fail "B8: /account: il nome dell'utente non e' nell'HTML del server"
# Ordine delle sezioni (D-06) e sessione corrente gia' nell'HTML del server (nessun flash di vuoto).
order="$(grep -oE '>(Profilo|Sessioni attive|I tuoi dati|Cosa segui|Elimina account)</h2>' "${tmp_dir}/b8user.b" | sed -E 's/^>(.*)<.*/\1/' | paste -sd'|' -)"
[[ "${order}" == "Profilo|Sessioni attive|I tuoi dati|Cosa segui|Elimina account" ]] \
  || fail "B8: /account: ordine delle sezioni inatteso: '${order}'"
grep -qF 'attiva ora (questo dispositivo)' "${tmp_dir}/b8user.b" \
  || fail "B8: /account: la sessione corrente non e' nell'HTML del server"
echo "ok  B8: /account da ospite 307 verso /accedi?next=%2Faccount; con la sessione 200, private no-store, noindex, nome nell'HTML"

# --- B9: /accedi (D-02, T-21-32) -----------------------------------------------------------
code="$(fetch b9guest /accedi)"
[[ "${code}" == "200" ]] || fail "B9: /accedi da ospite: atteso 200, ottenuto ${code}"
cc="$(header b9guest cache-control)"
[[ "${cc}" == *no-store* ]] || fail "B9: /accedi: Cache-Control atteso con no-store, ottenuto '${cc}'"
grep -qiE '<meta name="robots" content="[^"]*noindex' "${tmp_dir}/b9guest.b" \
  || fail "B9: /accedi: manca il meta robots noindex"
grep -qF 'Continua con Google' "${tmp_dir}/b9guest.b" \
  || fail "B9: /accedi: manca il testo 'Continua con Google'"
if grep -qF 'Continua con Apple' "${tmp_dir}/b9guest.b"; then
  fail "B9: /accedi con Apple spento contiene 'Continua con Apple'"
fi
# Con la sessione: verso /account, verso un ?next valido, e MAI fuori sito.
expect_redirect() {
  local path="$1" want="$2" code loc
  code="$(fetch b9redir "${path}" "${session_cookie}")"
  [[ "${code}" == "307" ]] || fail "B9: ${path} con la sessione: atteso 307, ottenuto ${code}"
  loc="$(header b9redir location)"
  [[ "${loc}" == "${want}" ]] || fail "B9: ${path} con la sessione: Location attesa '${want}', ottenuta '${loc}'"
}
expect_redirect /accedi /account
expect_redirect '/accedi?next=%2Feventi%2F1' /eventi/1
expect_redirect '/accedi?next=%2F%2Fevil.example' /account
expect_redirect '/accedi?next=https%3A%2F%2Fevil.example' /account
echo "ok  B9: /accedi da ospite 200, no-store, noindex, 'Continua con Google'; con la sessione verso /account o il ?next valido, mai fuori sito"

stop_server

# --- Run C: interruttore di Apple acceso (Fase 25, ACCT-05) ---------------------------------
start_server "${auth_env[@]}" "${apple_env[@]}"
echo "ok  next start (produzione) sulla porta ${port}, accesso e Apple accesi con valori finti"

# --- C9: /accedi mostra Apple sopra Google -------------------------------------------------
code="$(fetch c9guest /accedi)"
[[ "${code}" == "200" ]] || fail "C9: /accedi da ospite: atteso 200, ottenuto ${code}"
apple_off="$(grep -bo 'Continua con Apple' "${tmp_dir}/c9guest.b" | head -n 1 | cut -d: -f1)"
google_off="$(grep -bo 'Continua con Google' "${tmp_dir}/c9guest.b" | head -n 1 | cut -d: -f1)"
[[ -n "${apple_off}" && -n "${google_off}" ]] \
  || fail "C9: /accedi: mancano 'Continua con Apple' (${apple_off:-assente}) o 'Continua con Google' (${google_off:-assente})"
(( apple_off < google_off )) || fail "C9: /accedi: Apple (byte ${apple_off}) non viene prima di Google (byte ${google_off})"
echo "ok  C9: /accedi da ospite ha 'Continua con Apple' (byte ${apple_off}) prima di 'Continua con Google' (byte ${google_off})"

stop_server

# --- C16: nessuna richiesta a Apple prima del click (statico) --------------------------------
if grep -rnE 'appleid\.cdn-apple\.com|appleid\.auth\.js' app components lib; then
  fail "C16: nel codice dell'app compare lo script o il CDN di Apple"
fi
logo="components/account/AppleLogo.tsx"
if grep -nE '#|http|<img' "${logo}"; then
  fail "C16: ${logo} contiene '#', 'http' o <img"
fi
echo "ok  C16: nessuno script ne' CDN di Apple nel codice; AppleLogo senza '#', 'http' ne' <img"

echo ""
echo "PASS: pagine pubbliche identiche con e senza sessione, interruttore spento e acceso, Apple compreso (ACCT-05)"
