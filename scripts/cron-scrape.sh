#!/usr/bin/env bash
# Wrapper di cron indurito per /api/cron/scrape.
#
# Legge CRON_SECRET e NEXT_PUBLIC_APP_URL da .env (rimuovendo eventuali
# apici), esegue la POST autenticata, fallisce rumorosamente su qualsiasi
# risposta non-2xx e notifica un dead man's switch esterno solo su successo.
#
# Exit code: 0 su 2xx, 1 su qualsiasi altro codice HTTP, 2 su errore di
# configurazione (file .env assente o variabile obbligatoria mancante).
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" >/dev/null 2>&1 && pwd -P)"
root_dir="$(dirname -- "${script_dir}")"
env_file="${ENV_FILE:-${root_dir}/.env}"

if [[ ! -f "${env_file}" ]]; then
  echo "cron-scrape: file di configurazione non trovato: ${env_file}" >&2
  exit 2
fi

# Legge la prima riga "NOME=..." dal file di configurazione e restituisce
# il valore con eventuali apici singoli/doppi e CR finale rimossi. Un .env
# di produzione scritto con il segreto fra doppi apici deve produrre lo
# stesso valore di uno scritto nudo: la rimozione degli apici non e'
# cosmetica, e' cio' che tiene sincronizzati script e `docker compose`.
read_env_var() {
  local name="$1"
  local line value
  line="$(grep -m1 "^${name}=" "${env_file}" 2>/dev/null || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  case "${value}" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "${value}"
}

cron_secret="$(read_env_var CRON_SECRET)"
app_url="$(read_env_var NEXT_PUBLIC_APP_URL)"
healthcheck_url="$(read_env_var HEALTHCHECK_URL)"

if [[ -z "${cron_secret}" ]]; then
  echo "cron-scrape: variabile obbligatoria CRON_SECRET assente o vuota in ${env_file}" >&2
  exit 2
fi

if [[ -z "${app_url}" ]]; then
  echo "cron-scrape: variabile obbligatoria NEXT_PUBLIC_APP_URL assente o vuota in ${env_file}" >&2
  exit 2
fi

target_url="${app_url%/}/api/cron/scrape"

# ponytail: il segreto passa come argomento a curl ed e' quindi visibile in
# `ps` a chiunque abbia accesso locale alla shell. Accettato: il box e' a
# utente singolo (root). Percorso di aggiornamento se un giorno servisse:
# passare l'header via `curl -K -` leggendo da stdin invece che da argv.
http_code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 \
  -X POST \
  -H "Authorization: Bearer ${cron_secret}" \
  "${target_url}") || http_code="000"

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if [[ "${http_code}" =~ ^2[0-9][0-9]$ ]]; then
  status_word="ok"
else
  status_word="FAILED"
fi

echo "${timestamp} cron-scrape http_code=${http_code} ${status_word}"

if [[ "${status_word}" == "ok" ]]; then
  if [[ -n "${healthcheck_url}" ]]; then
    if curl -sS -f --max-time 10 --retry 3 "${healthcheck_url}" >/dev/null 2>&1; then
      echo "healthcheck=pinged"
    else
      echo "healthcheck=ping-failed"
    fi
  else
    echo "healthcheck=disabled (WARNING: nessun allarme configurato, un cron morto non verra' segnalato)"
  fi
  exit 0
else
  exit 1
fi
