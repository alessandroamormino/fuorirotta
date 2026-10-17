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

tmp_ts="${repo_root}/user-data-gate.tmp.ts"

cleanup() {
  rm -f "${tmp_ts}"
  psql_dev "DROP TABLE IF EXISTS __user_data_gate_probe, __user_data_gate_probe_orfana" >/dev/null 2>&1 || true
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
# Solo i nomi delle tabelle figlie, ordinati; e solo quelle SENZA cascata.
child_tables() { psql_dev "${children_sql}" | cut -d'|' -f1 | sort; }
non_cascading() { psql_dev "${children_sql}" | grep -v '|c$' || true; }
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

# --- funzioni condivise da S4/S5/S6 -------------------------------------------
cat > "${tmp_ts}" <<'TS'
import { USER_DATA_REGISTRY } from './lib/userData/registry'

for (const entry of USER_DATA_REGISTRY) console.log(entry.table)
process.exit(0)
TS
registry_tables() { bash scripts/dev-db.sh npx tsx "${tmp_ts}" | sort; }
# Tabelle figlie non registrate (<), tabelle registrate senza FK (>).
registry_diff() { diff <(child_tables) <(registry_tables) || true; }
# Tabelle con una colonna user_id che non sono figlie di auth_user.
orphan_user_id() {
  comm -23 \
    <(psql_dev "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'user_id'" | sort) \
    <(child_tables)
}

# --- S4: il registro coincide con le FK verso auth_user -----------------------
diff_out="$(registry_diff)"
[[ -z "${diff_out}" ]] || fail "S4: registro e FK divergono (< FK senza registro, > registro senza FK)
${diff_out}"
ok "S4: il registro elenca esattamente le tabelle figlie di auth_user"

# --- S5: nessuna colonna user_id senza FK verso auth_user ---------------------
orphans="$(orphan_user_id)"
[[ -z "${orphans}" ]] || fail "S5: tabelle con user_id ma senza FK verso auth_user: ${orphans}"
ok "S5: ogni colonna user_id e' una FK verso auth_user"

# --- S6: prova di non-vacuita' ------------------------------------------------
# Un gate che non puo' fallire non dice nulla: due tabelle sbagliate di
# proposito, una con FK senza cascata e una con user_id e nessuna FK.
psql_dev "CREATE TABLE __user_data_gate_probe (id text PRIMARY KEY, user_id text REFERENCES auth_user(id) ON DELETE NO ACTION)" >/dev/null
psql_dev "CREATE TABLE __user_data_gate_probe_orfana (id text PRIMARY KEY, user_id text)" >/dev/null
seen_non_cascading="$(non_cascading)"
seen_unregistered="$(registry_diff)"
seen_orphan="$(orphan_user_id)"
psql_dev "DROP TABLE __user_data_gate_probe, __user_data_gate_probe_orfana" >/dev/null
[[ "${seen_non_cascading}" == *"__user_data_gate_probe|user_id|a"* ]] || fail "S6: la FK senza cascata non e' stata rilevata"
[[ "${seen_unregistered}" == *"< __user_data_gate_probe"* ]] || fail "S6: la tabella non registrata non e' stata rilevata"
[[ "${seen_orphan}" == *"__user_data_gate_probe_orfana"* ]] || fail "S6: user_id senza FK non e' stato rilevato"
ok "S6: il gate rileva FK senza cascata, tabella non registrata e user_id senza FK"

# --- S7: l'export non seleziona colonne segrete -------------------------------
# Token di sessione e token/password dell'account non devono comparire nel
# codice del registro (commenti esclusi). La foto (image) e' un dato dell'utente
# esportato dalla rotta, non un segreto (D-20).
forbidden_in() {
  sed -E '/^[[:space:]]*(\/\/|\*)/d' | grep -wE 'token|accessToken|refreshToken|idToken|password' || true
}
[[ -n "$(echo 'select: { accessToken: true }' | forbidden_in)" ]] || fail "S7: il controllo non vede un nome vietato (vacuo)"
leaked="$(forbidden_in < lib/userData/registry.ts)"
[[ -z "${leaked}" ]] || fail "S7: colonne segrete nel registro: ${leaked}"
ok "S7: il registro non nomina token ne' password"
