#!/usr/bin/env bash
# Push di prova dal terminale del server (Fase 26, D-11): lancia scripts/send-test-push.ts con gli stessi
# argomenti (--reach | --token <hex> --env sandbox|production | --user <id|e-mail> [--title T] [--body B]).
#
# Stessa scelta di scripts/cron-maintenance.sh, in breve: lo script gira DENTRO node:24.22.1-alpine col
# checkout montato, non sull'host. L'engine di Prisma sul disco e' musl (generato nell'immagine) e il Node
# dell'host e' vecchio; nell'immagine dell'app non ci sono ne' scripts/ ne' tsx.
#
# La chiave APNs vive SOLO nel .env dell'host, mai nel container dell'app (D-17, D8). Qui entra in un
# container usa-e-getta passata PER NOME (-e NOME, senza valore): non compare nella riga di comando, quindi
# nemmeno in ps. I valori li legge read_env_var, identica a quella di cron-maintenance.sh.
#
# Exit code: quello dello script (0 riuscito, 1 esito negativo, 2 configurazione incompleta); 2 anche se il
# .env manca (tranne per --reach, che non ha bisogno di nessuna credenziale).
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" >/dev/null 2>&1 && pwd -P)"
root_dir="$(dirname -- "${script_dir}")"
env_file="${ENV_FILE:-${root_dir}/.env}"

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

if [[ -f "${env_file}" ]]; then
  for name in DATABASE_URL APNS_KEY_ID APNS_PRIVATE_KEY_B64 APPLE_TEAM_ID APPLE_APP_BUNDLE_ID; do
    value="$(read_env_var "${name}")"
    # le variabili vuote non si esportano: lo script le vede assenti e ne stampa il nome
    if [[ -n "${value}" ]]; then export "${name}=${value}"; fi
  done
elif [[ "${1:-}" != "--reach" ]]; then
  echo "send-test-push: file di configurazione non trovato: ${env_file}" >&2
  exit 2
fi

# -e NOME senza "=valore": Docker prende il valore dall'ambiente di questo processo.
docker run --rm \
  -v "${root_dir}:/app" -w /app \
  -e DATABASE_URL -e APNS_KEY_ID -e APNS_PRIVATE_KEY_B64 -e APPLE_TEAM_ID -e APPLE_APP_BUNDLE_ID \
  node:24.22.1-alpine \
  npx --yes tsx scripts/send-test-push.ts "$@"
