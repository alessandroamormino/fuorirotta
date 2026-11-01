#!/usr/bin/env bash
# Compila, installa e avvia l'app sull'iPhone collegato: `bash ios/scripts/run-device.sh [UDID]`.
# SCHEME (default Fuorirotta) e CONFIG (default Debug) si possono cambiare dall'ambiente.
# Niente simulatore (D-03): si prova sempre sul telefono vero.
set -euo pipefail

die() { echo "run-device: $1" >&2; exit "${2:-1}"; }

cd "$(dirname "$0")/../.."
scheme="${SCHEME:-Fuorirotta}"
config="${CONFIG:-Debug}"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

# Il primo iPhone raggiungibile: "udid core_device_id nome". L'UDID serve a xcodebuild, l'altro a devicectl.
pick='
const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).result.devices;
const want = process.argv[2];
const ok = d.find((x) =>
  (want ? [x.hardwareProperties.udid, x.identifier].includes(want) : String(x.hardwareProperties.productType).startsWith("iPhone"))
  && x.connectionProperties.tunnelState !== "unavailable");
if (ok) console.log([ok.hardwareProperties.udid, ok.identifier, ok.deviceProperties.name.replace(/\s+/g, "_")].join(" "));
'
xcrun devicectl list devices --json-output "${tmp}/devices.json" >/dev/null 2>&1 || die "devicectl non risponde"
read -r udid coreid name <<<"$(node -e "${pick}" "${tmp}/devices.json" "${1:-}")" || true
[[ -n "${udid:-}" ]] || die "nessun iPhone collegato (cavo, sblocco, 'Autorizza questo computer')" 3
echo "run-device: ${name//_/ } (${udid}), ${scheme} ${config}"

xcodebuild -project ios/Fuorirotta.xcodeproj -scheme "${scheme}" -configuration "${config}" \
  -destination "id=${udid}" -derivedDataPath ios/build/dd -allowProvisioningUpdates -quiet build

app="ios/build/dd/Build/Products/${config}-iphoneos/Fuorirotta.app"
[[ -d "${app}" ]] || die "app non trovata: ${app}"
xcrun devicectl device install app --device "${coreid}" "${app}"
xcrun devicectl device process launch --terminate-existing --device "${coreid}" it.fuorirotta.app
