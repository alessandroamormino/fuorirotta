#!/usr/bin/env bash
# Gate della Fase 11 (Category Taxonomy & Filter): CAT-01, CAT-02, CAT-03, CAT-04.
# Nasce a Wave 1 (11-01), PRIMA che la colonna canonical_category e le superfici
# di lettura che la usano esistano — a Wave 1 e' rosso per costruzione, ed e'
# proprio questo il punto: un gate che nasce verde non ha mai dimostrato di
# saper fallire (stessa convenzione di non-vacuita' di scripts/dedup.test.sh e
# scripts/territorial-backfill.test.sh).
#
# Accesso al database SOLO tramite il container locale (psql_dev) o
# scripts/dev-db.sh (per il dev server effimero). Nessun percorso di questo
# file legge DATABASE_URL dal file di ambiente locale, che punta a produzione.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
port="${PORT:-39882}"

failures=()
fail() {
  echo "FAIL: $1"
  failures+=("$1")
}
ok() {
  echo "ok  $1"
}

# --- Accesso al database, solo container locale ---------------------------------------------
# Nessun percorso qui legge DATABASE_URL dal file di ambiente locale (produzione).
psql_dev() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}
run_dev() {
  (cd "${repo_root}" && bash scripts/dev-db.sh "$@")
}

tmp_dir="$(mktemp -d)"
server_pid=""

wait_for_port() {
  local target_port="$1"
  local attempts=0
  while ! (exec 3<>"/dev/tcp/127.0.0.1/${target_port}") 2>/dev/null; do
    exec 3>&- 2>/dev/null || true
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 150 ]]; then
      fail "S3/S4: porta ${target_port} non ha risposto entro il timeout"
      return 1
    fi
    sleep 0.1
  done
  exec 3>&- 2>/dev/null || true
  return 0
}

stop_server() {
  if [[ -n "${server_pid}" ]]; then
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
  fi
  lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
}

cleanup() {
  stop_server
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

# --- Sezione S1 (CAT-02 + CAT-04, pura, nessun database) -----------------------------------
if [[ ! -f "${repo_root}/lib/categories/taxonomy.selfcheck.ts" ]]; then
  fail "S1: lib/categories/taxonomy.selfcheck.ts non esiste ancora"
else
  if npx tsx lib/categories/taxonomy.selfcheck.ts >"${tmp_dir}/taxonomy-selfcheck.log" 2>&1; then
    ok "S1: il self-check di lib/categories/taxonomy.selfcheck.ts esce 0"
  else
    fail "S1: il self-check di lib/categories/taxonomy.selfcheck.ts fallisce (vedi ${tmp_dir}/taxonomy-selfcheck.log)"
  fi
fi

# --- Sezione S2 (CAT-01, DB) ------------------------------------------------------------------
canonical_column_count="$(psql_dev "SELECT count(*) FROM information_schema.columns WHERE table_name='events' AND column_name='canonical_category'" 2>/dev/null || echo 0)"
if [[ "${canonical_column_count}" != "1" ]]; then
  fail "S2: la colonna canonical_category non esiste ancora su events"
else
  null_or_empty="$(psql_dev "SELECT count(*) FROM events WHERE canonical_event_id IS NULL AND (canonical_category IS NULL OR canonical_category = '')")"
  if [[ "${null_or_empty}" != "0" ]]; then
    fail "S2: ${null_or_empty} righe canoniche hanno canonical_category NULL o vuoto, atteso 0 (CAT-01)"
  else
    ok "S2: zero righe canoniche con canonical_category NULL o vuoto"
  fi

  outside_taxonomy="$(psql_dev "SELECT count(*) FROM events WHERE canonical_category NOT IN ('Sagre e feste','Musica e spettacolo','Arte e cultura','Fiere e mercati','Sport e outdoor','Food & Wine','Altro')")"
  if [[ "${outside_taxonomy}" != "0" ]]; then
    fail "S2: ${outside_taxonomy} righe hanno canonical_category fuori dai 7 nomi canonici, atteso 0"
  else
    ok "S2: ogni canonical_category e' uno dei 7 nomi canonici dichiarati"
  fi
fi

# --- Avvio server effimero per S3/S4 (CAT-03 HTTP) --------------------------------------------
bash scripts/dev-db.sh npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
if wait_for_port "${port}"; then
  ok "S3: dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

  # --- Sezione S3 (CAT-03 HTTP, /api/categories) -----------------------------------------------
  categories_response="${tmp_dir}/categories.json"
  categories_http_code="$(curl -s -o "${categories_response}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/categories")"
  events_response="${tmp_dir}/events-limit1.json"
  events_http_code="$(curl -s -o "${events_response}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/events?limit=1")"

  if [[ "${categories_http_code}" != "200" ]]; then
    fail "S3: GET /api/categories ha risposto ${categories_http_code}, atteso 200"
  else
    if node -e "
      const body = require('${categories_response}');
      if (!Array.isArray(body)) throw new Error('la risposta non e un array');
      if (body.length !== 7) throw new Error('atteso array di 7 elementi, ottenuto ' + body.length);
      const expected = ['Sagre e feste','Musica e spettacolo','Arte e cultura','Fiere e mercati','Sport e outdoor','Food & Wine','Altro'];
      const names = body.map(c => c.name);
      for (const name of expected) {
        if (!names.includes(name)) throw new Error('manca il nome canonico ' + name);
      }
      if (body[body.length - 1].name !== 'Altro') throw new Error('Altro non e ultimo, ultimo e ' + body[body.length - 1].name);
      const eventsBody = require('${events_response}');
      const sum = body.reduce((acc, c) => acc + c.count, 0);
      if (sum !== eventsBody.total) throw new Error('somma dei count (' + sum + ') diversa dal total di /api/events (' + eventsBody.total + ')');
    " 2>"${tmp_dir}/s3-node.log"; then
      ok "S3: /api/categories restituisce 7 nomi canonici, Altro ultimo, somma dei count uguale al total di /api/events"
    else
      fail "S3: forma o contenuto di /api/categories non validi (vedi ${tmp_dir}/s3-node.log)"
    fi
  fi

  # --- Sezione S4 (CAT-03 HTTP, filtro /api/events) --------------------------------------------
  filtered_response="${tmp_dir}/events-filtered.json"
  filtered_http_code="$(curl -s -o "${filtered_response}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/events?category=Sagre%20e%20feste&limit=50")"
  if [[ "${filtered_http_code}" != "200" ]]; then
    fail "S4: GET /api/events?category=Sagre+e+feste ha risposto ${filtered_http_code}, atteso 200"
  else
    if node -e "
      const body = require('${filtered_response}');
      if (typeof body.total !== 'number' || body.total <= 0) throw new Error('total assente o non positivo, ottenuto ' + JSON.stringify(body.total));
      const events = Array.isArray(body.events) ? body.events : (Array.isArray(body.data) ? body.data : []);
      if (!Array.isArray(events) || events.length === 0) throw new Error('nessun evento nella risposta filtrata');
      for (const e of events) {
        if (e.category !== 'Sagre e feste') throw new Error('un evento ha category=' + e.category + ', atteso Sagre e feste');
      }
    " 2>"${tmp_dir}/s4-node.log"; then
      ok "S4: GET /api/events?category=Sagre+e+feste restituisce total > 0 e ogni evento con category=Sagre e feste"
    else
      fail "S4: filtro categoria su /api/events non valido (vedi ${tmp_dir}/s4-node.log)"
    fi
  fi

  # --- Sezione S5 (UAT § Gaps bullet 3: il gate non caricava mai il bundle browser) --------------
  # Status 200 non basta: l'overlay d'errore di Next in dev risponde 200 con
  # l'eccezione dentro l'HTML, ed e' esattamente cosi' che un crash di homepage
  # intera e' passato a suite verde in passato (corretto in 71c7414). --max-time
  # 90 (non 15 come S3/S4) perche' e' la prima richiesta alla route / e il dev
  # server la compila al volo.
  homepage_response="${tmp_dir}/homepage.html"
  homepage_http_code="$(curl -s -o "${homepage_response}" -w '%{http_code}' --max-time 90 "http://127.0.0.1:${port}/")"
  if [[ "${homepage_http_code}" != "200" ]]; then
    fail "S5: GET / ha risposto ${homepage_http_code}, atteso 200"
  elif grep -q -F 'ReferenceError' "${homepage_response}" || grep -q -F 'module is not defined' "${homepage_response}"; then
    if grep -q -F 'ReferenceError' "${homepage_response}"; then
      fail "S5: la homepage renderizzata contiene ReferenceError (overlay d'errore di Next, non un crash reale della pagina)"
    else
      fail "S5: la homepage renderizzata contiene 'module is not defined'"
    fi
  elif ! (grep -q -F 'role="radiogroup"' "${homepage_response}" && grep -q -F 'Filtra per categoria' "${homepage_response}"); then
    fail "S5: la homepage renderizzata non contiene il chip row (role=radiogroup + 'Filtra per categoria'), l'albero dell'app non e' stato renderizzato"
  else
    ok "S5: GET / risponde 200, nessun errore di bundle, chip row presente in SSR"
  fi

  stop_server
else
  fail "S3: dev server locale non avviato, S3/S4 non verificabili"
  fail "S4: dev server locale non avviato, S3/S4 non verificabili"
  fail "S5: dev server locale non avviato, S5 non verificabile"
fi

# --- Riepilogo ----------------------------------------------------------------------------------
if [[ "${#failures[@]}" -gt 0 ]]; then
  echo ""
  echo "SEZIONI ROSSE (${#failures[@]}):"
  for f in "${failures[@]}"; do
    echo "  - ${f}"
  done
  exit 1
else
  echo ""
  echo "PASS: tutte le sezioni del gate della tassonomia di categoria sono verdi"
  exit 0
fi
