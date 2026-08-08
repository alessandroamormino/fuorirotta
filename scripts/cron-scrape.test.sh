#!/usr/bin/env bash
# Self-check per scripts/cron-scrape.sh. Nessun framework, nessuna fixture:
# un solo file eseguibile. Non contatta mai un host reale, solo 127.0.0.1
# su una porta effimera.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
cron_script="${script_dir}/cron-scrape.sh"
port="${PORT:-39871}"
secret="test-secret-value-123"

tmp_dir="$(mktemp -d)"
auth_file="${tmp_dir}/auth_header"
server_pid=""

cleanup() {
  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
  fi
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

fail() {
  echo "FAIL: $1"
  exit 1
}

# Scrive un .env con SEGRETO e URL fra doppi apici — e' il caso reale in
# produzione, e la prova che la rimozione degli apici funziona.
write_env() {
  local include_secret="$1"
  {
    if [[ "${include_secret}" == "yes" ]]; then
      printf 'CRON_SECRET="%s"\n' "${secret}"
    fi
    printf 'NEXT_PUBLIC_APP_URL="http://127.0.0.1:%s"\n' "${port}"
  } > "${tmp_dir}/.env"
}

# Avvia un server HTTP effimero che registra l'header Authorization ricevuto
# su file e risponde con il codice HTTP passato come argomento.
start_server() {
  local code="$1"
  rm -f "${auth_file}"
  PORT="${port}" RESPONSE_CODE="${code}" AUTH_HEADER_FILE="${auth_file}" \
    node -e '
      const http = require("http");
      const fs = require("fs");
      const port = process.env.PORT;
      const code = parseInt(process.env.RESPONSE_CODE, 10);
      const authFile = process.env.AUTH_HEADER_FILE;
      const server = http.createServer((req, res) => {
        fs.writeFileSync(authFile, req.headers["authorization"] || "");
        res.writeHead(code);
        res.end();
      });
      server.listen(port, "127.0.0.1");
    ' &
  server_pid=$!

  local attempts=0
  while ! (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; do
    exec 3>&- 2>/dev/null || true
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 50 ]]; then
      fail "server finto sulla porta ${port} non e' partito in tempo"
    fi
    sleep 0.05
  done
  exec 3>&- 2>/dev/null || true
}

stop_server() {
  if [[ -n "${server_pid}" ]]; then
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
  fi
}

# --- Caso 1: risposta 202 ---
write_env yes
start_server 202
set +e
output_case1="$(ENV_FILE="${tmp_dir}/.env" "${cron_script}")"
code_case1=$?
set -e
stop_server

[[ "${code_case1}" -eq 0 ]] || fail "caso 1: atteso exit 0, ottenuto ${code_case1}"
[[ "${output_case1}" == *"http_code=202"* ]] || fail "caso 1: output senza http_code=202 (output: ${output_case1})"
[[ "${output_case1}" != *"${secret}"* ]] || fail "caso 1: il segreto compare su stdout"
auth_received="$(cat "${auth_file}" 2>/dev/null || echo "")"
[[ "${auth_received}" == "Bearer ${secret}" ]] || fail "caso 1: header ricevuto '${auth_received}', atteso 'Bearer ${secret}' senza apici"

# --- Caso 2: risposta 401 ---
start_server 401
set +e
output_case2="$(ENV_FILE="${tmp_dir}/.env" "${cron_script}")"
code_case2=$?
set -e
stop_server

[[ "${code_case2}" -eq 1 ]] || fail "caso 2: atteso exit 1, ottenuto ${code_case2}"
[[ "${output_case2}" == *"http_code=401"* ]] || fail "caso 2: output senza http_code=401 (output: ${output_case2})"
[[ "${output_case2}" == *"FAILED"* ]] || fail "caso 2: output senza etichetta FAILED (output: ${output_case2})"

# --- Caso 3: .env privo del segreto ---
write_env no
set +e
output_case3="$(ENV_FILE="${tmp_dir}/.env" "${cron_script}" 2>/dev/null)"
code_case3=$?
set -e

[[ "${code_case3}" -eq 2 ]] || fail "caso 3: atteso exit 2, ottenuto ${code_case3}"

# --- Caso 4: commenti inline nel .env (regressione WR-01) ---
# Docker Compose rimuove un commento `<spazio>#...` sia da un valore fra
# apici sia da uno nudo; read_env_var deve produrre lo stesso risultato,
# altrimenti lo script e Compose finiscono per usare due segreti diversi.
{
  printf 'CRON_SECRET="%s" # rotated 2026-08-01\n' "${secret}"
  printf 'NEXT_PUBLIC_APP_URL=http://127.0.0.1:%s # local\n' "${port}"
} > "${tmp_dir}/.env"
start_server 202
set +e
output_case4="$(ENV_FILE="${tmp_dir}/.env" "${cron_script}")"
code_case4=$?
set -e
stop_server

[[ "${code_case4}" -eq 0 ]] || fail "caso 4: atteso exit 0, ottenuto ${code_case4} (output: ${output_case4})"
auth_received_case4="$(cat "${auth_file}" 2>/dev/null || echo "")"
[[ "${auth_received_case4}" == "Bearer ${secret}" ]] || fail "caso 4: header ricevuto '${auth_received_case4}', atteso 'Bearer ${secret}' senza commento/apici residui"

# --- Caso 5: connessione fallita (nessun server in ascolto) ---
# Nessun server e' stato riavviato dopo lo stop del caso 4: la porta e'
# chiusa, quindi curl fallisce a livello di connessione (non riceve una
# risposta HTTP) ed esercita il ramo `|| http_code="000"`, distinto dal
# caso 2 (server raggiungibile, risposta non-2xx).
write_env yes
set +e
output_case5="$(ENV_FILE="${tmp_dir}/.env" "${cron_script}" 2>/dev/null)"
code_case5=$?
set -e

[[ "${code_case5}" -eq 1 ]] || fail "caso 5: atteso exit 1, ottenuto ${code_case5}"
[[ "${output_case5}" == *"http_code=000"* ]] || fail "caso 5: output senza http_code=000 (output: ${output_case5})"
[[ "${output_case5}" == *"FAILED"* ]] || fail "caso 5: output senza etichetta FAILED (output: ${output_case5})"

echo "OK"
exit 0
