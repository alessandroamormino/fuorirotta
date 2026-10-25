#!/usr/bin/env bash
# Gate dei self-check puri dei follow della Fase 23 (check:follows, test:ci).
# Lancia ogni file sotto quattro fusi orari: UTC (il fuso del container in
# produzione), Roma, Tokyo e Los Angeles. Stessa forma di scripts/saved.test.sh.
#
# I file si SCOPRONO, non si elencano: ogni lib/follows/*.ts che contiene la
# guardia `require.main === module` e' un self-check. I piani successivi non
# devono toccare questo script; un modulo che perde la guardia esce dal gate
# (stesso modo di guasto che toglierlo da un elenco).
#
# Non-vacuita': un self-check che smette di girare in silenzio esce 0 senza
# stampare nulla. Per questo ogni run DEVE stampare "self-check OK", e deve
# esserci almeno un file scoperto.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"

fail() {
  echo "FAIL: $1"
  exit 1
}

cd "${repo_root}"

FILES=()
for file in lib/follows/*.ts; do
  if grep -q 'require.main === module' "${file}"; then
    FILES+=("${file}")
  fi
done
[[ "${#FILES[@]}" -ge 1 ]] || fail "nessun lib/follows/*.ts con la guardia 'require.main === module'"

runs=0
for tz in UTC Europe/Rome Asia/Tokyo America/Los_Angeles; do
  for file in "${FILES[@]}"; do
    out="$(TZ="${tz}" npx tsx "${file}" 2>&1)" || fail "${file} TZ=${tz}: exit non zero
${out}"
    grep -q "self-check OK" <<<"${out}" || fail "${file} TZ=${tz}: manca la riga 'self-check OK' (self-check non eseguito?)
${out}"
    echo "ok  ${file} TZ=${tz}"
    runs=$((runs + 1))
  done
done

echo "Riepilogo: ${runs} esecuzioni dei self-check, tutte verdi"
