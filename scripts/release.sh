#!/usr/bin/env bash
# Pubblica una release: `npm run release 2.3.0`.
#
# Una release e' un deploy in produzione: entro 5 minuti il server la vede
# (scripts/auto-deploy.sh) e la rilascia da solo. Per questo, prima di creare
# il tag, qui si controlla cio' che prima si controllava a mano:
#   - si e' su main, pulito e allineato a GitHub (si rilascia cio' che c'e'
#     su GitHub, non un commit rimasto sul Mac);
#   - la CI di quel commit e' verde;
#   - la versione e' piu' alta dell'ultima (il server va solo in avanti, e un
#     tag piu' basso resterebbe fermo per sempre).
set -euo pipefail

die() { echo "release: $*" >&2; exit 1; }

version="${1:-}"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "uso: npm run release X.Y.Z  (es. 2.3.0)"
tag="v${version}"

[[ "$(git branch --show-current)" == "main" ]] || die "non sei su main"
[[ -z "$(git status --porcelain)" ]] || die "ci sono modifiche non committate"
git fetch --quiet --tags origin
[[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] \
  || die "main locale e origin/main divergono: fai git pull (o push) prima"
git rev-parse -q --verify "refs/tags/${tag}" >/dev/null && die "${tag} esiste gia'"

last="$(git tag -l 'v*' | sort -V | tail -1)"
if [[ -n "${last}" && "$(printf '%s\n%s\n' "${last}" "${tag}" | sort -V | tail -1)" != "${tag}" ]]; then
  die "${tag} non e' piu' alta dell'ultima (${last})"
fi

sha="$(git rev-parse HEAD)"
ci="$(gh run list --commit "${sha}" --workflow ci.yml --json status,conclusion \
  --jq 'map(select(.status == "completed")) | map(.conclusion) | unique | join(",")')"
[[ "${ci}" == "success" ]] || die "la CI di ${sha:0:7} non e' verde (${ci:-nessuna esecuzione completata}): aspetta o correggi"

git tag -a "${tag}" -m "${tag}"
git push --quiet origin "${tag}"
gh release create "${tag}" --generate-notes --title "${tag}"
echo "release: ${tag} pubblicata (${last:-nessuna} -> ${tag}). Il server la rilascia entro 5 minuti."
echo "release: avanzamento sul server: tail -f /var/log/fuorirotta-deploy.log"
