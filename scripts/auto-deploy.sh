#!/usr/bin/env bash
# Rilascio automatico, modello "pull": ogni 5 minuti (crontab) il server chiede
# a GitHub qual e' l'ultima RELEASE pubblicata e, se e' piu' nuova di cio' che
# gira, lancia scripts/deploy.sh. GitHub non entra mai qui e non custodisce
# segreti: questa macchina legge un'API pubblica e decide da sola.
#
# Il segnale e' la release, non un push: cio' che va in produzione lo decide
# ancora una persona, con `npm run release X.Y.Z` dal Mac.
#
# Regole, ognuna con un motivo:
# - Solo in avanti. Un rollback manuale (deploy.sh vecchia-versione) non viene
#   annullato al giro dopo: si torna avanti solo con una release NUOVA.
# - Una release fallita non si ritenta: deploy.sh ha gia' fatto rollback, e
#   ritentarla ogni 5 minuti vorrebbe dire un build e un avviso ogni 5 minuti.
#   Resta scritta in ${FAILED_FILE}; la correzione e' una release nuova.
# - Il tag arriva da fuori e finisce in `git checkout`: accettato solo nella
#   forma vX.Y.Z.
# - Muto quando non c'e' niente da fare: 288 righe al giorno di "nulla di
#   nuovo" nasconderebbero quelle che contano.
#
# Avviso: HEALTHCHECK_DEPLOY_URL nel .env (facoltativo). Ping su successo,
# /fail su fallimento — sul servizio il check va creato con un periodo lungo,
# cosi' l'unica cosa che allarma e' un /fail.
set -euo pipefail

# Tutto dentro main, chiamata in fondo: deploy.sh cambia il checkout, e con
# lui questo file. Cosi' bash ha gia' letto tutto prima che succeda.
main() {
  export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  local root="${FUORIROTTA_ROOT:-/opt/docker/fuori-rotta/fuorirotta}"
  local repo="alessandroamormino/fuorirotta"
  local state_file="${root}/.deployed"
  FAILED_FILE="${root}/.auto-deploy-failed"
  local lock_file="/var/lock/fuorirotta-deploy.lock"
  local ts; ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Un deploy (manuale o automatico) e' gia' in corso: si riprova al giro dopo.
  flock -n "${lock_file}" true 2>/dev/null || exit 0

  local latest
  latest="$(curl -fsS --max-time 20 "https://api.github.com/repos/${repo}/releases/latest" \
    | sed -n 's/^ *"tag_name": *"\([^"]*\)".*/\1/p' | head -1)" || {
    echo "${ts} auto-deploy: GitHub non raggiungibile, si riprova al prossimo giro"
    exit 0
  }
  if [[ ! "${latest}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "${ts} auto-deploy: tag dell'ultima release non valido: '${latest}'" >&2
    exit 1
  fi

  local current=""
  [[ -f "${state_file}" ]] && current="$(sed -n 's/^image=.*:\(v[0-9.]*\)$/\1/p' "${state_file}" | head -1)"

  [[ "${latest}" == "${current}" ]] && exit 0
  # Solo in avanti: se cio' che gira e' gia' piu' nuovo, niente da fare.
  if [[ -n "${current}" && "$(printf '%s\n%s\n' "${current}" "${latest}" | sort -V | tail -1)" == "${current}" ]]; then
    exit 0
  fi
  if [[ -f "${FAILED_FILE}" && "$(cat "${FAILED_FILE}")" == "${latest}" ]]; then
    exit 0
  fi

  # Uno scrape in corso morirebbe col restart del container, lasciando il
  # region lock appeso fino al TTL (8h): il 2026-10-18 i deploy delle 07:00
  # hanno ucciso lo scrape lombardo e fatto fallire la manutenzione delle 11:00.
  # Si riprova al giro dopo. Se il sito non risponde si procede: un deploy
  # potrebbe proprio sistemarlo, e senza app non gira nessuno scrape.
  # ponytail: un lock orfano (scrape gia' morto) blocca il rilascio fino al TTL.
  local locked
  locked="$(curl -fsS --max-time 10 http://127.0.0.1:3000/api/monitoring 2>/dev/null \
    | grep -o '"lockedRegions":\[[^]]*\]' | sed 's/.*\[\(.*\)\]/\1/' || true)"
  if [[ -n "${locked}" ]]; then
    echo "${ts} auto-deploy: ${latest} rimandato, scrape in corso: ${locked}"
    exit 0
  fi

  local hc_url=""
  hc_url="$(grep -m1 '^HEALTHCHECK_DEPLOY_URL=' "${root}/.env" 2>/dev/null | cut -d= -f2- | tr -d "\"'" || true)"

  echo "${ts} auto-deploy: ${current:-<nessuna>} -> ${latest}"
  if bash "${root}/scripts/deploy.sh" "${latest}"; then
    rm -f "${FAILED_FILE}"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-deploy: ${latest} in produzione"
    [[ -n "${hc_url}" ]] && curl -fsS --max-time 10 --retry 3 "${hc_url}" >/dev/null 2>&1 || true
  else
    printf '%s' "${latest}" > "${FAILED_FILE}"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) auto-deploy: ${latest} FALLITO (rollback fatto da deploy.sh), non verra' ritentato" >&2
    [[ -n "${hc_url}" ]] && curl -fsS --max-time 10 --retry 3 "${hc_url}/fail" >/dev/null 2>&1 || true
    exit 1
  fi
}

main "$@"
