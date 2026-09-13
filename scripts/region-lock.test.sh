#!/usr/bin/env bash
# Gate SCHED-03 (D-13): lock per regione — acquisizione atomica, concorrenza
# reale, rilascio, scadenza. Prova lib/scrapers/regionLock.ts DIRETTAMENTE
# (nessun server HTTP): l'acquisizione/il rilascio sono funzioni di libreria,
# non passano per la route cron. Il cablaggio della route/CLI e' provato dalla
# sezione S8 di scripts/region-scoping.test.sh, non qui.
#
# Usa uno slug di prova dedicato (__test_region__) assente dal registry, cosi'
# non puo' mai interferire con dati reali. Richiede il Postgres locale
# (scripts/dev-db.sh, D-17) — mai il database di produzione.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

test_region="__test_region__"
export LOCK_TEST_REGION="${test_region}"

fail() {
  echo "FAIL: $1"
  exit 1
}

psql_dev() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}

cleanup() {
  psql_dev "DELETE FROM region_locks WHERE region = '${test_region}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker compose -f "${repo_root}/docker-compose.dev.yml" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Stato pulito prima di iniziare, nel caso una run precedente sia rimasta a meta'.
cleanup

acquire_once() {
  bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { acquireRegionLock } = await import("./lib/scrapers/regionLock")
  const ok = await acquireRegionLock(process.env.LOCK_TEST_REGION as string)
  console.log(ok ? "true" : "false")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null
}

release_once() {
  bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { releaseRegionLock } = await import("./lib/scrapers/regionLock")
  await releaseRegionLock(process.env.LOCK_TEST_REGION as string)
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null
}

# --- S1: su regione libera, acquireRegionLock restituisce true -------------
s1_result="$(acquire_once)"
[[ "${s1_result}" == "true" ]] || fail "S1: acquireRegionLock su regione libera ha restituito '${s1_result}', atteso 'true'"
s1_row_future="$(psql_dev "SELECT (expires_at > now()) FROM region_locks WHERE region = '${test_region}'")"
[[ "${s1_row_future}" == "t" ]] || fail "S1: la riga region_locks non ha expires_at > now() dopo l'acquisizione"
echo "S1 OK: acquireRegionLock su regione libera restituisce true, riga presente con expires_at > now()"

# --- S2: subito dopo, una seconda acquireRegionLock restituisce false ------
s2_result="$(acquire_once)"
[[ "${s2_result}" == "false" ]] || fail "S2: seconda acquireRegionLock sulla stessa regione gia' occupata ha restituito '${s2_result}', atteso 'false'"
echo "S2 OK: seconda acquireRegionLock sulla stessa regione gia' occupata restituisce false"

# --- S3: dopo releaseRegionLock, la riga sparisce e una nuova acquisizione riesce
release_once >/dev/null
s3_count_after_release="$(psql_dev "SELECT count(*) FROM region_locks WHERE region = '${test_region}'")"
[[ "${s3_count_after_release}" == "0" ]] || fail "S3: dopo releaseRegionLock la riga esiste ancora (count=${s3_count_after_release})"
s3_result="$(acquire_once)"
[[ "${s3_result}" == "true" ]] || fail "S3: acquireRegionLock dopo il rilascio ha restituito '${s3_result}', atteso 'true'"
echo "S3 OK: releaseRegionLock rimuove la riga, una nuova acquisizione riesce"

# --- S4: expires_at forzato nel passato -> l'acquisizione successiva riesce e riscrive
psql_dev "UPDATE region_locks SET locked_at = now() - interval '3 hours', expires_at = now() - interval '1 hour' WHERE region = '${test_region}'" >/dev/null
s4_result="$(acquire_once)"
[[ "${s4_result}" == "true" ]] || fail "S4: acquireRegionLock su un lock scaduto ha restituito '${s4_result}', atteso 'true'"
s4_row_future="$(psql_dev "SELECT (expires_at > now() AND locked_at > now() - interval '1 minute') FROM region_locks WHERE region = '${test_region}'")"
[[ "${s4_row_future}" == "t" ]] || fail "S4: dopo la riacquisizione locked_at/expires_at non sono stati riscritti a valori futuri/recenti"
echo "S4 OK: un lock scaduto non blocca, l'acquisizione successiva riscrive locked_at/expires_at"

# --- S5: concorrenza reale — due processi separati, esattamente un vincitore, >=5 round
release_once >/dev/null
rounds=5
for i in $(seq 1 "${rounds}"); do
  psql_dev "DELETE FROM region_locks WHERE region = '${test_region}'" >/dev/null
  out_a="$(mktemp)"
  out_b="$(mktemp)"
  acquire_once > "${out_a}" &
  pid_a=$!
  acquire_once > "${out_b}" &
  pid_b=$!
  wait "${pid_a}"
  wait "${pid_b}"
  res_a="$(cat "${out_a}")"
  res_b="$(cat "${out_b}")"
  rm -f "${out_a}" "${out_b}"

  wins=0
  [[ "${res_a}" == "true" ]] && wins=$((wins + 1))
  [[ "${res_b}" == "true" ]] && wins=$((wins + 1))
  [[ "${wins}" -eq 1 ]] || fail "S5 round ${i}: vincitori=${wins} (attesi 1). Processo A='${res_a}', Processo B='${res_b}'"
  echo "S5 round ${i} OK: esattamente un vincitore (A='${res_a}', B='${res_b}')"
done
echo "S5 OK: ${rounds}/${rounds} round di acquisizione concorrente reale, sempre esattamente un vincitore"

echo "PASS: lock per regione (SCHED-03, D-13) — S1..S5 verdi"
exit 0
