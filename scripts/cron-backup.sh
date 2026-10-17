#!/usr/bin/env bash
# Backup giornaliero cifrato e fuori dal server (D-18, ACCT-02/ACCT-04).
#
# PERCHE' esiste: Supabase Free non fa backup, e dalla Fase 21 il database
# contiene la prima cosa che il re-scraping non sa rigenerare: gli account
# (auth_user, auth_session, auth_account). Lo stesso database ospita anche le
# tabelle di n8n, credenziali comprese: non devono MAI
# finire in un backup, quindi non si fa un pg_dump dell'intero database.
#
# COSA scarica: SOLO le tabelle di Fuorirotta, cioe' i nomi @@map("...") di
# prisma/schema.prisma (auth_* inclusi) piu' _prisma_migrations, letti dallo
# schema del checkout al momento dell'esecuzione. Nessun nome e' scritto qui:
# una tabella aggiunta da una fase futura entra nel backup da sola, e una
# tabella di n8n non puo' entrarci perche' non e' nello schema.
#
# COME: pg_dump gira dentro un container postgres (l'host non ha il client, ne'
# Node 20: solo bash, docker, gpg, rclone) su DIRECT_URL (la porta non
# raggruppata, quella che pg_dump richiede). L'URL entra nel container solo
# come variabile d'ambiente, mai come argomento, quindi non compare nell'elenco
# dei processi. L'output va DIRETTAMENTE in gpg con cifratura a chiave
# pubblica: nessun dump in chiaro tocca mai il disco del server, e il server
# non puo' decifrare i propri backup (la chiave privata sta solo sul Mac). Un
# dump fallito non lascia nessun file (pipefail + file temporaneo rimosso).
#
# DOVE va: BACKUP_TARGET e' una destinazione rclone di tipo object storage
# (es. "hetzner:fuorirotta-backups", decisione utente in 21-02). Senza
# BACKUP_TARGET il file resta in BACKUP_LOCAL_DIR (e' quello che usa il gate).
# I file piu' vecchi di BACKUP_RETENTION_DAYS vengono cancellati: e' il numero
# scritto in /privacy per i dati di un account cancellato.
#
# Il dead man's switch (HEALTHCHECK_BACKUP_URL) e' pingato solo a successo
# completo: dump, cifratura, caricamento verificato e pulizia.
#
# Exit code: 0 su successo, 1 se un passo fallisce, 2 su errore di
# configurazione (.env assente, DIRECT_URL o BACKUP_GPG_RECIPIENT mancanti).
set -euo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")" >/dev/null 2>&1 && pwd -P)"
root_dir="$(dirname -- "${script_dir}")"
env_file="${ENV_FILE:-${root_dir}/.env}"

if [[ ! -f "${env_file}" ]]; then
  echo "cron-backup: file di configurazione non trovato: ${env_file}" >&2
  exit 2
fi

# Stessa funzione di scripts/cron-maintenance.sh (apici/commenti inline
# rimossi identicamente a Docker Compose).
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

direct_url="$(read_env_var DIRECT_URL)"
recipient="$(read_env_var BACKUP_GPG_RECIPIENT)"
retention_days="$(read_env_var BACKUP_RETENTION_DAYS)"
target="$(read_env_var BACKUP_TARGET)"
local_dir="$(read_env_var BACKUP_LOCAL_DIR)"
pg_image="$(read_env_var BACKUP_PG_IMAGE)"
docker_network="$(read_env_var BACKUP_DOCKER_NETWORK)"
healthcheck_url="$(read_env_var HEALTHCHECK_BACKUP_URL)"

retention_days="${retention_days:-14}"
local_dir="${local_dir:-/opt/docker/fuori-rotta/backups}"
pg_image="${pg_image:-postgres:17-alpine}"

for required in DIRECT_URL:"${direct_url}" BACKUP_GPG_RECIPIENT:"${recipient}"; do
  if [[ -z "${required#*:}" ]]; then
    echo "cron-backup: variabile obbligatoria ${required%%:*} assente o vuota in ${env_file}" >&2
    exit 2
  fi
done
if ! [[ "${retention_days}" =~ ^[1-9][0-9]*$ ]]; then
  echo "cron-backup: BACKUP_RETENTION_DAYS deve essere un intero positivo, trovato '${retention_days}'" >&2
  exit 2
fi

# Tabelle da scaricare: i @@map dello schema (righe di commento escluse) piu'
# _prisma_migrations. Vuoto = schema illeggibile: meglio fermarsi che fare un
# backup vuoto che sembra riuscito.
schema="${root_dir}/prisma/schema.prisma"
tables=()
if [[ -f "${schema}" ]]; then
  while IFS= read -r t; do
    [[ -n "${t}" ]] && tables+=("${t}")
  done < <(grep -vE '^[[:space:]]*//' "${schema}" | sed -nE 's/.*@@map\("([^"]+)"\).*/\1/p')
fi
if [[ "${#tables[@]}" -eq 0 ]]; then
  echo "cron-backup: nessun @@map trovato in ${schema}" >&2
  exit 2
fi
tables+=("_prisma_migrations")
echo "tables: ${tables[*]}"

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
name="fuorirotta-${timestamp}.dump.gpg"
mkdir -p -m 700 "${local_dir}"
tmp_file="${local_dir}/.${name}.partial"
trap 'rm -f "${tmp_file}"' EXIT

net_args=()
if [[ -n "${docker_network}" ]]; then
  net_args=(--network "${docker_network}")
fi

fail() {
  echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") cron-backup status=FAILED step=$1" >&2
  exit 1
}

docker run --rm "${pg_image}" pg_dump --version || fail "versione-pg_dump"

# --strict-names: una tabella dello schema assente dal database (migrazione
# non applicata) fa fallire il backup invece di ometterla in silenzio.
t_args=()
for t in "${tables[@]}"; do
  t_args+=(-t "${t}")
done
if ! docker run --rm ${net_args[@]+"${net_args[@]}"} -e DUMP_URL="${direct_url}" "${pg_image}" \
  sh -c 'exec pg_dump --dbname="$DUMP_URL" --format=custom --no-owner --no-privileges --strict-names "$@"' sh "${t_args[@]}" \
  | gpg --batch --yes --trust-model always --encrypt --recipient "${recipient}" --output "${tmp_file}"; then
  fail "dump-e-cifratura"
fi
[[ -s "${tmp_file}" ]] || fail "file-vuoto"
mv "${tmp_file}" "${local_dir}/${name}"
size="$(wc -c < "${local_dir}/${name}" | tr -d '[:space:]')"

if [[ -n "${target}" ]]; then
  # rclone copyto verifica da se' dimensione/checksum dopo il caricamento; il
  # lsf conferma comunque che il file esiste. Il file locale si rimuove solo
  # dopo questa verifica: se il caricamento fallisce resta qui, e il giorno
  # dopo lo si ritrova (la potatura locale lo toglie dopo la retention).
  rclone copyto "${local_dir}/${name}" "${target}/${name}" || fail "caricamento"
  rclone lsf "${target}" --files-only --include "${name}" | grep -qxF "${name}" || fail "verifica-caricamento"
  rm -f "${local_dir}/${name}"
  rclone delete "${target}" --min-age "${retention_days}d" --include 'fuorirotta-*.dump.gpg' || fail "potatura-remota"
fi

find "${local_dir}" -maxdepth 1 -type f -name 'fuorirotta-*.dump.gpg' -mtime "+${retention_days}" -delete || fail "potatura-locale"

echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ") cron-backup status=ok file=${name} bytes=${size} target=${target:-locale}"

if [[ -n "${healthcheck_url}" ]]; then
  if curl -fsS -m 10 --retry 3 "${healthcheck_url}" >/dev/null 2>&1; then
    echo "healthcheck=pinged"
  else
    echo "healthcheck=ping-failed"
  fi
else
  echo "healthcheck=disabled (WARNING: nessun allarme configurato, un backup morto non verra' segnalato)"
fi
