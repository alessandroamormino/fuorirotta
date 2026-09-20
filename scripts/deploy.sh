#!/usr/bin/env bash
# Rilascio di una versione GIA' costruita e pubblicata su GHCR.
#
#   bash scripts/deploy.sh v2.1.0
#   bash scripts/deploy.sh sha-33b20e4
#
# Perche' la logica sta qui e non nello YAML di GitHub Actions: cosi' e' la
# STESSA procedura che puoi lanciare a mano via SSH quando Actions non e'
# raggiungibile, ed e' versionata e leggibile in diff. Il workflow si limita a
# invocare questo script.
#
# Il rollback NON e' un percorso separato: e' questo script con una versione
# precedente. Un percorso di emergenza che si esercita solo nelle emergenze e'
# un percorso che non funziona.
#
# ATTENZIONE, cosa questo script NON sa fare: le migrazioni sono a senso
# unico. Tornare a un'immagine precedente NON riporta indietro lo schema del
# database. E' il motivo per cui le migrazioni di questo progetto sono
# additive (colonna nuova nullable, mai una DROP): il codice vecchio continua
# a funzionare su uno schema nuovo. Una migrazione distruttiva romperebbe
# questa proprieta' e andrebbe rilasciata in due passi separati.
#
# I backfill una-tantum non sono qui: sono specifici del rilascio, si
# dichiarano nelle note della Release e si lanciano a mano PRIMA dello swap.
set -euo pipefail

VERSION="${1:?uso: deploy.sh <versione>   es. v2.1.0 oppure sha-33b20e4}"

ROOT="${FUORIROTTA_ROOT:-/opt/docker/fuori-rotta/fuorirotta}"
IMAGE_REPO="${FUORIROTTA_IMAGE_REPO:-ghcr.io/alessandroamormino/fuorirotta}"
IMAGE="${IMAGE_REPO}:${VERSION}"
HEALTH_URL="${FUORIROTTA_HEALTH_URL:-http://127.0.0.1:3000/api/monitoring}"
SMOKE_URL="${FUORIROTTA_SMOKE_URL:-http://127.0.0.1:3000/api/events?limit=1}"
HEALTH_TIMEOUT_S="${FUORIROTTA_HEALTH_TIMEOUT_S:-120}"
STATE_FILE="${ROOT}/.deployed"

cd "${ROOT}"

log() { echo "[deploy] $*"; }
die() { echo "[deploy] ERRORE: $*" >&2; exit 1; }

# --- 1. Leggere il .env ------------------------------------------------------
# Le virgolette vanno tolte a mano: `docker run --env-file` NON le interpreta e
# passerebbe a Prisma un URL che comincia per virgolette. E' costato un
# backfill fallito il 2026-09-20, con il sito online e tutte le pagine regione
# a noindex. Stessa lettura che fa gia' scripts/cron-maintenance.sh.
read_env_var() {
  local line value
  line="$(grep -m1 "^$1=" "${ROOT}/.env" 2>/dev/null || true)"
  value="${line#*=}"
  value="${value%$'\r'}"
  printf '%s' "${value}" | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

[[ -f "${ROOT}/.env" ]] || die "manca ${ROOT}/.env"
DB_URL="$(read_env_var DATABASE_URL)"
[[ -n "${DB_URL}" ]] || die "DATABASE_URL assente o vuota in ${ROOT}/.env"

# --- 2. Stato attuale, da cui si torna indietro se qualcosa va storto --------
PREV_IMAGE=""
if [[ -f "${STATE_FILE}" ]]; then
  PREV_IMAGE="$(grep -m1 '^image=' "${STATE_FILE}" | cut -d= -f2- || true)"
fi
if [[ -z "${PREV_IMAGE}" ]]; then
  PREV_IMAGE="$(docker inspect fuorirotta-frontend --format '{{.Config.Image}}' 2>/dev/null || true)"
fi
PREV_GIT="$(git rev-parse HEAD)"
log "versione richiesta: ${VERSION}"
log "in esecuzione ora:  ${PREV_IMAGE:-<sconosciuta>} (checkout ${PREV_GIT:0:8})"

# --- 3. Scaricare l'immagine PRIMA di toccare qualunque cosa -----------------
# Se il registry non ha quella versione si esce qui, con la produzione intatta.
log "pull ${IMAGE}"
docker pull "${IMAGE}" >/dev/null || die "immagine non trovata nel registry: ${IMAGE}"
DIGEST="$(docker inspect "${IMAGE}" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "${IMAGE}")"
log "digest: ${DIGEST}"

# --- 4. Allineare il checkout alla versione ---------------------------------
# Il checkout serve ancora: migrazioni (prisma/migrations), script una-tantum,
# generatore di crontab e gli script di cron non stanno dentro l'immagine.
# Deve corrispondere ESATTAMENTE all'immagine, o si migra con un file diverso
# da quello con cui e' stato costruito il codice in esecuzione.
GIT_REF="${VERSION#sha-}"
git fetch --all --tags --prune --quiet
git -c advice.detachedHead=false checkout --quiet --detach "${GIT_REF}" \
  || die "ref git non trovato: ${GIT_REF} (il tag immagine deve corrispondere a un tag o commit)"
log "checkout su $(git rev-parse --short HEAD)"

# --- 5. Migrazioni, PRIMA dello swap ----------------------------------------
# `prisma generate` sul checkout serve ai container laterali (manutenzione,
# backfill) che montano questa cartella e usano il client che sta qui.
# Sempre prisma@6.1.0 esplicito: `npx prisma` liscio prende la 7, che ha
# rimosso `url` dal blocco datasource e fallisce con P1012.
log "prisma generate"
npx --yes prisma@6.1.0 generate >/dev/null
log "migrate deploy"
npx --yes prisma@6.1.0 migrate deploy

# --- 6. Swap ----------------------------------------------------------------
log "avvio ${IMAGE}"
FUORIROTTA_IMAGE="${IMAGE}" docker compose up -d --no-build

# --- 7. Verifica, e ritorno indietro automatico se non passa -----------------
rollback() {
  echo "[deploy] ROLLBACK verso ${PREV_IMAGE:-<nessuna immagine precedente>}" >&2
  if [[ -n "${PREV_IMAGE}" ]]; then
    FUORIROTTA_IMAGE="${PREV_IMAGE}" docker compose up -d --no-build || true
  fi
  git -c advice.detachedHead=false checkout --quiet --detach "${PREV_GIT}" || true
  die "$1 — rollback eseguito, controlla i log del container"
}

log "verifica (fino a ${HEALTH_TIMEOUT_S}s)"
deadline=$(( SECONDS + HEALTH_TIMEOUT_S ))
healthy=0
while (( SECONDS < deadline )); do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${HEALTH_URL}" || true)" == "200" ]]; then
    healthy=1
    break
  fi
  sleep 3
done
(( healthy == 1 )) || rollback "l endpoint di salute non ha risposto 200 entro ${HEALTH_TIMEOUT_S}s"

# Un 200 non basta: il 2026-09-20 il sito rispondeva 200 con la colonna
# `region` tutta NULL e ogni pagina regione a noindex. Questa seconda prova
# chiede che il catalogo sia davvero leggibile, non solo che il processo sia su.
SMOKE="$(curl -s --max-time 15 "${SMOKE_URL}" || true)"
grep -q '"id"' <<<"${SMOKE}" || rollback "l API eventi non ha restituito alcun evento"
log "salute e catalogo ok"

# --- 8. Registrare cosa c'e' davvero in produzione --------------------------
{
  echo "image=${IMAGE}"
  echo "digest=${DIGEST}"
  echo "git=$(git rev-parse HEAD)"
  echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} > "${STATE_FILE}"

# --- 9. Il crontab non si tocca da solo: si segnala se e' andato alla deriva -
# Avviso, mai un fallimento: un crontab disallineato non giustifica di
# riportare indietro un rilascio sano.
if ! crontab -l 2>/dev/null | npx --yes tsx scripts/generate-crontab.ts --check -; then
  echo "[deploy] ATTENZIONE: il crontab installato NON combacia col registry — vedi sopra." >&2
fi

log "fatto: ${VERSION} (${DIGEST})"
