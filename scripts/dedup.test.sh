#!/usr/bin/env bash
# Gate della Fase 10 (Cross-Source Deduplication): DEDUP-01, DEDUP-02, DEDUP-03,
# DEDUP-04, DEDUP-05, DEDUP-06. Nasce a Wave 1 (10-01), PRIMA che ogni modulo che
# verifica esista — a Wave 1 e' rosso per costruzione, ed e' proprio questo il
# punto: un gate che nasce verde non ha mai dimostrato di saper fallire.
#
# Accesso al database SOLO tramite il container locale (psql_dev) o
# scripts/dev-db.sh (per gli script tsx, via run_dev). Nessun percorso di questo
# file legge DATABASE_URL dal file di ambiente locale, che punta a produzione
# (T-10-06).
#
# Come in scripts/territorial-backfill.test.sh, `fail()` qui NON esce subito:
# accumula i messaggi in un array e continua. Durante l'esecuzione della fase
# questo file e' rosso su piu' sezioni contemporaneamente (le tabelle/moduli che
# ciascuna sezione verifica atterrano in piani diversi, 10-02..10-05); un'uscita
# al primo fallimento nasconderebbe le sezioni successive e renderebbe
# impossibile vedere in un colpo solo quali sono ancora scoperte.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"

failures=()
fail() {
  echo "FAIL: $1"
  failures+=("$1")
}
ok() {
  echo "ok  $1"
}

cleanup() {
  :
}
trap cleanup EXIT

# --- Accesso al database, solo container locale ------------------------------------------
# Nessun percorso qui legge DATABASE_URL dal file di ambiente locale (produzione).
psql_dev() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}
run_dev() {
  (cd "${repo_root}" && bash scripts/dev-db.sh "$@")
}

if ! docker compose -f "${repo_root}/docker-compose.dev.yml" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  echo "ABORT: il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'." >&2
  exit 1
fi

# --- Stato condiviso, calcolato una sola volta ----------------------------------------------
events_exists="$(psql_dev "SELECT to_regclass('public.events') IS NOT NULL" 2>/dev/null || echo f)"
merge_cols_count="$(psql_dev "SELECT count(*) FROM information_schema.columns WHERE table_name='events' AND column_name IN ('canonical_event_id','merge_score','merge_reason')" 2>/dev/null || echo 0)"
schema_ready=0
if [[ "${events_exists}" == "t" && "${merge_cols_count}" == "3" ]]; then
  schema_ready=1
fi
dedup_events_script_exists=0
[[ -f "${repo_root}/scripts/dedup-events.ts" ]] && dedup_events_script_exists=1

# --- Sezione 1 (DEDUP-05) — schema ----------------------------------------------------------
if [[ "${events_exists}" != "t" ]]; then
  fail "S1: la tabella events non esiste"
else
  ok "S1: la tabella events esiste"

  if [[ "${merge_cols_count}" != "3" ]]; then
    fail "S1: solo ${merge_cols_count}/3 fra canonical_event_id, merge_score, merge_reason esistono su events (10-02 non ancora atterrato)"
  else
    ok "S1: canonical_event_id, merge_score, merge_reason esistono tutte e tre su events"
  fi

  if [[ "${schema_ready}" == "1" ]]; then
    canonical_index="$(psql_dev "SELECT count(*) FROM pg_indexes WHERE tablename='events' AND indexdef ILIKE '%canonical_event_id%'")"
    if [[ "${canonical_index}" -lt 1 ]]; then
      fail "S1: nessun indice su canonical_event_id in pg_indexes"
    else
      ok "S1: esiste un indice su canonical_event_id"
    fi
  else
    fail "S1: indice su canonical_event_id non verificabile, la colonna non esiste ancora"
  fi

  pgtrgm_count="$(psql_dev "SELECT count(*) FROM pg_extension WHERE extname='pg_trgm'")"
  if [[ "${pgtrgm_count}" != "1" ]]; then
    fail "S1: l'estensione pg_trgm non e' installata nel Postgres locale"
  else
    ok "S1: l'estensione pg_trgm e' installata"
  fi
fi

# --- Sezione 2 (DEDUP-03) — normalizzazione titoli ------------------------------------------
if [[ ! -f "${repo_root}/lib/dedup/normalizeTitle.ts" ]]; then
  fail "S2: lib/dedup/normalizeTitle.ts non esiste ancora"
else
  if run_dev npx tsx lib/dedup/normalizeTitle.ts >/tmp/dedup-normalize-title.log 2>&1; then
    ok "S2: il self-check di lib/dedup/normalizeTitle.ts esce 0"
  else
    fail "S2: il self-check di lib/dedup/normalizeTitle.ts fallisce (vedi /tmp/dedup-normalize-title.log)"
  fi
fi

# --- Sezione 3 (DEDUP-02) — fixture etichettate contro la soglia ----------------------------
if [[ ! -f "${repo_root}/scripts/dedup-threshold-check.ts" ]]; then
  fail "S3: scripts/dedup-threshold-check.ts non esiste ancora"
else
  if run_dev npx tsx scripts/dedup-threshold-check.ts >/tmp/dedup-threshold-check.log 2>&1; then
    ok "S3: scripts/dedup-threshold-check.ts esce 0 su tutte le coppie di scripts/dedup-fixtures.ts"
  else
    fail "S3: scripts/dedup-threshold-check.ts fallisce su almeno una coppia della fixture etichettata (vedi /tmp/dedup-threshold-check.log)"
  fi
fi

# --- Sezione 4 (DEDUP-01) — un evento solo per gruppo ---------------------------------------
if [[ "${schema_ready}" != "1" ]]; then
  fail "S4: prerequisiti (colonne di fusione su events) non ancora presenti"
elif [[ "${dedup_events_script_exists}" != "1" ]]; then
  fail "S4: scripts/dedup-events.ts non esiste ancora"
else
  run_dev npx tsx scripts/dedup-events.ts >/tmp/dedup-events-run1.log 2>&1 || true

  declare -A known_groups=(
    ["sagra della brusadela|2419|2026-08-22"]="brusadela"
    ["sagra del gorgonzola a lomello|2372|2026-08-27"]="gorgonzola"
    ["sagra del luccio in salsa|2623|2026-09-03"]="luccio"
  )
  for key in "${!known_groups[@]}"; do
    frammento="${key%%|*}"
    rest="${key#*|}"
    comune="${rest%%|*}"
    giorno="${rest#*|}"
    n="$(psql_dev "SELECT count(*) FROM events WHERE canonical_event_id IS NULL AND comune_id = ${comune} AND date_start::date = '${giorno}' AND lower(title) LIKE '%${frammento}%'")"
    if [[ "${n}" != "1" ]]; then
      fail "S4: gruppo '${frammento}' (comune ${comune}, ${giorno}) ha ${n} righe canoniche non fuse, atteso 1"
    else
      ok "S4: gruppo '${frammento}' (comune ${comune}, ${giorno}) ha esattamente 1 riga canonica"
    fi
  done

  fused_total="$(psql_dev "SELECT count(*) FROM events WHERE canonical_event_id IS NOT NULL")"
  if [[ "${fused_total}" -lt 10 ]]; then
    fail "S4: count(*) FROM events WHERE canonical_event_id IS NOT NULL = ${fused_total}, atteso almeno 10"
  else
    ok "S4: ${fused_total} righe risultano fuse (>= 10)"
  fi
fi

# --- Sezione 5 (DEDUP-05) — nessuna riga cancellata, decisione ispezionabile ----------------
if [[ "${schema_ready}" != "1" ]]; then
  fail "S5: prerequisiti (colonne di fusione su events) non ancora presenti"
else
  count_before="$(psql_dev "SELECT count(*) FROM events")"
  run_dev npx tsx scripts/dedup-events.ts >/tmp/dedup-events-run-s5.log 2>&1 || true
  count_after="$(psql_dev "SELECT count(*) FROM events")"
  if [[ "${count_before}" != "${count_after}" ]]; then
    fail "S5: count(*) FROM events e' cambiato dopo il passo di dedup (${count_before} -> ${count_after}) — nessuna riga di sorgente deve mai essere cancellata"
  else
    ok "S5: count(*) FROM events invariato dopo il passo di dedup (${count_before})"
  fi

  incomplete_reason="$(psql_dev "SELECT count(*) FROM events WHERE canonical_event_id IS NOT NULL AND (merge_score IS NULL OR merge_reason IS NULL)")"
  if [[ "${incomplete_reason}" != "0" ]]; then
    fail "S5: ${incomplete_reason} righe fuse hanno merge_score o merge_reason nulli — la decisione deve essere sempre ispezionabile"
  else
    ok "S5: ogni riga fusa ha merge_score e merge_reason valorizzati"
  fi

  chained="$(psql_dev "SELECT count(*) FROM events m JOIN events c ON m.canonical_event_id = c.id WHERE c.canonical_event_id IS NOT NULL")"
  if [[ "${chained}" != "0" ]]; then
    fail "S5: ${chained} righe puntano a una canonica che a sua volta e' fusa — catena non ammessa"
  else
    ok "S5: nessuna catena di fusione (ogni canonica non e' a sua volta fusa)"
  fi

  self_ref="$(psql_dev "SELECT count(*) FROM events WHERE canonical_event_id = id")"
  if [[ "${self_ref}" != "0" ]]; then
    fail "S5: ${self_ref} righe puntano a se' stesse come canonica"
  else
    ok "S5: nessuna riga punta a se' stessa come canonica"
  fi
fi

# --- Sezione 6 (DEDUP-06) — idempotenza ------------------------------------------------------
if [[ "${schema_ready}" != "1" || "${dedup_events_script_exists}" != "1" ]]; then
  fail "S6: prerequisiti (colonne di fusione + scripts/dedup-events.ts) non ancora presenti"
else
  run_dev npx tsx scripts/dedup-events.ts >/tmp/dedup-events-run-s6a.log 2>&1 || true
  digest_1="$(psql_dev "SELECT md5(string_agg(id||':'||coalesce(canonical_event_id::text,'-')||':'||coalesce(merge_score::text,'-')||':'||coalesce(merge_reason,'-'), '|' ORDER BY id)) FROM events")"
  updated_at_1="$(psql_dev "SELECT max(updated_at)::text FROM events")"

  run_dev npx tsx scripts/dedup-events.ts >/tmp/dedup-events-run-s6b.log 2>&1 || true
  digest_2="$(psql_dev "SELECT md5(string_agg(id||':'||coalesce(canonical_event_id::text,'-')||':'||coalesce(merge_score::text,'-')||':'||coalesce(merge_reason,'-'), '|' ORDER BY id)) FROM events")"
  updated_at_2="$(psql_dev "SELECT max(updated_at)::text FROM events")"

  if [[ "${digest_1}" != "${digest_2}" ]]; then
    fail "S6: il digest di stato (id, canonical_event_id, merge_score, merge_reason) e' cambiato fra due esecuzioni consecutive (${digest_1} -> ${digest_2})"
  else
    ok "S6: digest di stato identico fra due esecuzioni consecutive (${digest_1})"
  fi

  if [[ "${updated_at_1}" != "${updated_at_2}" ]]; then
    fail "S6: max(updated_at) e' cambiato fra la prima e la seconda esecuzione (${updated_at_1} -> ${updated_at_2}) — la seconda passata non deve scrivere nulla"
  else
    ok "S6: max(updated_at) invariato fra la prima e la seconda esecuzione — la seconda passata e' un no-op"
  fi
fi

# --- Sezione 7 (DEDUP-04) — composizione del valore vincente -------------------------------
if [[ ! -f "${repo_root}/lib/dedup/compose.ts" ]]; then
  fail "S7: lib/dedup/compose.ts non esiste ancora"
else
  if run_dev npx tsx lib/dedup/compose.ts >/tmp/dedup-compose.log 2>&1; then
    ok "S7: il self-check di lib/dedup/compose.ts esce 0"
  else
    fail "S7: il self-check di lib/dedup/compose.ts fallisce (vedi /tmp/dedup-compose.log)"
  fi
fi

# --- Sezione 8 (D-07) — metrica no_geo -------------------------------------------------------
if [[ "${schema_ready}" != "1" ]]; then
  fail "S8: prerequisiti (colonna merge_reason su events) non ancora presenti"
else
  no_geo_reason="$(psql_dev "SELECT count(*) FROM events WHERE merge_reason = 'no_geo'")"
  no_comune="$(psql_dev "SELECT count(*) FROM events WHERE comune_id IS NULL")"
  if [[ "${no_geo_reason}" != "${no_comune}" ]]; then
    fail "S8: count(merge_reason='no_geo') = ${no_geo_reason}, diverso da count(comune_id IS NULL) = ${no_comune}"
  else
    ok "S8: count(merge_reason='no_geo') coincide con count(comune_id IS NULL) (${no_geo_reason})"
  fi
  if [[ "${no_geo_reason}" -lt 1 ]]; then
    fail "S8: nessuna riga ha merge_reason='no_geo', atteso almeno 1"
  else
    ok "S8: almeno una riga ha merge_reason='no_geo' (${no_geo_reason})"
  fi

  fused_without_comune="$(psql_dev "SELECT count(*) FROM events WHERE comune_id IS NULL AND canonical_event_id IS NOT NULL")"
  if [[ "${fused_without_comune}" != "0" ]]; then
    fail "S8: ${fused_without_comune} righe senza comune risultano comunque fuse (D-07 lo vieta sempre)"
  else
    ok "S8: nessuna riga senza comune risulta fusa"
  fi
fi

# --- Sezione 9 (D-03) — aggancio al runner ---------------------------------------------------
# Escludere le righe di commento prima di contare — una parola scritta dentro un
# commento non e' una chiamata (stesso idioma della sezione D-15 dell'analogo
# territoriale).
runner_file="${repo_root}/lib/scrapers/runner.ts"
if [[ ! -f "${runner_file}" ]]; then
  fail "S9: ${runner_file} non esiste"
else
  code_calls="$(grep -v '^[[:space:]]*\(//\|\*\|/\*\)' "${runner_file}" | grep -c 'dedupeEvents(' || true)"
  if [[ "${code_calls}" -lt 1 ]]; then
    fail "S9: nessuna riga di codice in lib/scrapers/runner.ts invoca dedupeEvents() — senza quella chiamata ogni scrape futuro crea eventi che nessuno dedupica"
  else
    ok "S9: lib/scrapers/runner.ts contiene almeno una chiamata a dedupeEvents() in codice (non in commento)"
  fi
fi

# --- Sezione 10 (DEDUP-01) — superficie di lettura filtrata --------------------------------
# Cinque su cinque, non quattro — e' l'errore che il gate esiste per intercettare.
read_surface_files=(
  "app/api/events/route.ts"
  "app/page.tsx"
  "app/api/categories/route.ts"
  "app/sitemap.ts"
  "lib/clusterCache.ts"
)
for f in "${read_surface_files[@]}"; do
  full_path="${repo_root}/${f}"
  if [[ ! -f "${full_path}" ]]; then
    fail "S10: ${f} non esiste"
    continue
  fi
  occurrences="$(grep -v '^[[:space:]]*\(//\|\*\|/\*\)' "${full_path}" | grep -c 'canonicalEventId' || true)"
  if [[ "${occurrences}" -lt 1 ]]; then
    fail "S10: ${f} non contiene alcuna occorrenza di canonicalEventId in codice (non in commento)"
  else
    ok "S10: ${f} contiene almeno un'occorrenza di canonicalEventId in codice"
  fi
done

# --- Riepilogo -------------------------------------------------------------------------------
if [[ "${#failures[@]}" -gt 0 ]]; then
  echo ""
  echo "SEZIONI ROSSE (${#failures[@]}):"
  for f in "${failures[@]}"; do
    echo "  - ${f}"
  done
  exit 1
else
  echo ""
  echo "PASS: tutte le sezioni del gate di deduplica sono verdi"
  exit 0
fi
