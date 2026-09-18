#!/usr/bin/env bash
# Gate D-13/WR-01: il job di manutenzione (scripts/maintenance-job.ts) prende
# il lock di OGNI regione viva, in ordine deterministico, prima di iniziare
# backfill/dedup; se anche un solo lock e' occupato rilascia quelli gia' presi
# ed esce con errore, senza aver toccato backfill ne' dedup.
#
# A differenza di scripts/region-lock.test.sh non usa uno slug di prova
# dedicato: il job stesso decide quali regioni bloccare leggendo
# getLiveRegions() (il segnale di copertura sui dati REALI del Postgres
# locale), non un parametro di test — non c'e' un secondo modo di farlo
# entrare in un percorso isolato senza duplicare la logica che il gate deve
# provare. Richiede il Postgres locale (scripts/dev-db.sh, D-17) — mai il
# database di produzione.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

fail() {
  echo "FAIL: $1"
  exit 1
}

psql_dev() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}

if ! docker compose -f "${repo_root}/docker-compose.dev.yml" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

cleanup() {
  if [[ -n "${LOCK_TEST_REGION:-}" ]]; then
    psql_dev "DELETE FROM region_locks WHERE region = '${LOCK_TEST_REGION}'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# --- Regioni vive reali, stesso segnale che il job stesso legge -----------
get_live_regions() {
  bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getLiveRegions } = await import("./lib/coverage/liveRegions")
  const regions = Array.from(await getLiveRegions()).sort()
  console.log(regions.join(","))
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null
}

live_regions_csv="$(get_live_regions)"
[[ -n "${live_regions_csv}" ]] || fail "getLiveRegions() non ha restituito alcuna regione viva sul Postgres locale — il gate non puo' provare il comportamento senza almeno una regione viva"

IFS=',' read -r -a live_regions <<< "${live_regions_csv}"
region_count="${#live_regions[@]}"
last_idx=$((region_count - 1))
# Ultima regione in ordine alfabetico: il job la acquisisce PER ULTIMA, cosi'
# pre-occuparla prova sia l'acquisizione parziale sia il rollback in ordine
# inverso, non solo il fallimento immediato al primo tentativo.
contention_region="${live_regions[${last_idx}]}"

echo "Regioni vive osservate: ${live_regions_csv} (contesa su: ${contention_region})"

# Stato pulito prima di iniziare, nel caso una run precedente sia rimasta a meta'.
for r in "${live_regions[@]}"; do
  psql_dev "DELETE FROM region_locks WHERE region = '${r}'" >/dev/null 2>&1 || true
done

# --- S1: con tutti i lock liberi, il job gira e scrive la propria riga -----
before_ok="$(psql_dev "SELECT count(*) FROM scrape_runs WHERE source = 'maintenance' AND error IS NULL")"

s1_exit=0
bash scripts/dev-db.sh npx tsx scripts/maintenance-job.ts >/dev/null 2>&1 || s1_exit=$?
[[ "${s1_exit}" -eq 0 ]] || fail "S1: il job con tutti i lock liberi e' uscito con codice ${s1_exit}, atteso 0"

after_ok="$(psql_dev "SELECT count(*) FROM scrape_runs WHERE source = 'maintenance' AND error IS NULL")"
[[ "${after_ok}" -gt "${before_ok}" ]] || fail "S1: nessuna nuova riga scrape_runs con error IS NULL dopo un'esecuzione riuscita"

for r in "${live_regions[@]}"; do
  remaining="$(psql_dev "SELECT count(*) FROM region_locks WHERE region = '${r}'")"
  [[ "${remaining}" == "0" ]] || fail "S1: lock ancora presente per la regione viva '${r}' dopo un'esecuzione riuscita della manutenzione"
done
echo "S1 OK: con tutti i lock liberi il job gira, scrive scrape_runs senza errore, e non trattiene alcun lock a fine esecuzione"

# --- S2: con un lock gia' occupato, il job esce diverso da zero, rilascia --
# tutto cio' che aveva gia' preso, e non lascia lock propri in tabella -----
export LOCK_TEST_REGION="${contention_region}"

acquire_test_lock() {
  bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { acquireRegionLock } = await import("./lib/scrapers/regionLock")
  const ok = await acquireRegionLock(process.env.LOCK_TEST_REGION as string)
  console.log(ok ? "true" : "false")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null
}

release_test_lock() {
  bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { releaseRegionLock } = await import("./lib/scrapers/regionLock")
  await releaseRegionLock(process.env.LOCK_TEST_REGION as string)
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null
}

s2_pre_acquire="$(acquire_test_lock)"
[[ "${s2_pre_acquire}" == "true" ]] || fail "S2 setup: impossibile pre-occupare il lock su '${contention_region}' come farebbe un altro processo (risultato: '${s2_pre_acquire}')"

before_err="$(psql_dev "SELECT count(*) FROM scrape_runs WHERE source = 'maintenance' AND error IS NOT NULL")"

s2_exit=0
bash scripts/dev-db.sh npx tsx scripts/maintenance-job.ts >/dev/null 2>&1 || s2_exit=$?
[[ "${s2_exit}" -ne 0 ]] || fail "S2: il job con un lock occupato e' uscito con codice 0, atteso diverso da zero"

after_err="$(psql_dev "SELECT count(*) FROM scrape_runs WHERE source = 'maintenance' AND error IS NOT NULL")"
[[ "${after_err}" -gt "${before_err}" ]] || fail "S2: nessuna nuova riga scrape_runs con errore dopo un fallimento di acquisizione lock"

# Il job non deve aver lasciato lock propri: l'unico lock ammesso in tabella
# a questo punto e' quello che QUESTO test ha preso prima del job, sulla
# regione contesa. Qualunque altra regione viva bloccata sarebbe un lock che
# il job ha acquisito e non rilasciato durante il rollback.
for r in "${live_regions[@]}"; do
  if [[ "${r}" == "${contention_region}" ]]; then
    continue
  fi
  leftover="$(psql_dev "SELECT count(*) FROM region_locks WHERE region = '${r}'")"
  [[ "${leftover}" == "0" ]] || fail "S2: il job ha lasciato un lock sulla regione '${r}' dopo un fallimento di acquisizione — il rollback non ha rilasciato tutto cio' che aveva gia' preso"
done
echo "S2 OK: con un lock gia' occupato il job esce diverso da zero, scrive scrape_runs con l'errore, e rilascia in ordine inverso tutti i lock gia' presi"

release_test_lock >/dev/null

echo "PASS: lock di manutenzione (D-13/WR-01) — S1..S2 verdi"
exit 0
