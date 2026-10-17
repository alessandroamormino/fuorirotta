#!/usr/bin/env bash
# Gate del backup cifrato (check:backup, test:local) - D-18.
#
# Prova l'intera catena sul Postgres LOCALE (container fuorirotta-postgres-dev,
# mai produzione), con una chiave gpg usa-e-getta in un GNUPGHOME temporaneo:
#   B1  cron-backup.sh esce 0 e lascia esattamente un *.dump.gpg
#   B2  il file non e' un archivio pg_dump in chiaro (niente firma PGDMP) e
#       nella cartella non resta nient'altro
#   B3  le tabelle scaricate sono i @@map dello schema piu' _prisma_migrations,
#       e nessun nome fuori dallo schema
#   B4  backup-restore-test.sh (quello vero) ripristina e per ogni tabella il
#       conteggio coincide con `select count(*)` su postgres-dev
#   B5  con DIRECT_URL su una porta chiusa lo script esce non-zero e non
#       lascia nessun file
#   B6  ramo object storage con un rclone finto nel PATH: caricamento,
#       verifica, file locale tolto solo dopo, potatura con la retention;
#       caricamento fallito = file locale conservato ed exit 1
#
# Il server di produzione non si tocca: la DIRECT_URL e' letterale qui sotto.
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

fail() {
  echo "FAIL: $1"
  exit 1
}
ok() { echo "ok  $1"; }

dev_container="fuorirotta-postgres-dev"
if ! docker ps --format '{{.Names}}' | grep -qx "${dev_container}"; then
  fail "il container ${dev_container} non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi
psql_dev() { docker exec "${dev_container}" psql -U fuorirotta -d fuorirotta_dev -tAc "$1"; }

work="$(mktemp -d)"
export GNUPGHOME="${work}/gnupg"
mkdir -m 700 "${GNUPGHOME}"
cleanup() {
  gpgconf --kill all >/dev/null 2>&1 || true
  rm -rf "${work}"
  # difesa: nessun container di prova deve sopravvivere al gate
  docker ps -aq --filter 'name=fuorirotta-restore-test-' | xargs docker rm -f >/dev/null 2>&1 || true
}
trap cleanup EXIT

recipient="backup-gate@fuorirotta.invalid"
gpg --batch --quiet --passphrase '' --quick-gen-key "${recipient}" default default never >/dev/null 2>&1 \
  || fail "impossibile generare la chiave di prova"

backups="${work}/backups"
env_file="${work}/env"
write_env() {
  cat > "${env_file}" <<EOF
DIRECT_URL=${1}
BACKUP_GPG_RECIPIENT=${recipient}
BACKUP_LOCAL_DIR=${backups}
BACKUP_PG_IMAGE=postgres:16-alpine
BACKUP_DOCKER_NETWORK=container:${dev_container}
${2:-}
EOF
}
good_url="postgresql://fuorirotta:fuorirotta@localhost:5432/fuorirotta_dev"

# --- B1 ------------------------------------------------------------------------
write_env "${good_url}"
ENV_FILE="${env_file}" bash scripts/cron-backup.sh > "${work}/b1.out" 2>&1 \
  || { cat "${work}/b1.out"; fail "B1: cron-backup.sh e' uscito non-zero"; }
count="$(find "${backups}" -type f | wc -l | tr -d '[:space:]')"
files=("${backups}"/*.dump.gpg)
[[ "${count}" -eq 1 && -f "${files[0]}" ]] || fail "B1: attesi esattamente un *.dump.gpg, trovati ${count} file"
ok "B1: backup eseguito, un solo file ${files[0]##*/}"

# --- B2 ------------------------------------------------------------------------
[[ "$(head -c 5 "${files[0]}")" != "PGDMP" ]] || fail "B2: il file e' un archivio pg_dump in chiaro"
if gpg --batch --quiet --list-packets "${files[0]}" 2>/dev/null | grep -q 'pubkey enc packet'; then
  ok "B2: il file e' cifrato a chiave pubblica (nessuna firma PGDMP), nessun altro file nella cartella"
else
  fail "B2: il file non risulta cifrato a chiave pubblica"
fi

# --- B3 ------------------------------------------------------------------------
expected="$( { grep -vE '^[[:space:]]*//' prisma/schema.prisma | grep -oE '@@map\("[^"]+"\)' | sed -E 's/@@map\("([^"]+)"\)/\1/'; echo _prisma_migrations; } | sort)"
printed="$(grep '^tables: ' "${work}/b1.out" | sed 's/^tables: //' | tr ' ' '\n' | sort)"
[[ -n "${printed}" && "${printed}" == "${expected}" ]] || fail "B3: tabelle stampate ($(echo ${printed})) diverse dall'insieme atteso ($(echo ${expected}))"
ok "B3: tabelle scaricate = @@map dello schema + _prisma_migrations ($(echo "${printed}" | wc -l | tr -d '[:space:]'))"

# --- B4 ------------------------------------------------------------------------
bash scripts/backup-restore-test.sh "${files[0]}" > "${work}/b4.out" 2>&1 \
  || { cat "${work}/b4.out"; fail "B4: backup-restore-test.sh e' uscito non-zero"; }
restored="$(grep -E '^[a-z_]+ [0-9]+$' "${work}/b4.out" | sort)"
restored_names="$(echo "${restored}" | awk '{print $1}')"
[[ "${restored_names}" == "${expected}" ]] || fail "B4: tabelle ripristinate ($(echo ${restored_names})) diverse da quelle attese"
while read -r t n; do
  src="$(psql_dev "SELECT count(*) FROM public.\"${t}\"")"
  [[ "${n}" == "${src}" ]] || fail "B4: ${t} ripristinata con ${n} righe, sorgente ${src}"
done <<< "${restored}"
if docker ps -a --format '{{.Names}}' | grep -q '^fuorirotta-restore-test-'; then
  fail "B4: il container di prova non e' stato rimosso"
fi
ok "B4: ripristino su container usa-e-getta, conteggi identici alla sorgente per ogni tabella"

# --- B5 ------------------------------------------------------------------------
rm -rf "${backups}"
write_env "postgresql://fuorirotta:fuorirotta@localhost:1/fuorirotta_dev"
if ENV_FILE="${env_file}" bash scripts/cron-backup.sh > "${work}/b5.out" 2>&1; then
  fail "B5: con la porta chiusa lo script e' uscito 0"
fi
left="$(find "${backups}" -type f 2>/dev/null | wc -l | tr -d '[:space:]')"
[[ "${left}" -eq 0 ]] || fail "B5: dump fallito ma restano ${left} file"
ok "B5: dump fallito = exit non-zero e nessun file"

# --- B6 ------------------------------------------------------------------------
# rclone finto: copyto = cp, lsf = ls, delete = registra gli argomenti. Cosi'
# il ramo di produzione e' provato anche se rclone non e' installato qui.
fake_bin="${work}/bin"
remote="${work}/remote"
mkdir -p "${fake_bin}" "${remote}"
cat > "${fake_bin}/rclone" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  copyto) [[ -n "${FAKE_RCLONE_FAIL:-}" ]] && exit 1; cp "$2" "$3" ;;
  lsf) ls "$2" ;;
  delete) echo "$*" >> "${FAKE_RCLONE_LOG}" ;;
esac
EOF
chmod +x "${fake_bin}/rclone"
export FAKE_RCLONE_LOG="${work}/rclone.log"
rm -rf "${backups}"
write_env "${good_url}" "BACKUP_TARGET=${remote}
BACKUP_RETENTION_DAYS=14"
PATH="${fake_bin}:${PATH}" ENV_FILE="${env_file}" bash scripts/cron-backup.sh > "${work}/b6.out" 2>&1 \
  || { cat "${work}/b6.out"; fail "B6: ramo object storage uscito non-zero"; }
[[ "$(find "${remote}" -name 'fuorirotta-*.dump.gpg' | wc -l | tr -d '[:space:]')" -eq 1 ]] || fail "B6: il file non e' arrivato a destinazione"
[[ "$(find "${backups}" -type f | wc -l | tr -d '[:space:]')" -eq 0 ]] || fail "B6: il file locale non e' stato tolto dopo il caricamento verificato"
grep -q -- '--min-age 14d' "${FAKE_RCLONE_LOG}" || fail "B6: potatura remota senza --min-age 14d"
rm -rf "${remote:?}"/*
FAKE_RCLONE_FAIL=1 PATH="${fake_bin}:${PATH}" ENV_FILE="${env_file}" bash scripts/cron-backup.sh > "${work}/b6b.out" 2>&1 \
  && fail "B6: caricamento fallito ma exit 0"
[[ "$(find "${backups}" -name 'fuorirotta-*.dump.gpg' | wc -l | tr -d '[:space:]')" -eq 1 ]] || fail "B6: caricamento fallito: il file locale doveva restare"
ok "B6: object storage: caricamento verificato, locale tolto dopo, potatura 14d; fallimento = locale conservato ed exit 1"

echo "PASS: backup cifrato end to end sul database locale (D-18)"
