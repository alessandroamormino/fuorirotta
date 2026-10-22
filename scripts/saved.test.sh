#!/usr/bin/env bash
# Gate dei self-check puri dei salvati della Fase 22 (check:saved, test:ci).
# Lancia ogni file sotto quattro fusi orari: UTC (il fuso del container in
# produzione), Roma, Tokyo e Los Angeles. Stessa forma di scripts/calendar.test.sh.
#
# Perche' quattro fusi: il DB locale e' nel formato di Roma (22:00Z/21:59Z), la
# produzione nel formato UTC (00:00Z/23:59:59.999Z). La divisione "In arrivo" /
# "Passati" deve dare lo stesso risultato in qualunque fuso del processo, e i
# self-check portano le fixture di entrambi i formati.
#
# Non-vacuita': un self-check che smette di girare in silenzio (guardia rotta,
# file svuotato) esce 0 senza stampare nulla. Per questo ogni run DEVE
# stampare la sua riga "self-check OK", altrimenti il gate fallisce.
#
# I piani successivi della Fase 22 aggiungono qui i propri file puri.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"

fail() {
  echo "FAIL: $1"
  exit 1
}

FILES=(
  lib/saved/snapshot.ts
  lib/saved/view.ts
  lib/saved/series.ts
)

cd "${repo_root}"

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
