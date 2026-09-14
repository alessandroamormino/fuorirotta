#!/usr/bin/env bash
# Wrapper di cron per il job di manutenzione consolidato
# (scripts/maintenance-job.ts): aggancio territoriale + dedup + cache dei
# cluster, una volta al giorno (D-05/D-06/D-07).
#
# A differenza di scripts/cron-scrape.sh non passa da HTTP: non c'e' nessuna
# route da autenticare, quindi non legge il segreto del cron ne'
# NEXT_PUBLIC_APP_URL.
#
# DEVIAZIONE da 14-03-PLAN.md (documentata in 14-03-SUMMARY.md, Rule 4):
# il piano prescriveva `docker compose exec -T <servizio> npx tsx
# scripts/maintenance-job.ts`, eseguendo il job DENTRO il container. Lo
# stage finale del Dockerfile ("runner") copia solo .next/standalone,
# .next/static, node_modules/.prisma e prisma/ — non scripts/ ne' lib/ ne'
# le devDependencies che tsx richiede per importare TypeScript grezzo: quel
# comando fallirebbe subito con "file non trovato". Il progetto ha gia' la
# regola "script fuori dall'immagine" per le operazioni di manutenzione sul
# database (vedi DEPLOYMENT.md §Migrations, `npx prisma migrate deploy`
# gira sul checkout host, mai dentro il container). Questo script segue la
# stessa regola: esegue npx tsx direttamente sul checkout host (lo stesso
# git checkout da cui gira `docker compose`, DEPLOYMENT.md
# §"Architecture Overview"), leggendo DATABASE_URL dallo stesso .env che
# la Fase 5/8 gia' usa per il container, invece che via docker exec.
#
# Legge DATABASE_URL e HEALTHCHECK_MAINTENANCE_URL da .env (rimuovendo
# eventuali apici e commenti inline, stesso parsing di cron-scrape.sh —
# read_env_var non e' reimplementata diversamente), fallisce rumorosamente
# su qualsiasi uscita non-zero del job e notifica un secondo dead man's
# switch esterno solo su successo (D-06: HEALTHCHECK_MAINTENANCE_URL e'
# DISTINTO da HEALTHCHECK_URL, periodo giornaliero).
#
# Exit code: 0 su successo, 1 se il job fallisce, 2 su errore di
# configurazione (file .env assente o DATABASE_URL mancante).
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" >/dev/null 2>&1 && pwd -P)"
root_dir="$(dirname -- "${script_dir}")"
env_file="${ENV_FILE:-${root_dir}/.env}"

if [[ ! -f "${env_file}" ]]; then
  echo "cron-maintenance: file di configurazione non trovato: ${env_file}" >&2
  exit 2
fi

# Stessa funzione di scripts/cron-scrape.sh (apici/commenti inline rimossi
# identicamente): rispecchia il parsing di Docker Compose, cosi' lo stesso
# .env letto due modi diversi non produce due valori diversi.
read_env_var() {
  local name="$1"
  local line value
  line="$(grep -m1 "^${name}=" "${env_file}" 2>/dev/null || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "${value}" =~ ^\"([^\"]*)\"[[:space:]]*(#.*)?$ ]]; then
    value="${BASH_REMATCH[1]}"
  elif [[ "${value}" =~ ^\'([^\']*)\'[[:space:]]*(#.*)?$ ]]; then
    value="${BASH_REMATCH[1]}"
  else
    value="$(printf '%s' "${value}" | sed -E 's/[[:space:]]+#.*$//')"
  fi
  printf '%s' "${value}"
}

database_url="$(read_env_var DATABASE_URL)"
healthcheck_url="$(read_env_var HEALTHCHECK_MAINTENANCE_URL)"

if [[ -z "${database_url}" ]]; then
  echo "cron-maintenance: variabile obbligatoria DATABASE_URL assente o vuota in ${env_file}" >&2
  exit 2
fi

timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

if (cd "${root_dir}" && DATABASE_URL="${database_url}" npx tsx scripts/maintenance-job.ts); then
  status_word="ok"
else
  status_word="FAILED"
fi

echo "${timestamp} cron-maintenance status=${status_word}"

if [[ "${status_word}" == "ok" ]]; then
  if [[ -n "${healthcheck_url}" ]]; then
    if curl -sS -f --max-time 10 --retry 3 "${healthcheck_url}" >/dev/null 2>&1; then
      echo "healthcheck=pinged"
    else
      echo "healthcheck=ping-failed"
    fi
  else
    echo "healthcheck=disabled (WARNING: nessun allarme configurato, un job morto non verra' segnalato)"
  fi
  exit 0
else
  exit 1
fi
