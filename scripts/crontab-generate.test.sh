#!/usr/bin/env bash
# Gate SCHED-02 (D-09/D-12): scripts/generate-crontab.ts. NON contatta nessuna
# rete, NON legge nessun crontab reale, NON avvia server — puro come il
# generatore stesso. Sezioni:
#   S1: CRON_TZ=Europe/Rome come prima riga (D-12)
#   S2: una riga per regione, con schedule/percorso/argomento/log corretti
#   S3: la riga del job consolidato, dopo le regioni
#   S4: ordine stabile — due invocazioni identiche, ordine di dichiarazione
#   S5: --check sa fallire su una divergenza (prova di non-vacuita', D-05-style)
#   S6: una regione senza voce in REGION_SCHEDULES fa uscire il generatore
#   S7: --check su un dump illeggibile esce 2 con un messaggio, non stack trace
#       non-zero nominando lo slug — mai una riga silenziosamente omessa
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

fail() {
  echo "FAIL: $1"
  exit 1
}

tmp_dirs=()
cleanup() {
  for d in "${tmp_dirs[@]:-}"; do
    [[ -n "${d}" && -d "${d}" ]] && rm -rf "${d}"
  done
}
trap cleanup EXIT

output="$(npx tsx scripts/generate-crontab.ts)"

# --- S1: CRON_TZ=Europe/Rome come prima riga (D-12) --------------------------

first_line="$(printf '%s\n' "${output}" | head -1)"
[[ "${first_line}" == "CRON_TZ=Europe/Rome" ]] || fail "S1: prima riga attesa 'CRON_TZ=Europe/Rome', trovata '${first_line}'"
echo "ok  S1: CRON_TZ=Europe/Rome e' la prima riga"

# --- S2: una riga per regione, con schedule/percorso/argomento/log corretti --

if ! printf '%s\n' "${output}" | grep -qE '^17 3 \* \* \* /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape\.sh lombardia >> /var/log/fuorirotta-cron\.log 2>&1$'; then
  fail "S2: riga attesa per lombardia assente o mal formata"
fi
echo "ok  S2: riga per lombardia presente con schedule/percorso/argomento/log corretti"

# --- S3: la riga del job consolidato, dopo l'ultima regione ------------------

if ! printf '%s\n' "${output}" | grep -qE '^30 5 \* \* \* /opt/docker/fuori-rotta/fuorirotta/scripts/cron-maintenance\.sh >> /var/log/fuorirotta-cron\.log 2>&1$'; then
  fail "S3: riga attesa per cron-maintenance.sh assente o mal formata"
fi
last_line="$(printf '%s\n' "${output}" | grep -v '^$' | tail -1)"
[[ "${last_line}" == *"cron-maintenance.sh"* ]] || fail "S3: la riga del job consolidato non e' l'ultima riga non vuota"
echo "ok  S3: riga del job consolidato presente, pianificata dopo l'ultima regione"

# --- S4: ordine stabile -------------------------------------------------------

output2="$(npx tsx scripts/generate-crontab.ts)"
[[ "${output}" == "${output2}" ]] || fail "S4: due invocazioni consecutive producono output diverso"

region_lines="$(printf '%s\n' "${output}" | grep -E 'cron-scrape\.sh' || true)"
expected_region_order="$(npx tsx -e "import('./lib/scrapers/runner').then(m => console.log(m.getRegions().join(',')))")"
actual_region_order="$(printf '%s\n' "${region_lines}" | sed -E 's#.*cron-scrape\.sh ([a-z-]+) .*#\1#' | paste -sd, -)"
[[ "${actual_region_order}" == "${expected_region_order}" ]] || fail "S4: ordine delle righe regione (${actual_region_order}) diverso dall'ordine di dichiarazione di SOURCE_REGISTRY (${expected_region_order})"
echo "ok  S4: output byte-identico su due invocazioni, ordine righe regione = ordine di dichiarazione"

# --- S5: --check sa fallire su una divergenza (prova di non-vacuita') --------

tmp1="$(mktemp -d)"
tmp_dirs+=("${tmp1}")
printf '%s' "${output}" > "${tmp1}/identical.txt"

if ! npx tsx scripts/generate-crontab.ts --check "${tmp1}/identical.txt" > "${tmp1}/check-ok.out" 2>&1; then
  fail "S5: --check su un dump identico e' uscito non-zero: $(cat "${tmp1}/check-ok.out")"
fi
grep -q "OK: crontab installato combacia col registry" "${tmp1}/check-ok.out" || fail "S5: --check su dump identico non ha stampato il messaggio OK atteso"
echo "ok  S5a: --check su un dump identico esce 0"

printf '%s' "${output}" | sed 's/17 3 \* \* \*/0 0 \* \* \*/' > "${tmp1}/mutated.txt"
if npx tsx scripts/generate-crontab.ts --check "${tmp1}/mutated.txt" > "${tmp1}/check-fail.out" 2>&1; then
  fail "S5: --check su un dump con una riga alterata e' uscito 0 — gate vacuo"
fi
grep -q "DIVERGENZA fra registry e crontab installato" "${tmp1}/check-fail.out" || fail "S5: --check su dump alterato non ha stampato la divergenza attesa"
grep -q -- "--- installato ---" "${tmp1}/check-fail.out" || fail "S5: --check su dump alterato non ha stampato la versione installata"
grep -q -- "--- atteso (dal registry) ---" "${tmp1}/check-fail.out" || fail "S5: --check su dump alterato non ha stampato la versione attesa"
echo "ok  S5b: --check su un dump con una riga alterata esce non-zero e stampa entrambe le versioni"

# --- S6: una regione senza voce in REGION_SCHEDULES fa fallire rumorosamente -
#
# Mutazione mirata sul file reale (mai su una copia isolata: generate-crontab.ts
# risolve gli import relativi contro l'albero del repo) + revert garantito dal
# trap cleanup, stesso idioma gia' usato altrove nel progetto (14-03: "mutazione
# mirata + revert").

# REGION_SCHEDULES si e' spostato in lib/scrapers/sources.ts (modulo di soli
# metadati, senza cheerio/Prisma): la mutazione deve colpire quel file, non
# registry.ts, altrimenti non cambia nulla e il gate passa per il motivo
# sbagliato — che e' esattamente come questo gate ha scoperto lo spostamento.
registry_path="${repo_root}/lib/scrapers/sources.ts"
registry_backup_dir="$(mktemp -d)"
tmp_dirs+=("${registry_backup_dir}")
registry_backup="${registry_backup_dir}/sources.ts.orig"
cp "${registry_path}" "${registry_backup}"
restore_registry() {
  cp "${registry_backup}" "${registry_path}"
}
trap 'restore_registry; cleanup' EXIT

sed -i.bak "s/  lombardia: '17 3 \* \* \*'/  lombardia_MISSING_PLACEHOLDER: '17 3 * * *'/" "${registry_path}"
rm -f "${registry_path}.bak"

set +e
mutated_output="$(npx tsx scripts/generate-crontab.ts 2>&1)"
mutated_exit=$?
set -e

restore_registry
trap cleanup EXIT

[[ "${mutated_exit}" -ne 0 ]] || fail "S6: generatore uscito 0 con una regione senza schedule — riga silenziosamente omessa"
printf '%s' "${mutated_output}" | grep -q "lombardia" || fail "S6: il messaggio d'errore non nomina la regione senza schedule mancante"
echo "ok  S6: una regione senza voce in REGION_SCHEDULES fa fallire il generatore nominando lo slug"

# --- S7: un dump illeggibile esce 2, non con uno stack trace -----------------
#
# La procedura di rilevamento drift (DEPLOYMENT.md §"Detect drift") e' manuale e
# in due passi: `crontab -l > /tmp/...` poi `--check /tmp/...`. Un dump mai
# creato (crontab -l fallito, percorso digitato male) e' il modo piu' probabile
# in cui quel comando sbaglia, ed e' l'unico caso in cui la differenza fra
# "combacia" e "non ho potuto guardare" conta: prima usciva 1 con uno stack
# trace ENOENT di Node, indistinguibile a occhio da una divergenza reale.

missing_path="${repo_root}/.gsd-nonexistent-crontab-dump-$$"
[[ ! -e "${missing_path}" ]] || fail "S7: il percorso di prova esiste davvero, la prova non dimostrerebbe nulla"

set +e
missing_output="$(npx tsx scripts/generate-crontab.ts --check "${missing_path}" 2>&1)"
missing_exit=$?
set -e

[[ "${missing_exit}" -eq 2 ]] || fail "S7: --check su un percorso inesistente uscito ${missing_exit}, atteso 2"
printf '%s' "${missing_output}" | grep -q "Impossibile leggere" || fail "S7: nessun messaggio leggibile, probabile stack trace grezzo"
! printf '%s' "${missing_output}" | grep -q "readFileUtf8" || fail "S7: l'uscita contiene ancora lo stack trace interno di Node"
echo "ok  S7: --check su un dump illeggibile esce 2 con un messaggio, non con uno stack trace"


echo "PASS: generatore di crontab (SCHED-02), CRON_TZ in testa (D-12), ordine stabile, --check dimostrato capace di fallire (D-09)"
