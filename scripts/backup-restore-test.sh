#!/usr/bin/env bash
# Prova di ripristino di un backup (D-18): gira sul Mac, mai sul server.
#
# Uso: bash scripts/backup-restore-test.sh <file.dump.gpg>
#
# Decifra il backup con la chiave privata del Mac (o con GNUPGHOME, se
# impostato: lo usa il gate), avvia un container Postgres USA-E-GETTA della
# stessa major del dump, senza porte pubblicate e con nome casuale, ripristina
# in un database nuovo e stampa "<tabella> <righe>" per ogni tabella del dump.
# Alla fine, anche su errore, rimuove il container e il file decifrato (dati
# personali in chiaro esistono solo per questi secondi).
#
# Cosa NON fa, di proposito: non accetta URL ne' nomi di container (niente
# puo' essere puntato su un database vero), non legge nessun .env, non tocca
# fuorirotta-postgres-dev ne' la produzione.
set -euo pipefail

if [[ "$#" -ne 1 || ! -f "$1" ]]; then
  echo "uso: bash scripts/backup-restore-test.sh <file.dump.gpg>" >&2
  exit 2
fi
backup_file="$1"

work_dir="$(mktemp -d)"
container="fuorirotta-restore-test-$$-${RANDOM}"
# Rete di sicurezza: il nome e' composto qui sopra, ma se qualcuno lo cambiasse
# puntandolo al database di sviluppo, ci si ferma prima di avviare qualsiasi cosa.
case "${container}" in
  fuorirotta-restore-test-*) ;;
  *) echo "ABORT: il container di prova non e' un container usa-e-getta" >&2; exit 1 ;;
esac
cleanup() {
  docker rm -f "${container}" >/dev/null 2>&1 || true
  rm -rf "${work_dir}"
}
trap cleanup EXIT

dump="${work_dir}/restore.dump"
gpg --batch --quiet --yes --decrypt --output "${dump}" "${backup_file}"

# Major di pg_dump: e' scritta nell'intestazione dell'archivio, dopo nome del
# database e versione del server (le prime due stringhe che sembrano una
# versione). Il server di prova deve avere almeno quella major per ripristinare.
dump_version="$(head -c 400 "${dump}" | LC_ALL=C tr -c '[:print:]' '\n' | grep -E '^[0-9]+\.[0-9]+' | sed -n 2p || true)"
major="${dump_version%%.*}"
if ! [[ "${major}" =~ ^[0-9]+$ ]]; then
  major=17
  echo "restore-test: major del dump non leggibile, uso ${major}" >&2
fi
image="postgres:${major}-alpine"
echo "restore-test: dump di pg_dump ${dump_version:-?}, immagine ${image}"

docker run -d --rm --name "${container}" -e POSTGRES_PASSWORD=restore-test "${image}" >/dev/null
# Il server temporaneo dell'entrypoint ascolta solo sul socket unix: la
# connessione TCP su 127.0.0.1 riesce solo quando parte quello vero.
ready=0
for _ in $(seq 1 60); do
  if docker exec "${container}" psql -h 127.0.0.1 -U postgres -tAc 'select 1' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "${ready}" -eq 1 ]] || { echo "restore-test: il container di prova non e' partito" >&2; exit 1; }

psql_in() { docker exec "${container}" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 "$@"; }

psql_in -tAc 'CREATE DATABASE restore_test' >/dev/null
docker cp "${dump}" "${container}:/tmp/restore.dump"

# Il dump per tabelle non porta le estensioni (indici trigram su events, 10-03):
# vanno create prima, nello stesso schema in cui il database sorgente le aveva.
ext_schema="$(docker exec "${container}" pg_restore -f - --schema-only /tmp/restore.dump \
  | grep -oE '[a-z_]+\.gin_trgm_ops' | head -1 | cut -d. -f1 || true)"
if [[ -n "${ext_schema}" && "${ext_schema}" != "public" ]]; then
  psql_in -d restore_test -tAc "CREATE SCHEMA ${ext_schema}" >/dev/null
  psql_in -d restore_test -tAc "CREATE EXTENSION pg_trgm SCHEMA ${ext_schema}" >/dev/null
else
  psql_in -d restore_test -tAc 'CREATE EXTENSION pg_trgm' >/dev/null
fi

docker exec "${container}" pg_restore -h 127.0.0.1 -U postgres -d restore_test \
  --no-owner --no-privileges --exit-on-error /tmp/restore.dump

# Voci TABLE dell'elenco del dump: "213; 1259 16401 TABLE public comuni owner".
tables="$(docker exec "${container}" pg_restore -l /tmp/restore.dump \
  | awk '$4 == "TABLE" && $5 == "public" { print $6 }' | sort)"
if [[ -z "${tables}" ]]; then
  echo "restore-test: nessuna tabella nel dump" >&2
  exit 1
fi
while IFS= read -r t; do
  rows="$(psql_in -d restore_test -tAc "SELECT count(*) FROM public.\"${t}\"")"
  echo "${t} ${rows}"
done <<< "${tables}"
echo "restore-test: ok"
