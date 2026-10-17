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
# Perche' la build usa NEXT_PUBLIC_AUTH_ENABLED=1: e' l'HTML del giorno in cui
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
#   B2-B4 come A2-A4 con l'interruttore acceso
#   B5  interruttore acceso: /api/auth/ok 200, stato enabled:true e, col cookie,
#       l'utente di prova
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
  AUTH_ENABLED=1
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=${test_secret}"
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
# NEXT_PUBLIC_AUTH_ENABLED=1 viene inlinato nel bundle; i segreti restano vuoti
# (nessun segreto nella build, D-19).
bash scripts/dev-db.sh env \
  NEXT_PUBLIC_AUTH_ENABLED=1 AUTH_ENABLED=0 \
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
echo "ok  A1: / statico con 5m; /eventi/[id], /[regione], /[regione]/[provincia] dinamiche"

# --- Fixture ------------------------------------------------------------------
event_id="$(psql_dev "SELECT id FROM events WHERE canonical_event_id IS NULL ORDER BY id LIMIT 1" | head -n 1)"
[[ "${event_id}" =~ ^[0-9]+$ ]] || fail "nessun evento canonico nel database locale (id ottenuto: '${event_id}')"
pages=("/" "/eventi/${event_id}" "/lombardia")

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

# start_server <env...>: next start di produzione sul DB locale.
start_server() {
  bash scripts/dev-db.sh env "NEXT_TEST_DIST_DIR=${test_dist_dir}" "$@" npx next start -p "${port}" \
    >"${tmp_dir}/server-$$.log" 2>&1 &
  server_pid=$!
  wait_for_port "${port}"
}

# --- Run A: interruttore spento ------------------------------------------------------
start_server AUTH_ENABLED=0 BETTER_AUTH_URL= BETTER_AUTH_SECRET= GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET=
echo "ok  next start (produzione) sulla porta ${port}, interruttore spento, Postgres locale"

check_pages A

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

stop_server

# --- Run B: interruttore acceso ----------------------------------------------------------
start_server "${auth_env[@]}"
echo "ok  next start (produzione) sulla porta ${port}, interruttore acceso con valori finti"

check_pages B

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

echo ""
echo "PASS: pagine pubbliche identiche con e senza sessione, interruttore spento e acceso (ACCT-05)"
