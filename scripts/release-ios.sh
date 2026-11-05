#!/usr/bin/env bash
# Pubblica l'app su TestFlight (gruppo interno subito; gli esterni, es. Friends, si aggiungono da App Store Connect con Beta App Review): `npm run release:ios 1.0.0`.
# Prova senza caricare ne' taggare: `npm run release:ios -- --check 1.0.0`.
#
# Si lancia dal Mac, come `npm run release`; la chiave di App Store Connect vive fuori dal
# repo (~/.appstoreconnect) e non esiste nessuna CI o segreto GitHub per questo (D-09).
#
# I tag dell'app sono ios-X.Y.Z, MAI v*: scripts/auto-deploy.sh sul server rilascia in
# produzione il v* piu' alto, quindi un v* creato da qui deployerebbe il sito.
#
# Prima di firmare si controlla cio' che prima si controllava a mano:
#   - versione ben formata, uguale a MARKETING_VERSION di ios/project.yml e piu' alta
#     dell'ultimo tag ios-*;
#   - chiave presente e fuori dal repo, nessun .p8 / .mobileprovision tracciato;
#   - il progetto Xcode committato e' quello che xcodegen rigenera;
#   - (solo upload) su main, albero pulito, allineato a origin/main, CI verde;
#   - sul binario archiviato: FRAPIBaseURL e' https://fuori-rotta.it e non c'e' ATS (D-10).
set -euo pipefail

die() { echo "release-ios: $*" >&2; exit 1; }

check=0
if [[ "${1:-}" == "--check" ]]; then check=1; shift; fi
version="${1:-}"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || die "uso: npm run release:ios [--check] X.Y.Z  (es. 1.0.0)"
tag="ios-${version}"

cd "$(git rev-parse --show-toplevel)"
root="$(pwd -P)"

[[ -f "${HOME}/.appstoreconnect/fuorirotta.env" ]] && source "${HOME}/.appstoreconnect/fuorirotta.env"
ASC_KEY_ID="${ASC_KEY_ID:-}"
ASC_ISSUER_ID="${ASC_ISSUER_ID:-}"
ASC_KEY_PATH="${ASC_KEY_PATH:-${HOME}/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8}"

grep -q "MARKETING_VERSION: ${version}\$" ios/project.yml \
  || die "MARKETING_VERSION in ios/project.yml non e' ${version}: cambiala nel commit di rilascio"

if [[ ${check} -eq 0 ]]; then git fetch --quiet --tags origin; fi
git rev-parse -q --verify "refs/tags/${tag}" >/dev/null && die "${tag} esiste gia'"
last="$(git tag -l 'ios-*' | sort -V | tail -1)"
if [[ -n "${last}" && "$(printf '%s\n%s\n' "${last}" "${tag}" | sort -V | tail -1)" != "${tag}" ]]; then
  die "${tag} non e' piu' alta dell'ultima (${last})"
fi

[[ -n "${ASC_KEY_ID}" && -n "${ASC_ISSUER_ID}" ]] \
  || die "mancano ASC_KEY_ID e ASC_ISSUER_ID: scrivili in ~/.appstoreconnect/fuorirotta.env (vedi DEPLOYMENT.md, iOS app)"
[[ -f "${ASC_KEY_PATH}" ]] || die "chiave non trovata: ${ASC_KEY_PATH} (scaricala una volta da App Store Connect)"
key_real="$(cd "$(dirname "${ASC_KEY_PATH}")" && pwd -P)/$(basename "${ASC_KEY_PATH}")"
[[ "${key_real}" != "${root}"/* ]] || die "la chiave e' dentro il repo (${key_real}): spostala in ~/.appstoreconnect"
[[ -z "$(git ls-files '*.p8' '*.mobileprovision')" ]] || die "nel repo c'e' un .p8 o un .mobileprovision tracciato: toglilo da git"

command -v xcodegen >/dev/null || die "xcodegen non installato (brew install xcodegen)"
(cd ios && xcodegen generate --quiet)
[[ -z "$(git status --porcelain -- ios/)" ]] \
  || die "il progetto Xcode rigenerato differisce da quello committato: committa ios/ e riprova"

if [[ ${check} -eq 0 ]]; then
  [[ "$(git branch --show-current)" == "main" ]] || die "non sei su main"
  [[ -z "$(git status --porcelain)" ]] || die "ci sono modifiche non committate"
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] \
    || die "main locale e origin/main divergono: fai git pull (o push) prima"
  sha="$(git rev-parse HEAD)"
  ci="$(gh run list --commit "${sha}" --workflow ci.yml --json status,conclusion \
    --jq 'map(select(.status == "completed")) | map(.conclusion) | unique | join(",")')"
  [[ "${ci}" == "success" ]] || die "la CI di ${sha:0:7} non e' verde (${ci:-nessuna esecuzione completata}): aspetta o correggi"
fi

auth=(-allowProvisioningUpdates -authenticationKeyPath "${key_real}"
  -authenticationKeyID "${ASC_KEY_ID}" -authenticationKeyIssuerID "${ASC_ISSUER_ID}")
archive=ios/build/Fuorirotta.xcarchive
export_dir=ios/build/export
rm -rf "${archive}" "${export_dir}"

xcodebuild -project ios/Fuorirotta.xcodeproj -scheme Fuorirotta -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "${archive}" "${auth[@]}" archive \
  || die "archivio fallito"

info="${archive}/Products/Applications/Fuorirotta.app/Info.plist"
base="$(/usr/libexec/PlistBuddy -c 'Print :FRAPIBaseURL' "${info}" 2>/dev/null || true)"
[[ "${base}" == "https://fuori-rotta.it" ]] || die "il binario punta a '${base}', non a https://fuori-rotta.it"
if /usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity' "${info}" >/dev/null 2>&1; then
  die "il binario ha NSAppTransportSecurity: la build Release non deve rilassare la rete (D-10)"
fi

options=ios/ExportOptions.plist
if [[ ${check} -eq 1 ]]; then
  options="$(mktemp -t fuorirotta-export).plist"
  trap 'rm -f "${options}"' EXIT
  cp ios/ExportOptions.plist "${options}"
  /usr/libexec/PlistBuddy -c 'Set :destination export' "${options}"
fi
xcodebuild -exportArchive -archivePath "${archive}" -exportOptionsPlist "${options}" \
  -exportPath "${export_dir}" "${auth[@]}" \
  || die "esportazione fallita"

if [[ ${check} -eq 1 ]]; then
  ls "${export_dir}"/*.ipa >/dev/null || die "nessun .ipa in ${export_dir}"
  echo "release-ios: verifica completata, .ipa in ios/build/export (niente upload, niente tag)"
  exit 0
fi

git tag -a "ios-${version}" -m "ios-${version}"
git push --quiet origin "ios-${version}"
echo "release-ios: ${tag} caricata (${last:-nessuna} -> ${tag}). La build compare in App Store Connect > TestFlight dopo l'elaborazione (10-30 minuti)."
