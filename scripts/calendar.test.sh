#!/usr/bin/env bash
# Gate dei self-check puri della Fase 20 (calendario, condivisione, giorni
# dell'evento). Lancia ogni file sotto quattro fusi orari: UTC (il fuso del
# container in produzione), Roma, Tokyo e Los Angeles.
#
# Perche' quattro fusi: il DB locale e' nel formato di Roma (22:00Z/21:59Z),
# la produzione nel formato UTC (00:00Z/23:59:59.999Z). Un run verde in locale
# non dice nulla sul formato di produzione ("verde in locale non dice nulla"):
# la logica dei giorni deve dare lo stesso risultato in qualunque fuso del
# processo, e i self-check portano le fixture di entrambi i formati.
#
# Non-vacuita': un self-check che smette di girare in silenzio (guardia rotta,
# file svuotato) esce 0 senza stampare nulla. Per questo ogni run DEVE
# stampare la sua riga "self-check OK", altrimenti il gate fallisce.
#
# I piani successivi aggiungono qui i propri file (lib/calendar/ics.ts, ...).
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"

fail() {
  echo "FAIL: $1"
  exit 1
}

FILES=(
  lib/eventDays.ts
  lib/eventStatus.ts
  lib/calendar/ics.ts
  lib/calendar/links.ts
  lib/og/brand.ts
  lib/og/card.tsx
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

# WR-03: la route della card non legge i font con un top-level await (farebbe
# fallire l'import del modulo fuori dal catch del GET). Guardia sul sorgente:
# nessuna riga a colonna 0 con "await".
og_route="app/eventi/[id]/og/route.tsx"
[[ -f "${og_route}" ]] || fail "${og_route} non trovato (guardia WR-03)"
if grep -nE '^(const|let|var|await) .*await |^await ' "${og_route}"; then
  fail "${og_route}: top-level await (i font vanno letti dentro il try del GET)"
fi
echo "ok  ${og_route} nessun top-level await"

# WR-05: "concluso" lo calcola il server e arriva come prop (niente orologio
# nel render del client idratato, errore di idratazione). Guardia sul sorgente: la pagina
# passa eventOver, il client lo legge prima di ripiegare su isEventOver.
grep -qF 'eventOver={' "app/eventi/[id]/page.tsx" || fail "app/eventi/[id]/page.tsx non passa eventOver (guardia WR-05)"
grep -qF 'eventOver ?? isEventOver(' "app/eventi/[id]/EventDetailClient.tsx" || fail "EventDetailClient.tsx non usa eventOver prima dell'orologio (guardia WR-05)"
echo "ok  eventOver calcolato dal server (page.tsx -> EventDetailClient.tsx)"

echo "Riepilogo: ${runs} esecuzioni dei self-check, tutte verdi"
