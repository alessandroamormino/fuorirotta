#!/usr/bin/env bash
# Gate WR-02 (Fase 15 review): getSourceById(id, region?) e il ramo CLI di
# lib/scrapers/runner.ts che decide se un source id ambiguo puo' girare senza
# --region. Dopo SRC-04, 'solosagre' e' condiviso da 20 entry (una per
# regione): senza questo gate una regressione che tornasse a risolvere
# sempre alla prima entry dichiarata (Lombardia) sarebbe silenziosa — nessun
# altro script referenzia getSourceById.
#
# Nessuna rete, nessuna scrittura: getSourceById e' un lookup puro sul
# registry gia' costruito in memoria. Il ramo CLI (S3) importa lib/prisma ma
# non lo interroga mai prima di uscire sul controllo di ambiguita' — passa
# comunque per scripts/dev-db.sh per coerenza con la convenzione del progetto
# (mai un URL di produzione anche solo istanziato).
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

fail() {
  echo "FAIL: $1"
  exit 1
}

# --- S1: getSourceById('solosagre') senza region — contratto attuale: torna -
# la PRIMA entry dichiarata (Lombardia), non undefined e non una regione a
# caso. Se questo cambiasse silenziosamente, il ramo CLI perderebbe la sua
# unica via di fallback documentata (vedi commento su getSourceById in
# lib/scrapers/registry.ts).
s1_result="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getSourceById } = await import("./lib/scrapers/registry")
  const entry = getSourceById("solosagre")
  console.log(entry ? entry.region : "undefined")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null)"
[[ "${s1_result}" == "lombardia" ]] || fail "S1: getSourceById('solosagre') senza region ha restituito '${s1_result}', atteso 'lombardia' (prima entry dichiarata, contratto attuale)"
echo "ok  S1: getSourceById('solosagre') senza region torna la prima entry dichiarata (lombardia)"

# --- S2: getSourceById('solosagre', '<altra regione>') torna QUELLA regione -
s2_result="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { getSourceById } = await import("./lib/scrapers/registry")
  const entry = getSourceById("solosagre", "abruzzo")
  console.log(entry ? entry.region : "undefined")
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null)"
[[ "${s2_result}" == "abruzzo" ]] || fail "S2: getSourceById('solosagre', 'abruzzo') ha restituito '${s2_result}', atteso 'abruzzo'"
echo "ok  S2: getSourceById('solosagre', 'abruzzo') torna l'entry di quella regione, non quella di default"

# --- S3: il ramo CLI di runner.ts rifiuta un source ambiguo senza --region --
# invece di girare silenziosamente su Lombardia. Deve uscire diverso da zero
# e nominare piu' di una regione nel messaggio.
s3_exit=0
s3_output="$(bash scripts/dev-db.sh npx tsx lib/scrapers/runner.ts solosagre 2>&1)" || s3_exit=$?
[[ "${s3_exit}" -ne 0 ]] || fail "S3: 'npx tsx lib/scrapers/runner.ts solosagre' (senza --region) e' uscito con codice 0 — un source ambiguo non deve girare in silenzio su una regione a caso"
echo "${s3_output}" | grep -qi "region" || fail "S3: il messaggio di errore non nomina la necessita' di --region (output: ${s3_output})"
echo "${s3_output}" | grep -q "lombardia" || fail "S3: il messaggio di errore non elenca 'lombardia' fra le regioni ambigue (output: ${s3_output})"
echo "ok  S3: 'solosagre' senza --region esce diverso da zero e nomina le regioni ambigue invece di girare su Lombardia"

# --- S4: con --region esplicito ma NON ambiguo (una regione dichiarata che
# non ha 'solosagre'), il ramo CLI passa dal controllo di ambiguita' (matches
# > 1 ma regionSlug presente, quindi nessun rifiuto) fino a getSourceById(id,
# region), che qui non trova nulla per quella combinazione — messaggio
# distinto da S3 ("nessuna sorgente per la regione", non "specifica
# --region"), a riprova che il --region passato viene davvero usato per
# disambiguare invece di essere ignorato. Nessuno scrape reale viene innescato
# (fallisce prima), quindi il test resta rapido e senza rete.
s4_exit=0
s4_output="$(bash scripts/dev-db.sh npx tsx lib/scrapers/runner.ts solosagre --region regione-inesistente 2>&1)" || s4_exit=$?
[[ "${s4_exit}" -ne 0 ]] || fail "S4: 'solosagre --region regione-inesistente' e' uscito con codice 0"
echo "${s4_output}" | grep -qi "nessuna sorgente" || fail "S4: il messaggio non segnala l'assenza di una sorgente per quella regione — non e' provato che --region sia stato passato a getSourceById (output: ${s4_output})"
echo "ok  S4: --region viene passato davvero a getSourceById (regione inesistente -> 'nessuna sorgente', non l'errore generico di ambiguita' di S3)"

echo "PASS: disambiguazione delle sorgenti condivise (WR-02, Fase 15 review) — S1..S4 verdi"
exit 0
