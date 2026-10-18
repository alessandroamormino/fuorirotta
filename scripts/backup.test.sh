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
#       conteggio coincide con `select count(*)` su postgres-dev; unica
#       eccezione auth_rate_limit: la tabella c'e' ma e' vuota (gli IP dei
#       tentativi di accesso non finiscono nei backup)
#   B5  con DIRECT_URL su una porta chiusa lo script esce non-zero e non
#       lascia nessun file
#   B9  la password del database non compare nella riga di comando di docker
#       (T-21-39): ne' URL, ne' --dbname, ne' PGPASSWORD=valore; una password
#       percent-encoded nell'URL si decodifica ancora bene
#   B8  potatura locale (quella che gira in produzione): con retention 14 giorni
#       restano le copie di 13 giorni e di 13 giorni e 22 ore, spariscono
#       quelle di 14 giorni e 1 ora e di 15 giorni; un .partial vecchio di un
#       giro morto sparisce, uno recente (giro in corso) resta
#   B6  ramo object storage con un rclone finto nel PATH: caricamento,
#       verifica, file locale tolto solo dopo, potatura con la retention;
#       caricamento fallito = file locale conservato ed exit 1
#   B7  backup-pull.sh (D-21, il Mac che scarica nel NAS) con ssh, mount e
#       rsync-remoto finti: volume smontato = exit non-zero e niente scritto;
#       elenco remoto vuoto = niente delete; giro normale = specchio con il
#       file vecchio tolto dal NAS; server con meno della meta' delle copie
#       del NAS = niente delete
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
  psql_dev "DELETE FROM auth_rate_limit WHERE id = '__backup_gate__'" >/dev/null 2>&1 || true
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
# Una riga di rate limit di prova: B4 deve ritrovare la tabella ma vuota.
rl_key="__backup_gate__|/sign-in/social"
psql_dev "INSERT INTO auth_rate_limit (id, key, count, last_request) VALUES ('__backup_gate__', '${rl_key}', 1, 0) ON CONFLICT DO NOTHING" >/dev/null \
  || fail "B1: impossibile inserire la riga di rate limit di prova"
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
  [[ "${t}" == "auth_rate_limit" ]] && src=0
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

# --- B8 ------------------------------------------------------------------------
# touch -t (non -d) perche' e' l'unico formato uguale su GNU e BSD.
age_stamp() { node -e 'const d=new Date(Date.now()-Number(process.argv[1])*60000),p=n=>String(n).padStart(2,"0");console.log(`${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`)' "$1"; }
rm -rf "${backups}"
mkdir -p "${backups}"
for spec in 20250101T000000Z:$((13 * 1440)) 20250102T000000Z:$((13 * 1440 + 22 * 60)) 20250103T000000Z:$((14 * 1440 + 60)) 20250104T000000Z:$((15 * 1440)); do
  f="${backups}/fuorirotta-${spec%%:*}.dump.gpg"
  echo x > "${f}"
  touch -t "$(age_stamp "${spec#*:}")" "${f}"
done
echo x > "${backups}/.fuorirotta-20250105T000000Z.dump.gpg.partial"
touch -t "$(age_stamp $((2 * 1440)))" "${backups}/.fuorirotta-20250105T000000Z.dump.gpg.partial"
echo x > "${backups}/.fuorirotta-20250106T000000Z.dump.gpg.partial"
write_env "${good_url}" "BACKUP_RETENTION_DAYS=14"
ENV_FILE="${env_file}" bash scripts/cron-backup.sh > "${work}/b8.out" 2>&1 \
  || { cat "${work}/b8.out"; fail "B8: cron-backup.sh e' uscito non-zero"; }
[[ -f "${backups}/fuorirotta-20250101T000000Z.dump.gpg" && -f "${backups}/fuorirotta-20250102T000000Z.dump.gpg" ]] \
  || fail "B8: una copia di meno di 14 giorni e' stata cancellata"
[[ ! -e "${backups}/fuorirotta-20250103T000000Z.dump.gpg" && ! -e "${backups}/fuorirotta-20250104T000000Z.dump.gpg" ]] \
  || fail "B8: una copia di piu' di 14 giorni e' sopravvissuta ($(ls "${backups}" | tr '\n' ' '))"
[[ ! -e "${backups}/.fuorirotta-20250105T000000Z.dump.gpg.partial" && -e "${backups}/.fuorirotta-20250106T000000Z.dump.gpg.partial" ]] \
  || fail "B8: .partial vecchio non tolto o .partial recente tolto ($(ls -a "${backups}" | tr '\n' ' '))"
ok "B8: potatura locale a 14 giorni esatti: restano 13 giorni e 13 giorni 22 ore, spariscono 14 giorni 1 ora e 15 giorni; .partial vecchio tolto"

# --- B9 ------------------------------------------------------------------------
# docker finto: registra gli argomenti di ogni chiamata e poi esegue quello vero.
rm -rf "${backups}"
b9_bin="${work}/b9bin"
mkdir -p "${b9_bin}"
real_docker="$(command -v docker)"
cat > "${b9_bin}/docker" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "\${FAKE_DOCKER_LOG}"
exec "${real_docker}" "\$@"
EOF
chmod +x "${b9_bin}/docker"
export FAKE_DOCKER_LOG="${work}/docker.log"
: > "${FAKE_DOCKER_LOG}"
# Password di prova "pw%40x" = "pw@x": il ruolo dev non la richiede (connessione
# locale al container), conta solo che non finisca negli argomenti.
write_env "postgresql://fuorirotta:pw%40x@localhost:5432/fuorirotta_dev"
PATH="${b9_bin}:${PATH}" ENV_FILE="${env_file}" bash scripts/cron-backup.sh > "${work}/b9.out" 2>&1 \
  || { cat "${work}/b9.out"; fail "B9: cron-backup.sh e' uscito non-zero"; }
grep -q 'pg_dump' "${FAKE_DOCKER_LOG}" || fail "B9: il docker finto non ha visto la chiamata a pg_dump"
leak='postgres(ql)?://|--dbname|pw%40x|pw@x|PGPASSWORD='
if grep -qE "${leak}" "${FAKE_DOCKER_LOG}"; then
  fail "B9: URL o password nella riga di comando di docker: $(grep -E "${leak}" "${FAKE_DOCKER_LOG}" | head -n 1)"
fi
ok "B9: ne' URL ne' password nella riga di comando di docker, il dump riesce"

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

# --- B7 ------------------------------------------------------------------------
# Il server finto e' una cartella locale: ssh finto = esegue il comando in bash,
# rsync finto = toglie "host:" e il -e, poi rsync vero su cartelle locali, mount
# finto = dichiara montato solo cio' che la prova decide. Il pull non conosce
# ne' il database ne' gpg: bastano file qualunque col nome giusto.
command -v rsync >/dev/null || fail "B7: rsync non installato"
real_rsync="$(command -v rsync)"
pull_bin="${work}/pullbin"
srv="${work}/server"
nas="${work}/nas"
mkdir -p "${pull_bin}" "${srv}" "${nas}"
cat > "${pull_bin}/ssh" <<'EOF'
#!/usr/bin/env bash
bash -c "${@: -1}"
EOF
cat > "${pull_bin}/rsync" <<EOF
#!/usr/bin/env bash
args=()
while [[ \$# -gt 0 ]]; do
  case "\$1" in
    -e) shift ;;
    *:/*) args+=("\${1#*:}") ;;
    *) args+=("\$1") ;;
  esac
  shift
done
exec "${real_rsync}" "\${args[@]}"
EOF
cat > "${pull_bin}/mount" <<'EOF'
#!/usr/bin/env bash
[[ -n "${FAKE_MOUNT_POINT:-}" ]] && echo "//x@NAS/share on ${FAKE_MOUNT_POINT} (smbfs, nodev)"
exit 0
EOF
chmod +x "${pull_bin}"/*
pull() {
  PATH="${pull_bin}:${PATH}" BACKUP_PULL_HOST=x@server BACKUP_PULL_REMOTE_DIR="${srv}" \
    BACKUP_PULL_DEST="${nas}" BACKUP_PULL_LOG="${work}/pull.log" bash scripts/backup-pull.sh > "${work}/pull.out" 2>&1
}
for n in 20260101T000000Z 20260102T000000Z 20260103T000000Z; do echo "dump ${n}" > "${srv}/fuorirotta-${n}.dump.gpg"; done
echo partial > "${srv}/.fuorirotta-20260104T000000Z.dump.gpg.partial"

# (a) volume non montato: errore e nessun file scritto
unset FAKE_MOUNT_POINT
echo old > "${nas}/fuorirotta-20251231T000000Z.dump.gpg"
if pull; then fail "B7a: volume smontato ma exit 0"; fi
[[ "$(ls "${nas}" | wc -l | tr -d '[:space:]')" -eq 1 && -f "${nas}/fuorirotta-20251231T000000Z.dump.gpg" ]] \
  || fail "B7a: con il volume smontato la destinazione e' cambiata"
grep -q 'status=FAILED' "${work}/pull.log" || fail "B7a: nessuna riga FAILED nel log"

# (b) elenco remoto vuoto: errore e il NAS resta intatto (niente --delete)
export FAKE_MOUNT_POINT="${nas}"
real_srv="${srv}"; srv="${work}/server-empty"; mkdir -p "${srv}"
if pull; then fail "B7b: elenco remoto vuoto ma exit 0"; fi
[[ -f "${nas}/fuorirotta-20251231T000000Z.dump.gpg" ]] || fail "B7b: un elenco remoto vuoto ha cancellato dal NAS"
srv="${real_srv}"

# (c) giro normale: i tre del server arrivano, il vecchio sparisce, il .partial no
pull || { cat "${work}/pull.out"; fail "B7c: giro normale uscito non-zero"; }
got="$(ls "${nas}" | tr '\n' ' ')"
want="fuorirotta-20260101T000000Z.dump.gpg fuorirotta-20260102T000000Z.dump.gpg fuorirotta-20260103T000000Z.dump.gpg "
[[ "${got}" == "${want}" ]] || fail "B7c: NAS = '${got}', atteso '${want}'"
grep -q 'status=ok file=fuorirotta-20260103T000000Z.dump.gpg' "${work}/pull.log" || fail "B7c: riga ok mancante nel log"

# (d) server quasi svuotato (1 copia contro 3 sul NAS): errore e il NAS resta intatto
real_srv="${srv}"; srv="${work}/server-shrunk"; mkdir -p "${srv}"
echo "dump 20260110" > "${srv}/fuorirotta-20260110T000000Z.dump.gpg"
if pull; then fail "B7d: server svuotato ma exit 0"; fi
[[ "$(ls "${nas}" | tr '\n' ' ')" == "${want}" ]] || fail "B7d: un server svuotato ha toccato il NAS ($(ls "${nas}" | tr '\n' ' '))"
srv="${real_srv}"
ok "B7: pull nel NAS: smontato = niente scritto, elenco vuoto o server svuotato = niente delete, giro normale = specchio senza il file vecchio"

echo "PASS: backup cifrato end to end sul database locale (D-18) e pull nel NAS (D-21)"
