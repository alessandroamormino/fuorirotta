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
#   S8: righe estranee fuori dal blocco gestito non fanno divergenza
#   S9: blocco assente -> messaggio utile e blocco da incollare
#       non-zero nominando lo slug — mai una riga silenziosamente omessa
#   S10: aggiungere una sorgente a una regione gia' pianificata (Fase 19,
#        altoadige su trentino-alto-adige) non aggiunge una riga di
#        crontab — la riga resta esattamente una, all'orario di Fase 15
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

# --- S1: intestazione che dichiara UTC, e NESSUN CRON_TZ (D-12 rivisto) ------
#
# La prima stesura asseriva `CRON_TZ=Europe/Rome` come prima riga. L'Assumption
# A2 di 14-RESEARCH.md e' stata verificata contro l'host reale il 2026-09-15 ed
# e' FALSA: cron 3.0pl1-184ubuntu2 non conosce CRON_TZ (ne' `strings
# /usr/sbin/cron` ne' `man 5 crontab` lo nominano). Il gate ora asserisce
# l'opposto: che quella riga NON venga emessa, e che il fuso sia dichiarato in
# chiaro in un commento — un crontab che si autodescrive, invece di una riga
# decorativa che il cron ignora.

first_line="$(printf '%s\n' "${output}" | head -1)"
[[ "${first_line}" == \#* ]] || fail "S1: prima riga attesa come commento, trovata '${first_line}'"
# Ancorato a inizio riga: l'ASSEGNAZIONE e' vietata, nominarlo in un commento
# e' anzi cio' che spiega al lettore perche' non c'e'.
printf '%s' "${output}" | grep -qE '^CRON_TZ=' && fail "S1: il crontab assegna CRON_TZ, che questo host ignora — sarebbe una promessa falsa"
printf '%s' "${output}" | grep -q 'ORARI IN UTC' || fail "S1: l'intestazione non dichiara che gli orari sono in UTC"
echo "ok  S1: intestazione dichiara UTC, nessun CRON_TZ emesso"

# --- S2: una riga per regione, con schedule/percorso/argomento/log corretti --

if ! printf '%s\n' "${output}" | grep -qE '^17 3 \* \* \* /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape\.sh lombardia >> /var/log/fuorirotta-cron\.log 2>&1$'; then
  fail "S2: riga attesa per lombardia assente o mal formata"
fi
echo "ok  S2: riga per lombardia presente con schedule/percorso/argomento/log corretti"

# --- S3: la riga del job consolidato, dopo l'ultima regione ------------------

if ! printf '%s\n' "${output}" | grep -qE '^0 11 \* \* \* /opt/docker/fuori-rotta/fuorirotta/scripts/cron-maintenance\.sh >> /var/log/fuorirotta-cron\.log 2>&1$'; then
  fail "S3: riga attesa per cron-maintenance.sh assente o mal formata"
fi
# Ultima riga di CRON (non l'ultima riga in assoluto: da quando il generatore
# possiede un blocco delimitato, l'ultima e' il marcatore di chiusura). Si
# filtrano i commenti e le righe vuote, restano solo le voci pianificate.
last_cron_line="$(printf '%s\n' "${output}" | grep -vE '^\s*(#|$)' | tail -1)"
[[ "${last_cron_line}" == *"cron-maintenance.sh"* ]] || fail "S3: la riga del job consolidato non e' l'ultima voce pianificata del blocco"
echo "ok  S3: riga del job consolidato presente, pianificata dopo l'ultima regione"

# --- S4: ordine stabile -------------------------------------------------------

output2="$(npx tsx scripts/generate-crontab.ts)"
[[ "${output}" == "${output2}" ]] || fail "S4: due invocazioni consecutive producono output diverso"

region_lines="$(printf '%s\n' "${output}" | grep -E 'cron-scrape\.sh' || true)"
# Node 20 (i runner di CI e i container node:20-alpine del server) NON
# riconosce gli export nominati dei moduli che tsx compila in CommonJS: il
# namespace di `await import()` porta il solo `default`. Node 24, quello di
# sviluppo, li espone entrambi. Da qui `m.default ?? m`, che e' corretto su
# tutte e due — misurato il 2026-09-20, dopo che la CI ha fatto cadere questo
# gate su Ubuntu mentre sul Mac era verde.
expected_region_order="$(npx tsx -e "import('./lib/scrapers/runner').then(mod => { const m = mod.default ?? mod; console.log(m.getRegions().join(',')) })")"
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
grep -q "OK: blocco gestito nel crontab combacia col registry" "${tmp1}/check-ok.out" || fail "S5: --check su dump identico non ha stampato il messaggio OK atteso"
echo "ok  S5a: --check su un dump identico esce 0"

printf '%s' "${output}" | sed 's/17 3 \* \* \*/0 0 \* \* \*/' > "${tmp1}/mutated.txt"
if npx tsx scripts/generate-crontab.ts --check "${tmp1}/mutated.txt" > "${tmp1}/check-fail.out" 2>&1; then
  fail "S5: --check su un dump con una riga alterata e' uscito 0 — gate vacuo"
fi
grep -q "DIVERGENZA fra registry e blocco installato" "${tmp1}/check-fail.out" || fail "S5: --check su dump alterato non ha stampato la divergenza attesa"
grep -q -- "--- installato (solo il blocco gestito) ---" "${tmp1}/check-fail.out" || fail "S5: --check su dump alterato non ha stampato la versione installata"
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


# --- S8: righe estranee fuori dal blocco non fanno divergenza ----------------
#
# Il crontab dell'host reale contiene anche il rinnovo certbot di
# fuori-rotta.it, che ricarica nginx. La prima stesura generava e confrontava il
# crontab INTERO: --check avrebbe segnalato divergenza per sempre, e la
# procedura documentata ("sostituisci il crontab con questo output") avrebbe
# cancellato quel rinnovo — sito giu' settimane dopo, senza un indizio.
# Qui si prova che il confronto guarda SOLO il blocco fra i marcatori.

tmp8="$(mktemp -d)"
tmp_dirs+=("${tmp8}")
foreign_line='0 3 * * * certbot renew --quiet && docker exec nginx nginx -s reload'

{
  echo "# commento di sistema che non ci appartiene"
  echo "${foreign_line}"
  echo ""
  npx tsx scripts/generate-crontab.ts
  echo ""
  echo '0 7 * * * /usr/local/bin/qualcos-altro.sh'
} > "${tmp8}/con-estranee.txt"

if ! npx tsx scripts/generate-crontab.ts --check "${tmp8}/con-estranee.txt" > "${tmp8}/s8.out" 2>&1; then
  cat "${tmp8}/s8.out" >&2
  fail "S8: --check ha segnalato divergenza per righe ESTRANEE al blocco gestito"
fi
grep -q 'blocco gestito' "${tmp8}/s8.out" || fail "S8: messaggio di successo non menziona il blocco gestito"
echo "ok  S8: righe estranee fuori dal blocco sono ignorate dal confronto"

# --- S9: blocco assente -> messaggio utile, non divergenza muta --------------
#
# Prima installazione: il crontab non ha ancora i marcatori. Deve dirlo e
# stampare il blocco da incollare, avvisando di non toccare il resto.

{
  echo "${foreign_line}"
} > "${tmp8}/senza-blocco.txt"

set +e
npx tsx scripts/generate-crontab.ts --check "${tmp8}/senza-blocco.txt" > "${tmp8}/s9.out" 2>&1
s9_exit=$?
set -e

[[ "${s9_exit}" -ne 0 ]] || fail "S9: --check uscito 0 con il blocco gestito assente"
grep -q 'Blocco gestito non trovato' "${tmp8}/s9.out" || fail "S9: non spiega che il blocco manca"
grep -q 'SENZA toccare le altre righe' "${tmp8}/s9.out" || fail "S9: non avverte di non toccare le altre righe del crontab"
echo "ok  S9: blocco assente -> spiegazione e blocco da incollare, con l'avvertenza"



# --- S10: aggiungere una sorgente a una regione gia' pianificata NON aggiunge
# una riga di crontab (Fase 19, D-08/19-CONTEXT.md) ---------------------------
#
# La sorgente 'altoadige' (19-01-PLAN.md) dichiara region: 'trentino-alto-adige',
# uno slug che lib/scrapers/regionSlug.ts gia' produceva e che REGION_SCHEDULES
# gia' pianificava dalla Fase 15 (lombardia era gia' su piu' sorgenti nello
# stesso modo). L'unita' schedulabile e' la REGIONE, non la sorgente: due
# sorgenti sulla stessa regione condividono la stessa riga, mai due righe a
# orari diversi che produrrebbero due scrape della stessa regione. Ancorata a
# inizio riga su una cifra, cosi' nessuna riga di commento del blocco (tutte
# iniziano per '#') puo' entrare nel conteggio.
trentino_lines="$(printf '%s\n' "${output}" | grep -cE '^[0-9].*cron-scrape\.sh trentino-alto-adige ' || true)"
[[ "${trentino_lines}" -eq 1 ]] || fail "S10: attesa esattamente 1 riga di scrape per trentino-alto-adige, trovate ${trentino_lines}"
printf '%s\n' "${output}" | grep -qE '^5 4 \* \* \* /opt/docker/fuori-rotta/fuorirotta/scripts/cron-scrape\.sh trentino-alto-adige >> /var/log/fuorirotta-cron\.log 2>&1$' \
  || fail "S10: la riga di trentino-alto-adige non porta l'orario 5 4 * * * assegnato dalla Fase 15"
echo "ok  S10: aggiungere altoadige a trentino-alto-adige non ha aggiunto righe di crontab — esattamente 1 riga, orario 5 4 * * * invariato"

echo "PASS: generatore di crontab (SCHED-02), fuso dichiarato in chiaro (D-12 rivisto), ordine stabile, --check dimostrato capace di fallire (D-09), una sorgente in piu' su una regione esistente non duplica la riga (Fase 19)"
