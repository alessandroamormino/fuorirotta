#!/usr/bin/env bash
# Allarme giornaliero sulla salute delle SORGENTI, dopo gli scrape notturni.
#
# Perche' esiste: il dead man's switch di cron-scrape.sh (HEALTHCHECK_URL)
# dice solo che il cron e' PARTITO — /api/cron/scrape risponde 202 e lavora
# in background — ed e' condiviso da venti regioni. Una sorgente morta non lo
# fa mai diventare rosso: Puglia e' rimasta giu' per settimane cosi', e il
# 2026-10-16 roma era 'failed' con 0 eventi senza che niente suonasse.
#
# Cosa fa: chiede /api/monitoring al container (127.0.0.1, non internet),
# legge il riepilogo gia' calcolato dall'app (summarizeHealth, in
# lib/scrapers/health.ts) e pinga HEALTHCHECK_SOURCES_URL:
#   - tutto sano -> ping di successo;
#   - una o piu' sorgenti fallite o degradate -> /fail, con l'elenco nel
#     corpo del ping: healthchecks.io lo riporta nella mail ("roma (lazio):
#     fallita — fetch failed"), non solo "DOWN".
# Il check va creato con periodo 1 giorno: avvisa anche se questo controllo
# smette di girare.
#
# Gira sull'host: solo curl e il node dell'host (Node 18, nessuna dipendenza).
set -uo pipefail

root_dir="${FUORIROTTA_ROOT:-/opt/docker/fuori-rotta/fuorirotta}"
monitoring_url="${FUORIROTTA_MONITORING_URL:-http://127.0.0.1:3000/api/monitoring}"
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

hc_url="$(grep -m1 '^HEALTHCHECK_SOURCES_URL=' "${root_dir}/.env" 2>/dev/null | cut -d= -f2- | tr -d "\"'" || true)"

ping_hc() { # $1: suffisso ("" o "/fail"), $2: corpo
  [[ -z "${hc_url}" ]] && { echo "${ts} cron-health healthcheck=disabled (WARNING: HEALTHCHECK_SOURCES_URL assente, nessun allarme)"; return; }
  curl -fsS --max-time 10 --retry 3 --data-raw "$2" "${hc_url}$1" >/dev/null 2>&1 \
    && echo "${ts} cron-health healthcheck=pinged" \
    || echo "${ts} cron-health healthcheck=ping-failed"
}

if ! json="$(curl -fsS --max-time 30 "${monitoring_url}")"; then
  echo "${ts} cron-health status=FAILED (/api/monitoring non risponde)"
  ping_hc /fail "/api/monitoring non risponde: il sito o il database potrebbero essere giu'"
  exit 1
fi

report="$(printf '%s' "${json}" | node -e '
let d = "";
process.stdin.on("data", c => (d += c)).on("end", () => {
  const s = JSON.parse(d).summary;
  if (!s) { console.log("risposta di /api/monitoring senza summary"); process.exit(2); }
  console.log(s.problems.join("\n"));
  process.exit(s.ok ? 0 : 1);
});')"
code=$?

if [[ ${code} -eq 0 ]]; then
  echo "${ts} cron-health status=ok"
  ping_hc "" "tutte le sorgenti sane"
else
  echo "${ts} cron-health status=FAILED"
  printf '%s\n' "${report}" | sed "s/^/${ts} cron-health   /"
  ping_hc /fail "${report}"
  exit 1
fi
