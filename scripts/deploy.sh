#!/usr/bin/env bash
# Rilascio di una versione, dal server, senza che nessuno da fuori abbia
# accesso a questa macchina.
#
#   bash scripts/deploy.sh v2.1.0      # un tag git
#   bash scripts/deploy.sh ea37b38     # un commit qualunque
#
# Cosa fa, nell'ordine che conta:
#   checkout della versione -> migrazioni -> build -> push su GHCR ->
#   swap -> verifica -> rollback automatico se la verifica non passa.
#
# Perche' le MIGRAZIONI PRIMA DEL BUILD: il Dockerfile lancia `npm run build`,
# e `next build` interroga il database in prerendering. Se le colonne nuove
# non esistono ancora, il build fallisce. E se esistono ma sono vuote il sito
# esce con la mappa deserta. Il container vecchio resta in piedi finche' il
# build non riesce, quindi il sito e' su per tutto il tempo.
#
# Perche' il PUSH SU GHCR, visto che l'immagine e' gia' qui: `docker tag` non
# copia nulla, da' un secondo NOME agli stessi byte su questo disco. Prima del
# 2026-09-20 tutti i rollback vivevano qui, e un `docker image prune -a` se li
# sarebbe portati via insieme. Nemmeno "tanto ricostruisco dal sorgente" e' un
# piano: `npm ci` risolve pacchetti che cambiano e `node:20-alpine` e' un tag
# mobile, quindi ricostruire lo stesso commit NON da' la stessa immagine. Per
# tornare indietro serve l'artefatto conservato, e conservato altrove.
#
# Il rollback NON e' un percorso separato: e' questo script con una versione
# precedente. Un percorso di emergenza che si esercita solo nelle emergenze e'
# un percorso che non funziona.
#
# ATTENZIONE, cosa NON sa fare: le migrazioni sono a senso unico. Tornare a
# un'immagine precedente NON riporta indietro lo schema. E' il motivo per cui
# le migrazioni di questo progetto sono additive (colonna nuova nullable, mai
# una DROP): il codice vecchio continua a funzionare su uno schema nuovo. Una
# migrazione distruttiva romperebbe la proprieta' e va rilasciata in due passi.
#
# I backfill una-tantum non sono qui: appartengono a un rilascio specifico, non
# a tutti. Si dichiarano nelle note della Release e si lanciano a mano PRIMA.
set -euo pipefail

VERSION="${1:?uso: deploy.sh <versione>   es. v2.1.0 oppure un commit}"

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

[[ -f "${ROOT}/.env" ]] || die "manca ${ROOT}/.env"

# --- 1. Stato attuale, quello a cui si torna se qualcosa va storto ----------
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

# --- 2. Allineare il checkout alla versione --------------------------------
# Il checkout serve anche dopo: migrazioni, script una-tantum, generatore di
# crontab e script di cron NON stanno dentro l'immagine. Deve corrispondere
# esattamente a cio' che si costruisce.
git fetch --all --tags --prune --quiet
git -c advice.detachedHead=false checkout --quiet --detach "${VERSION}" \
  || die "ref git non trovato: ${VERSION}"
log "checkout su $(git rev-parse --short HEAD)"

# --- 3. Migrazioni, PRIMA del build ----------------------------------------
# `prisma generate` sul checkout serve ai container laterali (manutenzione,
# backfill) che montano questa cartella e usano il client che sta qui.
# Sempre prisma@6.1.0 esplicito: `npx prisma` liscio prende la 7, che ha
# rimosso `url` dal blocco datasource e fallisce con P1012.
log "prisma generate"
npx --yes prisma@6.1.0 generate >/dev/null
log "migrate deploy"
npx --yes prisma@6.1.0 migrate deploy

# --- 4. Build, taggato con la versione -------------------------------------
# Le credenziali le legge compose dal .env di questa cartella, come sempre.
log "build ${IMAGE}"
FUORIROTTA_IMAGE="${IMAGE}" docker compose build

# --- 5. Push su GHCR, PRIMA dello swap -------------------------------------
# Prima dello swap di proposito: se non riesce, non e' ancora cambiato nulla.
# E fallisce invece di avvisare, perche' un rilascio che non si puo' piu'
# annullare e' esattamente cio' che questo script esiste per evitare.
# SKIP_PUSH=1 per un rilascio deliberatamente locale (es. registry giu').
if [[ "${SKIP_PUSH:-0}" == "1" ]]; then
  log "SKIP_PUSH=1: immagine non pubblicata — nessuna copia fuori da questa macchina"
else
  log "push ${IMAGE}"
  docker push "${IMAGE}" >/dev/null \
    || die "push su GHCR fallito. Autenticati una volta sola con: echo \$GHCR_TOKEN | docker login ghcr.io -u <utente> --password-stdin  (token con permesso write:packages). Oppure rilancia con SKIP_PUSH=1 se sai di rinunciare alla copia remota."
fi
DIGEST="$(docker inspect "${IMAGE}" --format '{{index .RepoDigests 0}}' 2>/dev/null || echo "${IMAGE}")"

# --- 6. Swap ---------------------------------------------------------------
log "avvio ${IMAGE}"
FUORIROTTA_IMAGE="${IMAGE}" docker compose up -d --no-build

# --- 7. Verifica, e ritorno indietro automatico se non passa ---------------
rollback() {
  echo "[deploy] ROLLBACK verso ${PREV_IMAGE:-<nessuna immagine precedente>}" >&2
  if [[ -n "${PREV_IMAGE}" ]]; then
    # Se l'immagine precedente non e' piu' su questo disco, si riprende da
    # GHCR: e' esattamente il caso per cui la si pubblica.
    docker image inspect "${PREV_IMAGE}" >/dev/null 2>&1 || docker pull "${PREV_IMAGE}" >/dev/null 2>&1 || true
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
# chiede che il catalogo sia leggibile, non solo che il processo sia su.
SMOKE="$(curl -s --max-time 15 "${SMOKE_URL}" || true)"
grep -q '"id"' <<<"${SMOKE}" || rollback "l API eventi non ha restituito alcun evento"
log "salute e catalogo ok"

# --- 8. Registrare cosa c'e' davvero in produzione -------------------------
{
  echo "image=${IMAGE}"
  echo "digest=${DIGEST}"
  echo "git=$(git rev-parse HEAD)"
  echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "pushed=$([[ "${SKIP_PUSH:-0}" == "1" ]] && echo no || echo si)"
} > "${STATE_FILE}"

# --- 9. Il crontab non si tocca da solo: si segnala se e' andato alla deriva
# Avviso, mai un fallimento: un crontab disallineato non giustifica di
# riportare indietro un rilascio sano.
if ! crontab -l 2>/dev/null | npx --yes tsx scripts/generate-crontab.ts --check -; then
  echo "[deploy] ATTENZIONE: il crontab installato NON combacia col registry — vedi sopra." >&2
fi

log "fatto: ${VERSION} (${DIGEST})"
