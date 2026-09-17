#!/usr/bin/env bash
# Gate ROLL-02 (Fase 15, 15-02 Task 2): transformPugliaRecords esercitata
# esclusivamente sulla fixture reale ridotta salvata in
# lib/scrapers/__fixtures__/puglia-sample.json — MAI sulla rete. L'host
# osservatorio.dms.puglia.it e' verificato irraggiungibile dal fetch nativo
# di Node per una catena di certificazione TLS incompleta lato server
# (15-RESEARCH.md Pitfall 2): un gate che dipendesse dalla rete sarebbe rosso
# per un motivo esterno a questo codice, non per un difetto della
# trasformazione che questo file prova.
#
# Il self-check vive nel modulo stesso (lib/scrapers/puglia.ts, in fondo al
# file), stesso idioma di lib/scrapers/emiliaromagna.ts — questo script si
# limita a invocarlo e a leggerne l'esito.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"

# --- Sezione 1: il self-check sulla fixture ------------------------------------
set +e
output="$(cd "${repo_root}" && npx tsx lib/scrapers/puglia.ts 2>&1)"
status=$?
set -e

echo "${output}"

section1_ok=1
if [[ ${status} -ne 0 ]] || grep -q '^FAIL:' <<<"${output}"; then
  section1_ok=0
  echo ""
  echo "FAIL: il self-check di lib/scrapers/puglia.ts non e' verde"
fi

# --- Sezione 2 (T-15-02, gate negativo su tutto il repo): nessun bypass TLS ----
# Vive anche qui (oltre che nella <verification> di piano) perche' e' dovuto
# in OGNI ramo del checkpoint di 15-02-PLAN.md, incluso quello che non scrive
# l'adattatore Puglia — se questo file esistesse ma il ramo scelto fosse stato
# `rimandare-puglia`, la minaccia T-15-02 sarebbe comunque da provare chiusa.
#
# Il pattern e' costruito per concatenazione di stringhe adiacenti (bash le
# unisce a runtime) cosi' la sequenza di caratteri completa non compare MAI
# nei byte di questo file: altrimenti questo stesso gate — e il grep
# repo-wide identico nella <verification> di 15-02-PLAN.md, che scansiona
# scripts/ senza alcuna esclusione — si auto-troverebbero come falso
# positivo, riportando questo file come se abbassasse la verifica TLS solo
# perche' la nomina per controllarne l'assenza altrove.
tls_bypass_pattern='NODE_TLS_REJECT'"_UNAUTHORIZED|reject""Unauthorized"
section2_ok=1
if grep -rqE "${tls_bypass_pattern}" \
  "${repo_root}/lib" "${repo_root}/scripts" "${repo_root}/app" \
  --include=*.ts --include=*.tsx --include=*.sh 2>/dev/null; then
  section2_ok=0
  echo ""
  echo "FAIL: un percorso del repo abbassa la verifica del certificato TLS"
else
  echo ""
  echo "ok  nessun percorso del repo abbassa la verifica del certificato TLS"
fi

if [[ ${section1_ok} -eq 1 && ${section2_ok} -eq 1 ]]; then
  echo ""
  echo "PASS: il gate dell'adattatore Puglia e' verde"
  exit 0
else
  echo ""
  echo "FAIL: il gate dell'adattatore Puglia non e' verde"
  exit 1
fi
