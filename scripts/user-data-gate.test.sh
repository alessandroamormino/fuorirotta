#!/usr/bin/env bash
# Gate dei dati dell'utente (check:user-data, test:local).
#
# Tiene l'invariante di tutta la milestone v3.0: ogni tabella che appartiene a
# un utente ha una FK verso auth_user con ON DELETE CASCADE, quindi cancellare
# l'account e' TOTALE per costruzione e non per memoria di chi rivede il codice.
#
# La cascata e' provata con un DELETE diretto sul genitore (S3), non passando
# dalla cancellazione della libreria: e' la garanzia che vale anche per le
# tabelle che le fasi successive aggiungeranno, indipendentemente dall'ordine
# con cui qualcuno le cancella.
#
# Solo Postgres LOCALE (docker compose postgres-dev). Righe di prova sull'id
# `__user_data_gate__`, rimosse prima e all'uscita.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
compose_file="${repo_root}/docker-compose.dev.yml"
cd "${repo_root}"

fail() { echo "FAIL: $1"; exit 1; }
ok() { echo "ok  $1"; }

psql_dev() {
  docker compose -f "${compose_file}" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}

fixture="__user_data_gate__"

cleanup() {
  psql_dev "DELETE FROM auth_user WHERE id = '${fixture}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

cleanup  # righe orfane di un giro interrotto

# --- S1: esattamente le cinque tabelle auth_* ----------------------------------
tables="$(psql_dev "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'auth\_%' ORDER BY 1")"
expected="auth_account
auth_rate_limit
auth_session
auth_user
auth_verification"
[[ "${tables}" == "${expected}" ]] || fail "S1: tabelle auth_* attese
${expected}
trovate
${tables}"
ok "S1: le cinque tabelle auth_* esistono"

# --- S2: figli di auth_user e comportamento alla cancellazione -----------------
# Una riga per figlio: tabella|colonna|confdeltype ('c' = CASCADE).
children_sql="SELECT c.conrelid::regclass::text || '|' || a.attname || '|' || c.confdeltype::text
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
WHERE c.contype = 'f' AND c.confrelid = 'public.auth_user'::regclass ORDER BY 1"
children="$(psql_dev "${children_sql}")"
expected="auth_account|user_id|c
auth_session|user_id|c"
[[ "${children}" == "${expected}" ]] || fail "S2: figli di auth_user attesi
${expected}
trovati
${children}"
ok "S2: auth_session e auth_account puntano ad auth_user con ON DELETE CASCADE"

# --- S3: cancellare il genitore svuota i figli, senza ordine -------------------
psql_dev "INSERT INTO auth_user (id, name, email, updated_at) VALUES ('${fixture}', 'gate', 'gate@user-data.invalid', now())" >/dev/null
psql_dev "INSERT INTO auth_session (id, expires_at, token, updated_at, user_id) VALUES ('${fixture}', now() + interval '1 day', '${fixture}', now(), '${fixture}')" >/dev/null
psql_dev "INSERT INTO auth_account (id, account_id, provider_id, user_id, updated_at) VALUES ('${fixture}', '${fixture}', 'google', '${fixture}', now())" >/dev/null
psql_dev "DELETE FROM auth_user WHERE id = '${fixture}'" >/dev/null
left="$(psql_dev "SELECT (SELECT count(*) FROM auth_session WHERE user_id = '${fixture}') + (SELECT count(*) FROM auth_account WHERE user_id = '${fixture}')")"
[[ "${left}" == "0" ]] || fail "S3: dopo il DELETE di auth_user restano ${left} righe figlie"
ok "S3: il DELETE diretto di auth_user non lascia righe in auth_session ne' auth_account"
