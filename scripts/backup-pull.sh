#!/usr/bin/env bash
# Il Mac scarica i backup cifrati dal server nel NAS di casa (D-21).
#
# PERCHE': il server tiene da solo le ultime BACKUP_RETENTION_DAYS copie
# cifrate (scripts/cron-backup.sh, senza BACKUP_TARGET), ma una copia che sta
# solo sul server muore con il server. Ogni sera il Mac, che le chiavi per
# leggerle le ha, le specchia nel NAS. Il NAS non e' mai esposto a internet:
# e' il Mac a chiamare il server, mai il contrario, e il server rsync del NAS
# resta spento.
#
# Gira su macOS (bash 3.2, nessun Node). Lo lancia launchd
# (scripts/launchd/it.fuori-rotta.backup-pull.plist) o una persona a mano.
#
# Configurazione (variabili d'ambiente, tutte facoltative):
#   BACKUP_PULL_HOST        utente@server        (root@fuori-rotta.it)
#   BACKUP_PULL_REMOTE_DIR  cartella dei backup sul server
#                           (/opt/docker/fuori-rotta/backups, il default di
#                           BACKUP_LOCAL_DIR in cron-backup.sh)
#   BACKUP_PULL_DEST        punto di mount del NAS (/Volumes/fuorirotta-backup)
#   BACKUP_PULL_LOG         file di log (~/Library/Logs/fuorirotta-backup-pull.log)
#
# Due guardie, ognuna per un disastro gia' visto o evitabile:
# - DEST deve essere un volume MONTATO. Un /Volumes/x smontato e' una cartella
#   qualsiasi del disco del Mac: rsync ci scriverebbe dentro in silenzio.
# - --delete parte solo se l'elenco remoto contiene almeno un backup. Un
#   elenco vuoto o fallito (server giu', cartella sbagliata) non deve mai
#   svuotare il NAS: si esce con errore e il NAS resta com'e'.
#
# Exit code: 0 ok, 1 qualunque guardia o passo fallito (la riga di log dice
# quale).
set -euo pipefail

host="${BACKUP_PULL_HOST:-root@fuori-rotta.it}"
remote_dir="${BACKUP_PULL_REMOTE_DIR:-/opt/docker/fuori-rotta/backups}"
dest="${BACKUP_PULL_DEST:-/Volumes/fuorirotta-backup}"
dest="${dest%/}"
log="${BACKUP_PULL_LOG:-${HOME}/Library/Logs/fuorirotta-backup-pull.log}"

say() {
  local line
  line="$(date -u +"%Y-%m-%dT%H:%M:%SZ") backup-pull status=$1 $2"
  echo "${line}"
  mkdir -p "$(dirname -- "${log}")" 2>/dev/null || true
  echo "${line}" >> "${log}" 2>/dev/null || true
}
die() {
  say FAILED "$1" >&2
  exit 1
}

# Guardia 1: il NAS e' montato davvero.
mount | grep -qF " on ${dest} " \
  || die "il volume ${dest} non e' montato (apri smb://NaloNAS/fuorirotta-backup dal Finder): non scrivo nulla"

ssh_opts=(-o BatchMode=yes -o ConnectTimeout=20)

# Elenco remoto "<byte> <nome>" dei soli backup. wc -c e' uguale su Linux e
# macOS; i file in scrittura (.partial) iniziano con un punto e il glob non
# li vede; la riga "total" si scarta con il filtro sul nome.
remote_list="$(ssh "${ssh_opts[@]}" "${host}" "cd '${remote_dir}' && wc -c fuorirotta-*.dump.gpg" 2>/dev/null \
  | awk '$2 ~ /^fuorirotta-.*\.dump\.gpg$/ {print $1, $2}' | sort -k2 || true)"

# Guardia 2: niente elenco, niente rsync (quindi niente --delete).
[[ -n "${remote_list}" ]] \
  || die "nessun backup *.dump.gpg elencato su ${host}:${remote_dir} (server irraggiungibile o cartella vuota): il NAS non e' stato toccato"

rsync -rt --delete \
  --include='fuorirotta-*.dump.gpg' --exclude='*' \
  -e "ssh ${ssh_opts[*]}" \
  "${host}:${remote_dir}/" "${dest}/" \
  || die "rsync fallito"

# Verifica: il piu' recente sul NAS e' quello del server (nome e dimensione).
# I nomi contengono il timestamp UTC, quindi l'ordine alfabetico e' quello
# cronologico.
newest_remote="$(echo "${remote_list}" | tail -n 1)"
newest_name="${newest_remote#* }"
[[ -f "${dest}/${newest_name}" ]] || die "il piu' recente del server (${newest_name}) manca sul NAS"
local_size="$(wc -c < "${dest}/${newest_name}" | tr -d '[:space:]')"
[[ "${local_size}" == "${newest_remote%% *}" ]] \
  || die "${newest_name}: ${local_size} byte sul NAS, ${newest_remote%% *} sul server"

count="$(echo "${remote_list}" | wc -l | tr -d '[:space:]')"
say ok "file=${newest_name} bytes=${local_size} copie=${count}"
