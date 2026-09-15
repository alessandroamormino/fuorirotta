#!/usr/bin/env bash
# Wrapper di cron per il job di manutenzione consolidato
# (scripts/maintenance-job.ts): aggancio territoriale + dedup + cache dei
# cluster, una volta al giorno (D-05/D-06/D-07).
#
# A differenza di scripts/cron-scrape.sh non passa da HTTP: non c'e' nessuna
# route da autenticare, quindi non legge il segreto del cron ne'
# NEXT_PUBLIC_APP_URL.
#
# DOVE gira il job: dentro node:20-alpine col checkout montato, non sull'host
# e non dentro l'immagine dell'app. Le tre opzioni e perche' restano due:
#   - immagine dell'app: lo stage "runner" del Dockerfile copia solo
#     .next/standalone, .next/static, node_modules/.prisma e prisma/ — niente
#     scripts/ ne' lib/ ne' tsx. Il comando fallirebbe subito (14-03).
#   - checkout host: e' quello che 14-03 aveva scelto, e in produzione ha
#     fallito due volte il 2026-09-15 — prima con "File is not defined"
#     (host Node 18.19.1, undici@7 vuole Node 20), poi, risolto quello, con
#     "could not locate the Query Engine for runtime debian-openssl-3.0.x"
#     (l'engine sul disco e' musl, generato dentro l'immagine; l'host e'
#     Debian). La seconda non si risolve aggiornando Node: e' la libc.
#   - container node:20-alpine col checkout montato: Node 20 e libc musl,
#     cioe' esattamente l'ambiente per cui node_modules e' stato costruito.
#     E' anche la regola gia' in uso nel progetto per gli script di
#     manutenzione sul database (DEPLOYMENT.md).
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

# Il job Node gira DENTRO node:20-alpine col checkout montato, non sull'host.
# Due ragioni, entrambe misurate sull'host reale il 2026-09-15:
#
#  1. node_modules/.prisma/client contiene il query engine per
#     linux-musl-openssl-3.0.x (generato dentro l'immagine, che e'
#     node:20-alpine). L'host e' Debian: eseguire qui il job fallisce con
#     "Prisma Client could not locate the Query Engine for runtime
#     debian-openssl-3.0.x". Aggiungere un secondo binaryTarget significherebbe
#     tenere due engine in sync per sempre; usare il container usa l'engine che
#     e' gia' sul disco, quello giusto.
#  2. L'host gira Node 18.19.1, l'immagine node:20. Diverse dipendenze
#     richiedono >= 20.
#
# E' anche la regola gia' in uso nel progetto per gli script di manutenzione
# ("stanno fuori dall'immagine, girano in un container a parte col checkout
# montato" — DEPLOYMENT.md). 14-03 se n'era discostato facendo girare npx tsx
# sull'host: funzionava in sviluppo e non in produzione.
#
# Il wrapper resta sull'host: legge .env, decide lo stato, pinga il dead man's
# switch. Nel container entra solo la parte Node, con la sola DATABASE_URL.
if docker run --rm \
  -v "${root_dir}:/app" -w /app \
  -e DATABASE_URL="${database_url}" \
  node:20-alpine \
  npx --yes tsx scripts/maintenance-job.ts; then
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
