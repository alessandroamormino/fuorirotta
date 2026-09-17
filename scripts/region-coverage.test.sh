#!/usr/bin/env bash
# Gate ROLL-03/ROLL-06 (D-01/D-02/D-04/D-08/D-09/D-11): soglia secca del
# segnale di copertura in entrambe le direzioni, e il contratto HTTP delle
# pagine /[regione] — 200 su una regione viva, 200+noindex su una regione
# ISTAT reale ma non ancora coperta, 404 su uno slug che non corrisponde a
# nessuna regione ISTAT.
#
# S1/S2 usano uno slug/sorgente di prova dedicati (__test_coverage_region__,
# __test_coverage_source__), mai un dato reale: nessuna riga esistente viene
# toccata, stesso idioma di scripts/region-lock.test.sh. S3/S7 (Fase 15,
# 15-03-PLAN.md) leggono invece i dati REALI gia' nel Postgres locale —
# lombardia ed emilia-romagna devono essere state ingerite localmente prima
# di lanciare questo gate (bash scripts/dev-db.sh npx tsx -e con runRegion(),
# vedi 15-03-SUMMARY.md); Puglia non e' asserita da nessuna parte, perche'
# l'host resta bloccato dal difetto TLS verificato in 15-RESEARCH.md. Richiede
# il Postgres locale (scripts/dev-db.sh, D-17) — mai il database di produzione.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

test_region="__test_coverage_region__"
test_source="__test_coverage_source__"
port="${REGION_COVERAGE_TEST_PORT:-39895}"
test_dist_dir=".next-region-coverage-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"
export COVERAGE_TEST_REGION="${test_region}"
# Fase 15 (D-10): comune/provincia di prova per S9/S10 — vuoto finche' non
# viene assegnato piu' sotto, cosi' cleanup() puo' riferirlo senza incorrere
# in una variabile non definita (set -u) se lo script fallisce prima.
test_comune_istat=""
test_province_code="ZZPV"
export COVERAGE_TEST_PROVINCE="${test_province_code}"

tmp_dir="$(mktemp -d)"
server_pid=""

fail() {
  echo "FAIL: $1"
  exit 1
}

psql_dev() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
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

cleanup() {
  stop_server
  psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null 2>&1 || true
  if [[ -n "${test_comune_istat}" ]]; then
    psql_dev "DELETE FROM comuni WHERE istat_code = '${test_comune_istat}'" >/dev/null 2>&1 || true
  fi
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

if ! docker compose -f "${repo_root}/docker-compose.dev.yml" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Stato pulito prima di iniziare, nel caso una run precedente sia rimasta a meta'.
psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null

# Letta dal modulo stesso, mai un letterale duplicato qui: se 15-03-PLAN.md
# (o un piano futuro) rimisura la costante, questo gate segue senza bisogno
# di essere toccato — resta comunque una prova della soglia SECCA, agli
# ESATTI due estremi (==soglia, ==soglia+1), non un valore a piacere.
coverage_threshold="$(bash scripts/dev-db.sh npx tsx -e '
import("./lib/coverage/liveRegions").then((m) => { console.log(m.COVERAGE_THRESHOLD); process.exit(0) })
' 2>&1)"
[[ "${coverage_threshold}" =~ ^[0-9]+$ ]] || fail "impossibile leggere COVERAGE_THRESHOLD da lib/coverage/liveRegions.ts: ${coverage_threshold}"

# --- S1: soglia secca, direzione bassa — esattamente COVERAGE_THRESHOLD
# eventi futuri per la regione di prova: non e' viva. Con soglia 0 questo
# inserisce zero righe, che e' anche la prova che getLiveRegions() non
# solleva eccezioni quando una regione non ha alcuna riga: il gruppo per
# __test_coverage_region__ non esiste affatto nel risultato di groupBy.
if [[ "${coverage_threshold}" -gt 0 ]]; then
  psql_dev "INSERT INTO events (source, source_id, title, date_start, region, canonical_category) SELECT '${test_source}', 't' || gs, 'Evento di prova copertura', now() + interval '1 day', '${test_region}', 'Altro' FROM generate_series(1, ${coverage_threshold}) AS gs" >/dev/null
fi

s1_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getLiveRegions } = await import("./lib/coverage/liveRegions")
  const live = await getLiveRegions()
  console.log(live.has(process.env.COVERAGE_TEST_REGION as string) ? "true" : "false")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
[[ "${s1_output}" == "false" ]] || fail "S1: con ${coverage_threshold} eventi futuri (== COVERAGE_THRESHOLD) la regione di prova risulta viva: ${s1_output}"
echo "S1 OK: ${coverage_threshold} eventi futuri (== COVERAGE_THRESHOLD) -> regione di prova NON viva, nessuna eccezione"

# --- S2: soglia secca, direzione alta — un evento futuro canonico IN PIU'
# (== COVERAGE_THRESHOLD + 1): la regione di prova diventa viva.
psql_dev "INSERT INTO events (source, source_id, title, date_start, region, canonical_category) VALUES ('${test_source}', 't$((coverage_threshold + 1))', 'Evento di prova copertura', now() + interval '1 day', '${test_region}', 'Altro')" >/dev/null

s2_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getLiveRegions } = await import("./lib/coverage/liveRegions")
  const live = await getLiveRegions()
  console.log(live.has(process.env.COVERAGE_TEST_REGION as string) ? "true" : "false")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
[[ "${s2_output}" == "true" ]] || fail "S2: con $((coverage_threshold + 1)) eventi futuri (== COVERAGE_THRESHOLD + 1) la regione di prova NON risulta viva: ${s2_output}"
echo "S2 OK: $((coverage_threshold + 1)) eventi futuri (== COVERAGE_THRESHOLD + 1) -> regione di prova viva"

psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null

# --- S3: getLiveRegions() su DATI REALI (Fase 15, D-14) — lombardia ed
# emilia-romagna devono comparire dopo l'ingestione locale di 15-03-PLAN.md.
# Puglia NON viene asserita qui: l'host resta bloccato dal difetto TLS
# verificato (15-RESEARCH.md Pitfall 2), quindi non e' mai stata ingerita in
# questo ambiente — asserirla qui la farebbe fallire per un motivo di rete
# che questo gate non ha modo di risolvere, non per un difetto del segnale.
s3_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getLiveRegions } = await import("./lib/coverage/liveRegions")
  const live = await getLiveRegions()
  console.log(JSON.stringify([...live].sort()))
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
printf '%s' "${s3_output}" | grep -q '"lombardia"' || fail "S3: getLiveRegions() non contiene 'lombardia' sui dati reali: ${s3_output}"
printf '%s' "${s3_output}" | grep -q '"emilia-romagna"' || fail "S3: getLiveRegions() non contiene 'emilia-romagna' sui dati reali (ingestione mancante o sotto soglia?): ${s3_output}"
echo "S3 OK: getLiveRegions() su dati reali contiene lombardia ed emilia-romagna: ${s3_output}"

# --- Setup comune di prova per S9/S10 (soglia secca sulla provincia, D-10) -
# Un comune di prova dedicato (mai un comune reale): getLiveProvinces() legge
# la provincia via JOIN comuni.province_code, non ha una colonna "region" di
# prova da riusare come S1/S2.
psql_dev "DELETE FROM comuni WHERE istat_code = 'ZZ9999'" >/dev/null
test_comune_istat="ZZ9999"
# CTE con SELECT esterno (stesso idioma di territorial-backfill.test.sh): psql
# -tAc stampa comunque il tag "INSERT 0 1" dopo un INSERT ... RETURNING anche
# in modalita' tuples-only, corrompendo la cattura della sola colonna id.
test_comune_id="$(psql_dev "WITH ins AS (INSERT INTO comuni (istat_code, name, province_code, province_name, region_code, region_name) VALUES ('${test_comune_istat}', '__test_coverage_comune__', '${test_province_code}', '__test_coverage_province__', 'ZZ', '${test_region}') RETURNING id) SELECT id FROM ins")"

# --- S9: soglia secca provincia, direzione bassa — esattamente
# COVERAGE_THRESHOLD eventi futuri agganciati al comune di prova: la
# provincia di prova non e' viva. Stessa logica di S1, un livello sotto.
if [[ "${coverage_threshold}" -gt 0 ]]; then
  psql_dev "INSERT INTO events (source, source_id, title, date_start, comune_id, canonical_category) SELECT '${test_source}', 'p' || gs, 'Evento di prova copertura provincia', now() + interval '1 day', ${test_comune_id}, 'Altro' FROM generate_series(1, ${coverage_threshold}) AS gs" >/dev/null
fi

s9_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getLiveProvinces } = await import("./lib/coverage/liveRegions")
  const live = await getLiveProvinces()
  console.log(live.has(process.env.COVERAGE_TEST_PROVINCE as string) ? "true" : "false")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
[[ "${s9_output}" == "false" ]] || fail "S9: con ${coverage_threshold} eventi futuri (== COVERAGE_THRESHOLD) la provincia di prova risulta viva: ${s9_output}"
echo "S9 OK: ${coverage_threshold} eventi futuri (== COVERAGE_THRESHOLD) -> provincia di prova NON viva"

# --- S10: soglia secca provincia, direzione alta — un evento futuro
# canonico IN PIU' (== COVERAGE_THRESHOLD + 1): la provincia di prova
# diventa viva. Stessa costante di S2 (D-10): nessuna soglia duplicata.
psql_dev "INSERT INTO events (source, source_id, title, date_start, comune_id, canonical_category) VALUES ('${test_source}', 'p$((coverage_threshold + 1))', 'Evento di prova copertura provincia', now() + interval '1 day', ${test_comune_id}, 'Altro')" >/dev/null

s10_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getLiveProvinces } = await import("./lib/coverage/liveRegions")
  const live = await getLiveProvinces()
  console.log(live.has(process.env.COVERAGE_TEST_PROVINCE as string) ? "true" : "false")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
[[ "${s10_output}" == "true" ]] || fail "S10: con $((coverage_threshold + 1)) eventi futuri (== COVERAGE_THRESHOLD + 1) la provincia di prova NON risulta viva: ${s10_output}"
echo "S10 OK: $((coverage_threshold + 1)) eventi futuri (== COVERAGE_THRESHOLD + 1) -> provincia di prova viva"

psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null

# --- S11: getProvinceDirectory() esclude i quattro codici provincia sardi
# aboliti dalla riforma del 2016 (15-RESEARCH.md Pitfall 4), anche se la
# tabella comuni li porta ancora per debito di seed della Fase 6.
s11_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getProvinceDirectory } = await import("./lib/coverage/liveRegions")
  const directory = await getProvinceDirectory()
  const codes = new Set(directory.map((p) => p.provinceCode))
  const leaked = ["OT", "OG", "VS", "CI"].filter((code) => codes.has(code))
  console.log(JSON.stringify(leaked))
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>&1)"
[[ "${s11_output}" == "[]" ]] || fail "S11: getProvinceDirectory() contiene ancora codici provincia sardi aboliti nel 2016: ${s11_output}"
echo "S11 OK: getProvinceDirectory() esclude OT/OG/VS/CI (province sarde abolite nel 2016)"

# --- Dev server effimero per S4/S5/S6/S7, Postgres locale reale (D-17) -----
bash scripts/dev-db.sh npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# --- S4: /lombardia (regione viva, dati reali) -> 200 -----------------------
resp4="${tmp_dir}/resp4.html"
http_code4="$(curl -s -o "${resp4}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/lombardia")"
[[ "${http_code4}" == "200" ]] || fail "S4: atteso 200 su /lombardia, ottenuto ${http_code4}"
echo "S4 OK: GET /lombardia (regione viva) risponde 200"

# --- S5: /zzz-non-esiste (slug non ISTAT) -> 404 ----------------------------
http_code5="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/zzz-non-esiste")"
[[ "${http_code5}" == "404" ]] || fail "S5: atteso 404 su /zzz-non-esiste, ottenuto ${http_code5}"
echo "S5 OK: GET /zzz-non-esiste (slug non ISTAT) risponde 404"

# --- S6: /molise (regione ISTAT reale, oggi senza eventi) -> 200 + noindex --
# D-11: mai 404, mai redirect per una regione reale non ancora coperta.
resp6="${tmp_dir}/resp6.html"
http_code6="$(curl -s -o "${resp6}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/molise")"
[[ "${http_code6}" == "200" ]] || fail "S6: atteso 200 su /molise (regione reale, non coperta), ottenuto ${http_code6}"
grep -qi "noindex" "${resp6}" || fail "S6: /molise risponde 200 ma il corpo non contiene 'noindex'"
echo "S6 OK: GET /molise (regione ISTAT reale, non coperta) risponde 200 con noindex"

# --- S7: /emilia-romagna (regione ISTAT reale, ORA viva dopo 15-03-PLAN.md)
# -> 200 SENZA noindex — la stessa regione di S3, ma sul contratto HTTP di
# ROLL-06 invece che sul segnale grezzo di ROLL-03. D-11: nessuna differenza
# di stato URL rispetto a prima dell'accensione, solo il contenuto cambia.
resp7="${tmp_dir}/resp7.html"
http_code7="$(curl -s -o "${resp7}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/emilia-romagna")"
[[ "${http_code7}" == "200" ]] || fail "S7: atteso 200 su /emilia-romagna (regione ora viva), ottenuto ${http_code7}"
grep -qi "noindex" "${resp7}" && fail "S7: /emilia-romagna e' viva (S3) ma la pagina porta ancora 'noindex'"
echo "S7 OK: GET /emilia-romagna (regione ISTAT reale, ora viva) risponde 200 senza noindex"

# --- S15: /lombardia/bergamo (provincia viva, dati reali) -> 200, con
# almeno un link a un evento reale nel corpo. Dato reale (come S3/S6/S7):
# bergamo e' viva sui volumi di lombardia osservati (1.806 eventi futuri
# canonici, S3), non un dato sintetico.
resp15="${tmp_dir}/resp15.html"
http_code15="$(curl -s -o "${resp15}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/lombardia/bergamo")"
[[ "${http_code15}" == "200" ]] || fail "S15: atteso 200 su /lombardia/bergamo, ottenuto ${http_code15}"
grep -qE '/eventi/[0-9]+' "${resp15}" || fail "S15: /lombardia/bergamo risponde 200 ma il corpo non contiene alcun link a un evento"
echo "S15 OK: GET /lombardia/bergamo (provincia viva) risponde 200 con almeno un evento"

# --- S16: /emilia-romagna/ferrara (provincia esistente, oggi sotto soglia)
# -> 200 + noindex. D-11: mai 404, mai redirect per una provincia reale non
# ancora coperta. Dato reale: emilia-romagna ha solo bologna sopra soglia
# oggi (6 eventi futuri totali, S3/S7).
resp16="${tmp_dir}/resp16.html"
http_code16="$(curl -s -o "${resp16}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/emilia-romagna/ferrara")"
[[ "${http_code16}" == "200" ]] || fail "S16: atteso 200 su /emilia-romagna/ferrara (provincia reale, non coperta), ottenuto ${http_code16}"
grep -qi "noindex" "${resp16}" || fail "S16: /emilia-romagna/ferrara risponde 200 ma il corpo non contiene 'noindex'"
echo "S16 OK: GET /emilia-romagna/ferrara (provincia ISTAT reale, non coperta) risponde 200 con noindex"

# --- S17: /lombardia/bari (provincia esistente, ma della REGIONE SBAGLIATA)
# -> 404. Una provincia pugliese sotto /lombardia/ non e' una pagina spenta,
# e' un URL sbagliato (T-15-03).
http_code17="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/lombardia/bari")"
[[ "${http_code17}" == "404" ]] || fail "S17: atteso 404 su /lombardia/bari (provincia di un'altra regione), ottenuto ${http_code17}"
echo "S17 OK: GET /lombardia/bari (provincia esistente ma di un'altra regione) risponde 404"

# --- S18: due caricamenti consecutivi della stessa pagina provincia
# elencano gli eventi nello stesso ordine.
resp18="${tmp_dir}/resp18.html"
curl -s -o "${resp18}" --max-time 15 "http://127.0.0.1:${port}/lombardia/bergamo" >/dev/null
order15="$(grep -oE '/eventi/[0-9]+' "${resp15}")"
order18="$(grep -oE '/eventi/[0-9]+' "${resp18}")"
[[ "${order15}" == "${order18}" ]] || fail "S18: due caricamenti consecutivi di /lombardia/bergamo elencano gli eventi in un ordine diverso"
echo "S18 OK: due caricamenti consecutivi di /lombardia/bergamo elencano gli eventi nello stesso ordine"

# --- S19/S20/S21: l'indicatore di copertura di /api/events (D-06/D-07). Id
# comune letti dal DB (mai un letterale numerico congelato): la regione di
# appartenenza e' cio' che conta, non l'id specifico di oggi.
bergamo_comune_id="$(psql_dev "SELECT id FROM comuni WHERE province_code = 'BG' ORDER BY id LIMIT 1")"
molise_comune_id="$(psql_dev "SELECT id FROM comuni WHERE region_name = 'Molise' ORDER BY id LIMIT 1")"
[[ -n "${bergamo_comune_id}" && -n "${molise_comune_id}" ]] || fail "S19: impossibile trovare un comune di prova (bergamo/molise) in tabella comuni"

# --- S19: comuneId di una regione NON coperta (molise) -> indicatore
# region-not-covered, a prescindere dal numero di risultati.
resp19="${tmp_dir}/resp19.json"
curl -s -o "${resp19}" --max-time 15 "http://127.0.0.1:${port}/api/events?comuneId=${molise_comune_id}&limit=1"
grep -q '"coverage":"region-not-covered"' "${resp19}" || fail "S19: /api/events?comuneId=${molise_comune_id} (molise, non coperta) non porta l'indicatore region-not-covered: $(cat "${resp19}")"
echo "S19 OK: /api/events con comuneId di una regione non coperta porta l'indicatore region-not-covered"

# --- S20: comuneId di una regione coperta (lombardia/bergamo) con un
# intervallo di date senza eventi -> indicatore no-events-for-filters.
resp20="${tmp_dir}/resp20.json"
curl -s -o "${resp20}" --max-time 15 "http://127.0.0.1:${port}/api/events?comuneId=${bergamo_comune_id}&dateFrom=2000-01-01&dateTo=2000-01-02&limit=1"
grep -q '"coverage":"no-events-for-filters"' "${resp20}" || fail "S20: /api/events?comuneId=${bergamo_comune_id} (bergamo, filtri vuoti) non porta l'indicatore no-events-for-filters: $(cat "${resp20}")"
echo "S20 OK: /api/events con comuneId di una regione coperta e filtri vuoti porta l'indicatore no-events-for-filters"

# --- S21: ricerca per raggio SENZA comuneId -> nessun indicatore, mai,
# nemmeno a zero risultati (D-07: niente prediche a chi cerca "vicino").
resp21="${tmp_dir}/resp21.json"
curl -s -o "${resp21}" --max-time 15 "http://127.0.0.1:${port}/api/events?lat=41.9&lng=12.5&radius=5&limit=1"
grep -q '"coverage":null' "${resp21}" || fail "S21: /api/events per raggio senza comuneId porta un indicatore di copertura: $(cat "${resp21}")"
echo "S21 OK: /api/events per raggio senza comuneId non porta alcun indicatore di copertura"

# --- S12: la sitemap contiene almeno una voce provincia viva sotto
# /lombardia/ — la soglia e' abbondantemente sotto i volumi reali di
# lombardia (S3/S4), quindi almeno una provincia deve essere sopra soglia.
resp_sitemap="${tmp_dir}/sitemap.xml"
http_code_sitemap="$(curl -s -o "${resp_sitemap}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/sitemap.xml")"
[[ "${http_code_sitemap}" == "200" ]] || fail "S12: atteso 200 su /sitemap.xml, ottenuto ${http_code_sitemap}"
grep -qE '<loc>[^<]*/lombardia/[a-z0-9-]+</loc>' "${resp_sitemap}" || fail "S12: nessuna voce provincia viva sotto /lombardia/ nella sitemap"
echo "S12 OK: la sitemap contiene almeno una voce provincia viva sotto /lombardia/"

# --- S13: nessuna delle quattro province sarde abolite nel 2016 compare
# nella sitemap, a prescindere dalla soglia (D-10, garantito per costruzione
# da S11 — questa e' la controprova sul documento HTTP effettivo).
for abolished_slug in olbia-tempio ogliastra medio-campidano carbonia-iglesias; do
  grep -q "/${abolished_slug}</loc>" "${resp_sitemap}" && fail "S13: la sitemap contiene una voce per una provincia sarda abolita nel 2016 (${abolished_slug})"
done
echo "S13 OK: nessuna provincia sarda abolita nel 2016 (OT/OG/VS/CI) compare nella sitemap"

# --- S14: due generazioni consecutive della sitemap sugli stessi dati
# producono lo stesso ordine di URL regione/provincia (D-10). Confrontate
# solo le voci regione/provincia/home (escluse le voci evento: il loro
# ordine su pareggio di dateStart e' un comportamento preesistente a questo
# piano, fuori scope qui).
resp_sitemap2="${tmp_dir}/sitemap2.xml"
curl -s -o "${resp_sitemap2}" --max-time 15 "http://127.0.0.1:${port}/sitemap.xml" >/dev/null
locs1="$(grep -oE '<loc>[^<]*</loc>' "${resp_sitemap}" | grep -v '/eventi/')"
locs2="$(grep -oE '<loc>[^<]*</loc>' "${resp_sitemap2}" | grep -v '/eventi/')"
[[ "${locs1}" == "${locs2}" ]] || fail "S14: due generazioni consecutive della sitemap producono un ordine diverso di URL regione/provincia"
echo "S14 OK: due generazioni consecutive della sitemap producono lo stesso ordine di URL regione/provincia"

stop_server

echo "PASS: segnale di copertura (ROLL-03) + pagine /[regione]/[provincia] (ROLL-06) + sitemap province (ROLL-05) + indicatore di copertura /api/events (ROLL-04, Fase 15 piano 04) — S1..S21 verdi"
exit 0
