#!/usr/bin/env bash
# Gate della forma delle risposte pubbliche (check:api-golden, test:local).
#
# L'app (Fase 27) e il web leggono /api/events*, /api/categories, /api/comuni/search,
# /api/places/search e /api/v1/me/state. Questo gate registra UNA volta la FORMA di
# ogni risposta (percorso -> tipi, mai i valori) in scripts/__fixtures__/api-golden/
# e poi la confronta a ogni giro: un campo che sparisce o cambia tipo e' un FAIL,
# un campo in piu' passa (aggiungere e' compatibile). Il confronto sta in
# scripts/golden-shape.ts; scripts/mobile-contract.test.ts (test:ci) prova ogni
# volta che quel confronto sa davvero fallire.
#
# Richieste coperte:
#   G1  events-search     GET /api/events?search=<M>&limit=100            (busta della lista)
#   G2  events-radius     la stessa con lat/lng/radius                    (altro percorso di codice)
#   G3  events-filter     la stessa con category + dateFrom/dateTo
#   G4  event-full        GET /api/events/<id> con ogni colonna valorizzata
#   G5  event-sparse      GET /api/events/<id> con ogni colonna nullable a NULL
#   G6  event-bad-id      GET /api/events/abc                             (400 {error})
#   G7  event-missing     GET /api/events/99999999                        (404 {error})
#   G8  event-member      GET /api/events/<id membro>                     (307 + Location)
#   G9  clusters          GET /api/events/clusters
#   G10 categories        GET /api/categories
#   G11 comuni-search     GET /api/comuni/search?q=vigo
#   G12 places-search     GET /api/places/search?q=berg
#   G13 me-state-signed   GET /api/v1/me/state da loggato (con plan e features)
#   G14 me-state-anon     GET /api/v1/me/state da anonimo, byte per byte
#
# <M> e' un marcatore unico nei titoli delle fixture (sorgente riservata '__golden__'):
# il DB locale ha ~9,6k eventi veri, con search=<M> in lista ci sono solo le fixture.
# MAI il parametro del filtro per comune su /api/events: e' l'unico ramo che puo'
# lanciare un refresh in background (uno scrape).
#
# Come si aggiorna un golden (solo di proposito, il diff va letto in PR):
#   GOLDEN_UPDATE=1 npm run check:api-golden     poi    git diff scripts/__fixtures__/api-golden
# Senza GOLDEN_UPDATE il gate non scrive mai: un golden mancante e' un FAIL.
#
# Dev server effimero sul Postgres LOCALE (scripts/dev-db.sh, mai produzione),
# variabili di accesso ESPLICITE con valori finti, come scripts/mobile-api.test.sh.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05).
port="${API_GOLDEN_TEST_PORT:-39892}"
base_url="http://localhost:${port}"

test_dist_dir=".next-api-golden-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
tmp_dir="$(mktemp -d)"
server_pid=""
golden_source="__golden__"
marker="zqgolden${$}"

auth_env=(
  AUTH_ENABLED=true
  NEXT_PUBLIC_AUTH_ENABLED=true
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=api-golden-test-secret-0123456789abcdef"
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
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
    lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

# Le fixture (sorgente riservata) e l'utente di G13: un giro interrotto lo pulisce il prossimo.
delete_fixtures() {
  psql_dev "UPDATE events SET canonical_event_id = NULL WHERE source = '${golden_source}'" >/dev/null 2>&1 || true
  psql_dev "DELETE FROM events WHERE source = '${golden_source}'" >/dev/null 2>&1 || true
  psql_dev "DELETE FROM auth_user WHERE email = 'g13-golden@fixture.invalid'" >/dev/null 2>&1 || true
}

cleanup() {
  stop_server
  delete_fixtures
  rm -rf "${tmp_dir:?}"
  rm -rf "${repo_root:?}/${test_dist_dir:?}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

delete_fixtures

# --- Fixture: tutte sotto la sorgente riservata, tutte con il marcatore nel titolo ---------------
# F_FULL: ogni colonna nullable valorizzata, comune Vigolzone, tra 10 giorni.
# F_SPARSE: ogni colonna nullable a NULL. F_MEMBER: membro del gruppo di F_FULL (307).
future_day="$(psql_dev "SELECT (current_date + 10)::text")"
next_day="$(psql_dev "SELECT (current_date + 11)::text")"
today="$(psql_dev "SELECT current_date::text")"
full_lat="44.91666700"
full_lng="9.66666700"

F_FULL="$(psql_dev "INSERT INTO events (source, source_id, title, description, date_start, date_end, location_name, address, phone, latitude, longitude, category, canonical_category, source_url, image_url, comune_id, resolved_latitude, resolved_longitude, coordinate_source, region, merge_score, merge_reason)
  VALUES ('${golden_source}', 'full', 'Sagra ${marker} completa', 'Descrizione di prova', '${future_day} 00:00:00', '${future_day} 23:59:59.999', 'Piazza di prova', 'Via di prova 1', '0523 000000', ${full_lat}, ${full_lng}, 'Sagra', 'Sagre e feste', 'https://example.invalid/golden', 'https://example.invalid/golden.jpg', (SELECT id FROM comuni WHERE name = 'Vigolzone' LIMIT 1), ${full_lat}, ${full_lng}, 'source', 'emilia-romagna', 0.9, 'golden')
  RETURNING id" | head -n 1)"
F_SPARSE="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, canonical_category)
  VALUES ('${golden_source}', 'sparse', 'Sagra ${marker} scarna', '${future_day} 00:00:00', 'Altro')
  RETURNING id" | head -n 1)"
F_MEMBER="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, canonical_category, canonical_event_id)
  VALUES ('${golden_source}', 'member', 'Sagra ${marker} membro', '${future_day} 00:00:00', 'Sagre e feste', ${F_FULL})
  RETURNING id" | head -n 1)"
for id in "${F_FULL}" "${F_SPARSE}" "${F_MEMBER}"; do
  [[ "${id}" =~ ^[0-9]+$ ]] || fail "fixture non inserita (id ottenuto: '${id}')"
done
echo "ok  fixture '${golden_source}' inserite (full=${F_FULL} sparse=${F_SPARSE} member=${F_MEMBER}, marcatore ${marker})"

# --- Dev server effimero, Postgres locale reale --------------------------------------------------
bash scripts/dev-db.sh env "${auth_env[@]}" npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# call <nome> <percorso> [argomenti curl...]: scrive <nome>.h e <nome>.b, stampa il codice HTTP.
# Niente -L: un redirect va visto cosi' com'e'. La prima compilazione di una rotta e' lenta.
call() {
  local name="$1" path="$2"
  shift 2
  curl -s -D "${tmp_dir}/${name}.h" -o "${tmp_dir}/${name}.b" -w '%{http_code}' \
    --max-time 120 -H "X-Real-IP: 198.51.100.230" "$@" "http://127.0.0.1:${port}${path}"
}

# record_or_compare <nome-golden> <etichetta> <percorso> [argomenti curl...]
# Con GOLDEN_UPDATE=1 registra (e basta), altrimenti confronta: mai una registrazione silenziosa.
record_or_compare() {
  local name="$1" label="$2" path="$3" code ctype location
  shift 3
  code="$(call "${name}" "${path}" "$@")"
  ctype="$(grep -i '^content-type:' "${tmp_dir}/${name}.h" | head -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//' || true)"
  location="$(grep -i '^location:' "${tmp_dir}/${name}.h" | head -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//' || true)"
  local mode=compare
  [[ "${GOLDEN_UPDATE:-}" == "1" ]] && mode=record
  GOLDEN_REQUEST="${label//${marker}/<M>}" npx tsx scripts/golden-shape.ts "${mode}" "${name}" \
    "${tmp_dir}/${name}.b" "${code}" "${ctype}" ${location:+"${location}"}
}

# --- G1 (tracer): la busta della lista ------------------------------------------------------------
record_or_compare events-search "GET /api/events?search=<M>&limit=100" "/api/events?search=${marker}&limit=100"
