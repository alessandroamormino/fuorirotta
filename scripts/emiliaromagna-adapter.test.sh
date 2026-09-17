#!/usr/bin/env bash
# Gate ROLL-01 (Fase 15, 15-02 Task 1): transformEmiliaRomagnaRecords esercitata
# esclusivamente sulla fixture reale salvata in
# lib/scrapers/__fixtures__/emiliaromagna-events.json — MAI sulla rete.
# L'endpoint emiliaromagnaturismo.it/opendata/v1/events e' verificato
# intermittente in 15-RESEARCH.md (Pitfall 3): un gate che a volte fallisce
# senza alcun cambio di codice sarebbe un gate rotto per costruzione.
#
# Il self-check vive nel modulo stesso (lib/scrapers/emiliaromagna.ts, in
# fondo al file), stesso idioma di lib/dedup/normalizeTitle.ts e
# lib/territorial/resolve.ts (scripts/dedup.test.sh Sezione 2) — questo script
# si limita a invocarlo e a leggerne l'esito.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"

# set +e attorno alla chiamata: sotto `set -e` un'assegnazione il cui comando
# fallisce farebbe uscire lo script qui, prima di poter leggere status/output
# e stampare il riepilogo — esattamente il caso RED che questo gate deve
# poter osservare senza abortire.
set +e
output="$(cd "${repo_root}" && npx tsx lib/scrapers/emiliaromagna.ts 2>&1)"
status=$?
set -e

echo "${output}"

if [[ ${status} -ne 0 ]] || grep -q '^FAIL:' <<<"${output}"; then
  echo ""
  echo "FAIL: il self-check di lib/scrapers/emiliaromagna.ts non e' verde"
  exit 1
fi

echo ""
echo "PASS: il self-check di lib/scrapers/emiliaromagna.ts e' verde"
exit 0
