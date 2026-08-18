#!/usr/bin/env bash
# Gate della Fase 6 (Territorial Data Model): TERR-01, TERR-02, TERR-03, TERR-04,
# TERR-05, TERR-07. Nasce a Wave 0 (06-01 Task 0), PRIMA che tabelle e moduli che
# verifica esistano — a Wave 0 e' rosso per costruzione, ed e' proprio questo il
# punto: un gate che nasce verde non ha mai dimostrato di saper fallire.
#
# Accesso al database SOLO tramite il container locale (psql_dev) o scripts/dev-db.sh
# (per gli script tsx). Nessun percorso di questo file legge DATABASE_URL dal file
# di ambiente locale che punta a produzione (D-12/D-13).
#
# A differenza di scripts/registry-parity.test.sh, `fail()` qui NON esce subito:
# accumula i messaggi in un array e continua. Durante l'esecuzione della fase questo
# file e' rosso su piu' sezioni contemporaneamente (le tabelle/moduli che ciascuna
# sezione verifica atterrano in piani diversi, 06-01..06-05); un'uscita al primo
# fallimento nasconderebbe le sezioni successive e renderebbe impossibile vedere in
# un colpo solo quali sono ancora scoperte.
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

tmp_dirs=()
test_event_ids=()
cleanup() {
  for d in "${tmp_dirs[@]:-}"; do
    [[ -n "${d}" && -d "${d}" ]] && rm -rf "${d}"
  done
  # L'evento di prova viene sempre ripulito, anche a script fallito o interrotto.
  psql_dev "DELETE FROM events WHERE source = '__territorial_test__'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- Accesso al database, solo container locale ------------------------------------------
# Nessun percorso qui legge DATABASE_URL dal file di ambiente locale (produzione, D-12/D-13).
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

# --- Sezione 1 (TERR-01) — anagrafica comuni ----------------------------------------------
comuni_exists="$(psql_dev "SELECT to_regclass('public.comuni') IS NOT NULL" 2>/dev/null || echo f)"
if [[ "${comuni_exists}" != "t" ]]; then
  fail "TERR-01: la tabella comuni non esiste ancora"
else
  comuni_count="$(psql_dev "SELECT count(*) FROM comuni")"
  if [[ "${comuni_count}" -lt 7000 ]]; then
    fail "TERR-01: count(*) FROM comuni e' ${comuni_count}, atteso almeno 7000 (seed nazionale non ancora atterrato)"
  else
    ok "TERR-01: count(*) FROM comuni = ${comuni_count} (>= 7000)"
  fi

  bad_codes="$(psql_dev "SELECT count(*) FROM comuni WHERE length(istat_code) <> 6")"
  if [[ "${bad_codes}" != "0" ]]; then
    fail "TERR-01: ${bad_codes} righe hanno length(istat_code) <> 6"
  else
    ok "TERR-01: tutti gli istat_code hanno lunghezza 6"
  fi

  distinct_codes="$(psql_dev "SELECT count(DISTINCT istat_code) FROM comuni")"
  total_rows="$(psql_dev "SELECT count(*) FROM comuni")"
  if [[ "${distinct_codes}" != "${total_rows}" ]]; then
    fail "TERR-01: istat_code distinti (${distinct_codes}) diversi dal numero di righe (${total_rows})"
  else
    ok "TERR-01: istat_code distinti = numero di righe (${distinct_codes})"
  fi

  distinct_regions="$(psql_dev "SELECT count(DISTINCT region_name) FROM comuni")"
  if [[ "${distinct_regions}" != "20" ]]; then
    fail "TERR-01: count(DISTINCT region_name) = ${distinct_regions}, atteso 20"
  else
    ok "TERR-01: count(DISTINCT region_name) = 20"
  fi

  milano_found="$(psql_dev "SELECT count(*) FROM comuni WHERE istat_code = '015146'")"
  if [[ "${milano_found}" != "1" ]]; then
    fail "TERR-01: Milano (istat_code 015146) non raggiungibile per codice ISTAT"
  else
    ok "TERR-01: Milano raggiungibile per codice ISTAT (015146)"
  fi
fi

# --- Sezione 2 (TERR-02) — alias ------------------------------------------------------------
if [[ "${comuni_exists}" != "t" ]]; then
  fail "TERR-02: la tabella comuni non esiste ancora, impossibile verificare aliases"
else
  null_aliases="$(psql_dev "SELECT count(*) FROM comuni WHERE aliases IS NULL")"
  if [[ "${null_aliases}" != "0" ]]; then
    fail "TERR-02: ${null_aliases} righe hanno aliases IS NULL (atteso: default '{}', mai null)"
  else
    ok "TERR-02: nessuna riga ha aliases IS NULL"
  fi

  any_alias="$(psql_dev "SELECT count(*) FROM comuni WHERE aliases <> '{}'")"
  if [[ "${any_alias}" -lt 1 ]]; then
    fail "TERR-02: nessuna riga ha aliases <> '{}' (alias altoatesini non ancora seminati)"
  else
    ok "TERR-02: almeno una riga ha aliases non vuoto (${any_alias})"
  fi

  empty_alias_match="$(psql_dev "SELECT count(*) FROM comuni WHERE '' = ANY(aliases)")"
  if [[ "${empty_alias_match}" != "0" ]]; then
    fail "TERR-02: '' = ANY(aliases) restituisce ${empty_alias_match} righe, atteso 0"
  else
    ok "TERR-02: '' = ANY(aliases) non restituisce righe"
  fi

  # 'Bozen', non 'St. Ulrich'/'Urtijei' (bug ereditato dal Task 0 di 06-01,
  # corretto in 06-03): verificato con query dirette contro Wikidata (fonte
  # approvata al checkpoint) che Ortisei ha solo 'Ortisei' come P1448/P1705 —
  # nessuna native label registrata per St. Ulrich/Urtijei al momento del
  # fetch. 'Bozen' (Bolzano) e' invece reale e verificato (P1448, CC0).
  altoatesino="$(psql_dev "SELECT count(*) FROM comuni WHERE 'Bozen' = ANY(aliases)")"
  if [[ "${altoatesino}" -lt 1 ]]; then
    fail "TERR-02: nessun comune altoatesino raggiungibile per alias tedesco/ladino (seed alias non ancora atterrato)"
  else
    ok "TERR-02: comune altoatesino raggiungibile sotto il nome alternativo"
  fi
fi

# --- Sezione 3 (TERR-03) — aggancio e join ---------------------------------------------------
events_exist="$(psql_dev "SELECT to_regclass('public.events') IS NOT NULL")"
comune_id_col="$(psql_dev "SELECT count(*) FROM information_schema.columns WHERE table_name='events' AND column_name='comune_id'" 2>/dev/null || echo 0)"
if [[ "${events_exist}" != "t" || "${comune_id_col}" != "1" ]]; then
  fail "TERR-03: la colonna events.comune_id non esiste ancora"
else
  linked_events="$(psql_dev "SELECT count(*) FROM events WHERE comune_id IS NOT NULL")"
  if [[ "${linked_events}" -lt 1 ]]; then
    fail "TERR-03: nessun evento ha comune_id valorizzato (backfill non ancora eseguito)"
  else
    ok "TERR-03: ${linked_events} eventi hanno comune_id valorizzato"
  fi

  bad_join="$(psql_dev "SELECT count(*) FROM events e JOIN comuni c ON c.id = e.comune_id WHERE coalesce(c.province_name,'')='' OR coalesce(c.region_name,'')=''")"
  if [[ "${bad_join}" != "0" ]]; then
    fail "TERR-03: ${bad_join} eventi agganciati restituiscono provincia o regione vuota via join"
  else
    ok "TERR-03: il join a comuni restituisce provincia e regione non vuote per ogni evento agganciato"
  fi

  orphan_coordsource="$(psql_dev "SELECT count(*) FROM events WHERE comune_id IS NULL AND coordinate_source IS NOT NULL AND resolved_latitude IS NULL AND resolved_longitude IS NULL")"
  if [[ "${orphan_coordsource}" != "0" ]]; then
    fail "TERR-03: ${orphan_coordsource} eventi hanno coordinate_source valorizzato con comune_id nullo e coordinate risolte nulle"
  else
    ok "TERR-03: nessun evento ha coordinate_source valorizzato con comune_id nullo e coordinate risolte nulle"
  fi
fi

# --- Sezione 4 (TERR-04) — idempotenza, e prima la prova che sa fallire --------------------
# Ordine vincolante:
#   1. crea un evento di prova (source='__territorial_test__', location_name = nome di un
#      comune seminato, coordinate di sorgente nulle, date_start futura) — cancellato sempre
#      dalla cleanup, mai una riga reale mutata;
#   2. esegui il backfill una prima volta e verifica che l'evento risulti agganciato;
#   3. calcola il digest di stato su TUTTI gli eventi, updated_at incluso: e' cio' che rende
#      osservabile una riscrittura a valore identico (D-08);
#   4. prova di non-vacuita': azzera a mano le colonne risolte del solo evento di prova,
#      riesegui il backfill e verifica che riscriva la riga (comune_id tornato al valore
#      precedente, updated_at cambiato). Se questo non si verifica, il confronto non sa
#      distinguere uno stato diverso da uno uguale: fail esplicito, e NON eseguire il passo 5;
#   5. solo ora, a dati fermi, riesegui una terza volta e verifica che il digest di stato sia
#      identico a quello immediatamente successivo al passo 4 (non a quello del passo 3: il
#      passo 4 cambia deliberatamente updated_at dell'evento di prova, quindi il digest del
#      passo 3 non puo' piu' coincidere con nessuno stato successivo — e' proprio quella
#      differenza che il passo 4 doveva dimostrare di saper rilevare). Il confronto che conta
#      per l'idempotenza (D-08) e' "l'esecuzione a dati fermi non cambia nulla rispetto a
#      subito prima di lei", non rispetto a uno stato precedente alla mutazione deliberata;
#   6. verifica che il report dell'ultima esecuzione dichiari updated: 0.
if [[ "${comuni_exists}" != "t" || "${events_exist}" != "t" || "${comune_id_col}" != "1" ]]; then
  fail "TERR-04: prerequisiti (tabella comuni + colonne territoriali su events) non ancora presenti"
else
  seed_comune_name="$(psql_dev "SELECT name FROM comuni ORDER BY id LIMIT 1")"
  if [[ -z "${seed_comune_name}" ]]; then
    fail "TERR-04: nessun comune in tabella da usare come location_name dell'evento di prova"
  else
    test_source_id="territorial-idempotency-$$"
    # L'INSERT e' avvolto in un CTE con SELECT esterno: psql -tAc stampa comunque il
    # tag di completamento ("INSERT 0 1") dopo un INSERT ... RETURNING, anche in
    # modalita' tuples-only, corrompendo la cattura della sola colonna id. Con il
    # comando top-level ridotto a un SELECT, il tag sparisce e resta solo l'id.
    test_event_id="$(psql_dev "WITH ins AS (INSERT INTO events (source, source_id, title, date_start, location_name, latitude, longitude, created_at, updated_at) VALUES ('__territorial_test__', '${test_source_id}', 'Evento di prova idempotenza', now() + interval '30 days', '${seed_comune_name}', NULL, NULL, now(), now()) RETURNING id) SELECT id FROM ins")"
    if [[ -z "${test_event_id}" ]]; then
      fail "TERR-04: impossibile creare l'evento di prova"
    else
      # passo 2: prima esecuzione, l'evento di prova deve agganciarsi
      run_dev npx tsx scripts/backfill-events.ts >/tmp/territorial-backfill-run1.log 2>&1 || true
      first_link="$(psql_dev "SELECT comune_id FROM events WHERE id = ${test_event_id}")"
      if [[ -z "${first_link}" || "${first_link}" == "" ]]; then
        fail "TERR-04: l'evento di prova non risulta agganciato dopo la prima esecuzione del backfill"
      else
        ok "TERR-04: l'evento di prova si aggancia al comune '${seed_comune_name}' alla prima esecuzione"

        # passo 3 (il digest di stato "a dati fermi" che conta per il passo 5 viene
        # calcolato piu' sotto, subito dopo il passo 4: vedi il commento sopra il
        # passo 5 sul perche' non e' questo il punto di confronto giusto) e
        # passo 4: prova di non-vacuita' — azzera a mano le colonne risolte dell'evento di prova
        pre_reset_updated_at="$(psql_dev "SELECT extract(epoch from updated_at)::text FROM events WHERE id = ${test_event_id}")"
        psql_dev "UPDATE events SET comune_id = NULL, resolved_latitude = NULL, resolved_longitude = NULL, coordinate_source = NULL WHERE id = ${test_event_id}" >/dev/null

        run_dev npx tsx scripts/backfill-events.ts >/tmp/territorial-backfill-run2.log 2>&1 || true
        post_reset_comune_id="$(psql_dev "SELECT comune_id FROM events WHERE id = ${test_event_id}")"
        post_reset_updated_at="$(psql_dev "SELECT extract(epoch from updated_at)::text FROM events WHERE id = ${test_event_id}")"

        vacuity_ok=1
        if [[ "${post_reset_comune_id}" != "${first_link}" ]]; then
          fail "TERR-04 prova di non-vacuita': dopo l'azzeramento manuale, comune_id non e' tornato al valore precedente (${post_reset_comune_id} != ${first_link})"
          vacuity_ok=0
        fi
        if [[ "${post_reset_updated_at}" == "${pre_reset_updated_at}" ]]; then
          fail "TERR-04 prova di non-vacuita': updated_at non e' cambiato dopo la riscrittura — il confronto non sa distinguere uno stato diverso da uno uguale, il passo 5 misurerebbe il nulla"
          vacuity_ok=0
        fi

        if [[ "${vacuity_ok}" == "1" ]]; then
          ok "TERR-04: la prova di non-vacuita' ha rilevato la differenza deliberata (comune_id riscritto, updated_at cambiato)"

          # digest "a dati fermi": lo stato subito dopo il passo 4, che e' il punto di
          # partenza reale su cui il passo 5 deve dimostrarsi un no-op (vedi commento
          # sopra il passo 5 sul perche' non e' il digest del passo 3).
          digest_at_rest="$(psql_dev "SELECT md5(string_agg(id::text||':'||coalesce(comune_id::text,'')||':'||coalesce(resolved_latitude::text,'')||':'||coalesce(resolved_longitude::text,'')||':'||coalesce(coordinate_source,'')||':'||extract(epoch from updated_at)::text, '|' ORDER BY id)) FROM events")"

          # passo 5: a dati fermi, terza esecuzione — digest deve essere identico
          run_dev npx tsx scripts/backfill-events.ts >/tmp/territorial-backfill-run3.log 2>&1 || true
          digest_after="$(psql_dev "SELECT md5(string_agg(id::text||':'||coalesce(comune_id::text,'')||':'||coalesce(resolved_latitude::text,'')||':'||coalesce(resolved_longitude::text,'')||':'||coalesce(coordinate_source,'')||':'||extract(epoch from updated_at)::text, '|' ORDER BY id)) FROM events")"

          if [[ "${digest_after}" != "${digest_at_rest}" ]]; then
            fail "TERR-04: il digest di stato e' cambiato dopo l'esecuzione a dati fermi (${digest_at_rest} -> ${digest_after}) — non e' un no-op"
          else
            ok "TERR-04: digest di stato identico a dati fermi (${digest_at_rest})"
          fi

          # passo 6: il report dichiara updated: 0 sull'ultima esecuzione
          if grep -qE 'updated[":= ]+0\b' /tmp/territorial-backfill-run3.log; then
            ok "TERR-04: il report dell'ultima esecuzione dichiara updated: 0"
          else
            fail "TERR-04: il report dell'ultima esecuzione non dichiara updated: 0 (vedi /tmp/territorial-backfill-run3.log)"
          fi
        else
          fail "TERR-04: passo 5 saltato perche' la prova di non-vacuita' non ha dimostrato che il confronto sa rilevare una differenza"
        fi
      fi
    fi
  fi
fi

# --- Sezione 5 (TERR-05) — reimport che non spezza gli agganci -----------------------------
seed_csv="${repo_root}/scripts/__fixtures__/comuni-tracer.csv"
if [[ "${comuni_exists}" != "t" || ! -f "${seed_csv}" ]]; then
  fail "TERR-05: prerequisiti (tabella comuni + fixture di seed) non ancora presenti"
else
  linked_before="$(psql_dev "SELECT count(*) FROM events WHERE comune_id IS NOT NULL")"
  # Vincolato ai due istat_code del fixture (Milano/Bergamo), non un comune
  # qualunque via LIMIT 1 senza ORDER BY (bug ereditato, scoperto in 06-03
  # dopo il seed nazionale: con 7894 comuni e centinaia di eventi agganciati,
  # 'LIMIT 1' senza filtro poteva pescare un comune ASSENTE dal fixture di
  # reimport usato sotto — la mutazione su quella riga non poteva mai essere
  # rilevata dal reimport per costruzione, e la sezione falliva a prescindere
  # dalla correttezza del codice).
  sample_comune_id="$(psql_dev "SELECT c.id FROM comuni c JOIN events e ON e.comune_id = c.id WHERE c.istat_code IN ('015146','016024') LIMIT 1")"
  if [[ -z "${sample_comune_id}" ]]; then
    fail "TERR-05: nessun comune del fixture di reimport (Milano/Bergamo) e' agganciato a un evento da usare per la prova"
  else
    original_name="$(psql_dev "SELECT name FROM comuni WHERE id = ${sample_comune_id}")"
    psql_dev "UPDATE comuni SET name = 'NOME ALTERATO PER PROVA' WHERE id = ${sample_comune_id}" >/dev/null
    run_dev npx tsx scripts/seed-comuni.ts --csv "${seed_csv}" >/tmp/territorial-seed-reimport.log 2>&1 || true

    reimported_name="$(psql_dev "SELECT name FROM comuni WHERE id = ${sample_comune_id}")"
    if [[ "${reimported_name}" == "NOME ALTERATO PER PROVA" ]]; then
      fail "TERR-05: il reimport non ha rilevato il nome alterato — la prova non varrebbe niente"
    elif [[ "${reimported_name}" != "${original_name}" ]]; then
      fail "TERR-05: dopo il reimport il nome e' '${reimported_name}', atteso il valore ufficiale '${original_name}'"
    else
      ok "TERR-05: il reimport ha ripristinato il nome ufficiale '${original_name}'"
    fi

    row_still_same_id="$(psql_dev "SELECT count(*) FROM comuni WHERE id = ${sample_comune_id}")"
    if [[ "${row_still_same_id}" != "1" ]]; then
      fail "TERR-05: comuni.id ${sample_comune_id} non e' piu' la stessa riga dopo il reimport"
    else
      ok "TERR-05: comuni.id ${sample_comune_id} e' rimasto lo stesso dopo il reimport (upsert, non insert)"
    fi

    linked_after="$(psql_dev "SELECT count(*) FROM events WHERE comune_id IS NOT NULL")"
    if [[ "${linked_after}" != "${linked_before}" ]]; then
      fail "TERR-05: il conteggio degli eventi agganciati e' cambiato dopo il reimport (${linked_before} -> ${linked_after})"
    else
      ok "TERR-05: il conteggio degli eventi agganciati e' invariato dopo il reimport (${linked_after})"
    fi
  fi
fi

# --- Sezione 7 (TERR-07) — il punto arriva davvero in mappa --------------------------------
cache_exists="$(psql_dev "SELECT to_regclass('public.map_cluster_cache') IS NOT NULL")"
resolved_cols="$(psql_dev "SELECT count(*) FROM information_schema.columns WHERE table_name='events' AND column_name IN ('resolved_latitude','resolved_longitude')" 2>/dev/null || echo 0)"
if [[ "${cache_exists}" != "t" || "${resolved_cols}" != "2" ]]; then
  fail "TERR-07: prerequisiti (map_cluster_cache + colonne risolte) non ancora presenti"
else
  cache_row="$(psql_dev "SELECT count(*) FROM map_cluster_cache WHERE id='default'")"
  if [[ "${cache_row}" != "1" ]]; then
    fail "TERR-07: nessuna riga map_cluster_cache con id='default' (cache mai calcolata)"
  else
    feature_count="$(psql_dev "SELECT jsonb_array_length((SELECT geojson->'features' FROM map_cluster_cache WHERE id='default'))")"
    expected_count="$(psql_dev "SELECT count(*) FROM events WHERE date_start >= date_trunc('day', now()) AND resolved_latitude IS NOT NULL AND resolved_longitude IS NOT NULL")"
    if [[ "${feature_count}" != "${expected_count}" ]]; then
      fail "TERR-07: il numero di feature nel GeoJSON (${feature_count}) e' diverso dagli eventi futuri con coordinate risolte non nulle (${expected_count})"
    else
      ok "TERR-07: il numero di feature nel GeoJSON coincide con gli eventi futuri risolti (${feature_count})"
    fi

    # Corretto in 06-02: questa sezione nasce in 06-01 quando D-11 non esisteva
    # ancora e il centroide non sostituiva mai la sorgente (D-09 originale:
    # "la sorgente vince sempre", punto e basta). Con D-11 (06-02) una
    # coordinata di sorgente IMPLAUSIBILE (0,0 o fuori bbox Italia) viene
    # trattata come assente e sostituita dal centroide SOLO se un comune si
    # aggancia — se il comune resta non risolto, quell'evento perde
    # legittimamente il pin (meglio nessun pin che un pin fantasma a 0,0).
    # L'invariante corretto oggi non e' piu' "ogni latitude non nulla produce
    # un resolved_latitude", ma "ogni latitude PLAUSIBILE (D-11) produce un
    # resolved_latitude" — la sorgente, quando plausibile, vince sempre
    # (D-14) a prescindere dall'aggancio del comune. Stessi limiti di
    # lib/territorial/bbox.ts (ITALY_BOUNDS), duplicati qui perche' questo
    # file bash non puo' importare il modulo TypeScript.
    lost_pins="$(psql_dev "SELECT count(*) FROM events WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND NOT (latitude = 0 AND longitude = 0) AND latitude BETWEEN 35.2 AND 47.15 AND longitude BETWEEN 6.6 AND 18.6 AND resolved_latitude IS NULL")"
    if [[ "${lost_pins}" != "0" ]]; then
      fail "TERR-07: ${lost_pins} eventi con latitude di sorgente PLAUSIBILE hanno resolved_latitude nulla (pin persi)"
    else
      ok "TERR-07: nessun evento con coordinate di sorgente plausibili ha perso il pin dopo il repoint"
    fi

    sample_check="$(psql_dev "SELECT count(*) FROM map_cluster_cache, jsonb_array_elements(geojson->'features') f JOIN events e ON (f->'properties'->>'id')::int = e.id WHERE (f->'geometry'->'coordinates'->>0)::numeric <> e.resolved_longitude OR (f->'geometry'->'coordinates'->>1)::numeric <> e.resolved_latitude")"
    if [[ "${sample_check}" != "0" ]]; then
      fail "TERR-07: ${sample_check} feature hanno l'ordine [longitudine, latitudine] non coerente con resolved_longitude/resolved_latitude"
    else
      ok "TERR-07: le coordinate nel GeoJSON hanno la longitudine in prima posizione, coerenti con resolved_longitude/resolved_latitude"
    fi
  fi
fi

# --- Sezione 8 (D-14) — le coordinate di sorgente sono intatte -----------------------------
if [[ "${events_exist}" != "t" ]]; then
  fail "D-14: la tabella events non esiste"
else
  source_digest_before="$(psql_dev "SELECT md5(string_agg(id::text||':'||coalesce(latitude::text,'')||':'||coalesce(longitude::text,''),'|' ORDER BY id)) FROM events")"
  run_dev npx tsx scripts/backfill-events.ts >/tmp/territorial-backfill-d14.log 2>&1 || true
  source_digest_after="$(psql_dev "SELECT md5(string_agg(id::text||':'||coalesce(latitude::text,'')||':'||coalesce(longitude::text,''),'|' ORDER BY id)) FROM events")"
  if [[ "${source_digest_before}" != "${source_digest_after}" ]]; then
    fail "D-14: il digest delle coordinate di sorgente e' cambiato dopo il backfill (${source_digest_before} -> ${source_digest_after})"
  else
    ok "D-14: il digest delle coordinate di sorgente e' invariato dopo il backfill (${source_digest_before})"
  fi
fi

# --- Sezione 9 (D-15) — il runner chiama il backfill dopo saveEvents ----------------------
# Gate durevole contro la rimozione accidentale della chiamata: verifica che in
# lib/scrapers/runner.ts esista almeno una riga DI CODICE che invoca
# backfillEvents(), escludendo le righe di commento (// * /*) prima di
# contare — altrimenti un commento che nomina la funzione basterebbe a far
# passare il gate, e un controllo che si accontenta di una parola scritta in
# un commento non controlla niente.
runner_file="${repo_root}/lib/scrapers/runner.ts"
if [[ ! -f "${runner_file}" ]]; then
  fail "D-15: ${runner_file} non esiste"
else
  code_calls="$(grep -v '^[[:space:]]*\(//\|\*\|/\*\)' "${runner_file}" | grep -c 'backfillEvents(' || true)"
  if [[ "${code_calls}" -lt 1 ]]; then
    fail "D-15: nessuna riga di codice in lib/scrapers/runner.ts invoca backfillEvents() — senza quella chiamata ogni scrape futuro crea eventi che nessuno aggancia"
  else
    ok "D-15: lib/scrapers/runner.ts contiene almeno una chiamata a backfillEvents() in codice (non in commento)"
  fi
fi

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
  echo "PASS: tutte le sezioni del gate territoriale sono verdi"
  exit 0
fi
