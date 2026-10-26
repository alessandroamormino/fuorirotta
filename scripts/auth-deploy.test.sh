#!/usr/bin/env bash
# Gate del contratto di rilascio dell'accesso (check:auth-deploy, test:ci).
# Solo file system: gira anche su Ubuntu in CI, nessun database, nessun server.
#
# Cosa fissa (D-17, D-19, 21-RESEARCH Pitfall 3 e 9):
#   D1  l'unica porta pubblicata e' 127.0.0.1:3000:3000 - nginx raggiunge l'app
#       per nome di container, e una porta pubblica lascerebbe a chiunque
#       impostare X-Real-IP e ottenere un secchio di rate limit nuovo
#   D2  i cinque nomi a runtime di Google e i sei di Apple (25-06) stanno sotto `environment` nella forma
#       ${NOME:-...}: il rilascio con l'interruttore spento non vuole segreti
#       sul server, quindi compose non deve abortire se mancano
#   D3  NEXT_PUBLIC_AUTH_ENABLED sta sotto `build.args` (e' inlinato dalla build)
#   D4  nessun segreto (anche APPLE_PRIVATE_KEY_B64) fra gli argomenti di build ne' come ARG nel
#       Dockerfile: un ARG resta leggibile nei metadati dell'immagine
#   D5  il Dockerfile ha ARG ed ENV di NEXT_PUBLIC_AUTH_ENABLED
#   D6  .env.example elenca i sei nomi dell'accesso e i sei di Apple
#   D7  la riga di CRON_SECRET conserva la forma `:?` (deve abortire se manca)
#
# Regola della TAB letterale: niente `\t` nei grep (BSD e GNU differiscono),
# solo classi [[:space:]]. Dove un grep puo' legittimamente non trovare nulla
# c'e' `|| true`.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

compose="docker-compose.yml"
dockerfile="Dockerfile"
env_example=".env.example"

fail() {
  echo "FAIL: $1"
  exit 1
}

for f in "${compose}" "${dockerfile}" "${env_example}"; do
  [[ -f "${f}" ]] || fail "${f} non esiste"
done

# block <file> <chiave>: le righe annidate sotto la prima riga `<chiave>:` (il
# blocco finisce alla prima riga non vuota con indentazione minore o uguale).
block() {
  awk -v key="$2" '
    !inb && $0 ~ ("^[[:space:]]*" key ":[[:space:]]*$") { match($0, /^[[:space:]]*/); ind = RLENGTH; inb = 1; next }
    inb {
      if ($0 ~ /^[[:space:]]*$/) next
      match($0, /^[[:space:]]*/)
      if (RLENGTH <= ind) { inb = 0; next }
      print
    }' "$1"
}

# Righe senza commenti, per non confondere un commento con la configurazione.
uncommented() { grep -vE '^[[:space:]]*#' || true; }

ports="$(block "${compose}" ports | uncommented)"
environment="$(block "${compose}" environment | uncommented)"
build_args="$(block "${compose}" args | uncommented)"

[[ -n "${ports}" ]] || fail "D1: nessun blocco ports nel ${compose}"
[[ -n "${environment}" ]] || fail "D2: nessun blocco environment nel ${compose}"
[[ -n "${build_args}" ]] || fail "D3: nessun blocco build.args nel ${compose}"

# --- D1 ------------------------------------------------------------------------
port_count="$(printf '%s\n' "${ports}" | grep -cE '^[[:space:]]*-' || true)"
loopback_count="$(printf '%s\n' "${ports}" | grep -cE '^[[:space:]]*-[[:space:]]*"127\.0\.0\.1:3000:3000"[[:space:]]*$' || true)"
[[ "${port_count}" == "1" && "${loopback_count}" == "1" ]] \
  || fail "D1: l'unica porta pubblicata deve essere \"127.0.0.1:3000:3000\"; trovate: $(printf '%s' "${ports}" | tr -s ' \n' ' ')"
other_3000="$(grep -vE '^[[:space:]]*#' "${compose}" | grep -E '3000' | grep -vE '127\.0\.0\.1:3000:3000|NEXT_PUBLIC_APP_URL' || true)"
[[ -z "${other_3000}" ]] || fail "D1: un'altra riga nomina la porta 3000: ${other_3000}"
echo "ok  D1: l'unica porta pubblicata e' 127.0.0.1:3000:3000"

# --- D2 ------------------------------------------------------------------------
for name in AUTH_ENABLED BETTER_AUTH_URL BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
  APPLE_AUTH_ENABLED APPLE_CLIENT_ID APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY_B64 APPLE_APP_BUNDLE_ID; do
  printf '%s\n' "${environment}" | grep -qE "^[[:space:]]*${name}:[[:space:]]*\\\$\\{${name}:-[^}]*\\}[[:space:]]*\$" \
    || fail "D2: ${name} non e' sotto environment nella forma \${${name}:-...}"
done
printf '%s\n' "${environment}" | grep -qE '^[[:space:]]*AUTH_ENABLED:[[:space:]]*\$\{AUTH_ENABLED:-false\}[[:space:]]*$' \
  || fail "D2: AUTH_ENABLED deve avere default false"
printf '%s\n' "${environment}" | grep -qE '^[[:space:]]*APPLE_AUTH_ENABLED:[[:space:]]*\$\{APPLE_AUTH_ENABLED:-false\}[[:space:]]*$' \
  || fail "D2: APPLE_AUTH_ENABLED deve avere default false"
echo "ok  D2: gli undici nomi a runtime (Google e Apple) sono sotto environment con default :-"

# --- D3 ------------------------------------------------------------------------
printf '%s\n' "${build_args}" | grep -qE '^[[:space:]]*NEXT_PUBLIC_AUTH_ENABLED:[[:space:]]*\$\{NEXT_PUBLIC_AUTH_ENABLED:-[^}]*\}' \
  || fail "D3: NEXT_PUBLIC_AUTH_ENABLED non e' sotto build.args con default vuoto"
echo "ok  D3: NEXT_PUBLIC_AUTH_ENABLED e' un argomento di build"

# --- D4 ------------------------------------------------------------------------
for secret in BETTER_AUTH_SECRET GOOGLE_CLIENT_SECRET APPLE_PRIVATE_KEY_B64; do
  if printf '%s\n' "${build_args}" | grep -q "${secret}"; then
    fail "D4: ${secret} compare sotto build.args"
  fi
  if grep -E "^[[:space:]]*ARG[[:space:]]+${secret}" "${dockerfile}" >/dev/null; then
    fail "D4: ${secret} e' un ARG del ${dockerfile}"
  fi
done
echo "ok  D4: nessun segreto fra gli argomenti di build ne' come ARG"

# --- D5 ------------------------------------------------------------------------
grep -qE '^ARG NEXT_PUBLIC_AUTH_ENABLED[[:space:]]*$' "${dockerfile}" \
  || fail "D5: manca ARG NEXT_PUBLIC_AUTH_ENABLED nel ${dockerfile}"
grep -qE '^ENV NEXT_PUBLIC_AUTH_ENABLED=\$NEXT_PUBLIC_AUTH_ENABLED[[:space:]]*$' "${dockerfile}" \
  || fail "D5: manca ENV NEXT_PUBLIC_AUTH_ENABLED=\$NEXT_PUBLIC_AUTH_ENABLED nel ${dockerfile}"
echo "ok  D5: il Dockerfile ha ARG ed ENV di NEXT_PUBLIC_AUTH_ENABLED"

# --- D6 ------------------------------------------------------------------------
for name in AUTH_ENABLED NEXT_PUBLIC_AUTH_ENABLED BETTER_AUTH_URL BETTER_AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET \
  APPLE_AUTH_ENABLED APPLE_CLIENT_ID APPLE_TEAM_ID APPLE_KEY_ID APPLE_PRIVATE_KEY_B64 APPLE_APP_BUNDLE_ID; do
  grep -qE "^${name}=" "${env_example}" || fail "D6: ${name}= manca da ${env_example}"
done
echo "ok  D6: .env.example elenca i dodici nomi"

# --- D7 ------------------------------------------------------------------------
printf '%s\n' "${environment}" | grep -qE '^[[:space:]]*CRON_SECRET:[[:space:]]*\$\{CRON_SECRET:\?[^}]*\}' \
  || fail "D7: CRON_SECRET ha perso la forma :? (deve abortire compose se manca)"
echo "ok  D7: CRON_SECRET conserva la forma :?"

echo ""
echo "PASS: contratto di rilascio dell'accesso (D1-D7)"
