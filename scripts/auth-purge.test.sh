#!/usr/bin/env bash
# Gate della pulizia giornaliera dei dati d'accesso (check:auth-purge,
# test:local) - AUTH-08 retention, D-15.
#
# Cosa prova, su righe di prova create e rimosse da questo gate (marcatore
# __auth_purge_gate__) e solo sul Postgres LOCALE (scripts/dev-db.sh):
#   - un contatore di rate limit con last_request di 10 minuti fa (fuori dalla
#     finestra del throttle) viene cancellato, uno di 1 minuto fa resta; cosi'
#     con il giro quotidiano una riga vive meno di 24 ore, il numero che
#     /privacy dichiara (AUTH_RATE_LIMIT_RETENTION_HOURS)
#   - una sessione scaduta sparisce, una che scade domani resta
#   - una riga di verifica (stato OAuth) scaduta sparisce, una viva resta
#   - dryRun riporta i conteggi idonei e non cancella nulla
#   - le righe NON create dal gate che non sono idonee restano in numero
#     identico (le idonee, per definizione, sono proprio cio' che il job
#     cancella ogni notte: il gate non puo' fingere che non esistano)
#
# L'istante "adesso" e' fissato UNA volta qui (NOW_MS) e passato sia allo SQL
# sia a purgeAuthRows(): due orologi diversi sposterebbero i confini.
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

failures=()
fail() { failures+=("$1"); echo "FAIL: $1"; }
ok() { echo "ok  $1"; }

marker="__auth_purge_gate__"
compose_file="${repo_root}/docker-compose.dev.yml"
tmp_ts="${repo_root}/auth-purge-gate.tmp.ts"

psql_dev() {
  docker compose -f "${compose_file}" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}

cleanup() {
  rm -f "${tmp_ts}"
  # La cancellazione dell'utente porta via le sessioni (FK in cascata).
  psql_dev "DELETE FROM auth_rate_limit WHERE key LIKE '${marker}%'" >/dev/null 2>&1 || true
  psql_dev "DELETE FROM auth_verification WHERE identifier LIKE '${marker}%'" >/dev/null 2>&1 || true
  psql_dev "DELETE FROM auth_session WHERE id LIKE '${marker}%'" >/dev/null 2>&1 || true
  psql_dev "DELETE FROM auth_user WHERE id LIKE '${marker}%'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  echo "FAIL: il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
  exit 1
fi

cleanup  # righe orfane di un giro interrotto

now_ms="$(node -e 'console.log(Date.now())')"
cutoff_minutes=5
cutoff_ms=$((now_ms - cutoff_minutes * 60 * 1000))
ts() { echo "to_timestamp(($now_ms + ($1) * 1000)::numeric / 1000)"; }  # offset in secondi

# --- Fixture -------------------------------------------------------------------
psql_dev "INSERT INTO auth_rate_limit (id, key, count, last_request) VALUES
  ('${marker}rl-old', '${marker}old|/sign-in/social', 3, $((now_ms - 10 * 60 * 1000))),
  ('${marker}rl-fresh', '${marker}fresh|/sign-in/social', 3, $((now_ms - 1 * 60 * 1000)))" >/dev/null \
  || { echo "FAIL: fixture rate limit non inserite"; exit 1; }
psql_dev "INSERT INTO auth_user (id, name, email, updated_at) VALUES
  ('${marker}u1', 'Prova purge', '${marker}@fixture.invalid', now())" >/dev/null \
  || { echo "FAIL: utente di prova non inserito"; exit 1; }
psql_dev "INSERT INTO auth_session (id, expires_at, token, updated_at, user_id) VALUES
  ('${marker}s-expired', $(ts -3600), '${marker}t-expired', now(), '${marker}u1'),
  ('${marker}s-live', $(ts 86400), '${marker}t-live', now(), '${marker}u1')" >/dev/null \
  || { echo "FAIL: sessioni di prova non inserite"; exit 1; }
psql_dev "INSERT INTO auth_verification (id, identifier, value, expires_at, updated_at) VALUES
  ('${marker}v-expired', '${marker}expired', 'x', $(ts -3600), now()),
  ('${marker}v-live', '${marker}live', 'x', $(ts 86400), now())" >/dev/null \
  || { echo "FAIL: righe di verifica di prova non inserite"; exit 1; }

# Righe NON del gate e NON idonee (devono restare identiche), e righe NON del
# gate ma idonee (il dryRun deve contarle: sono parte del conteggio atteso).
other_kept() {
  echo "$(psql_dev "SELECT count(*) FROM auth_rate_limit WHERE key NOT LIKE '${marker}%' AND last_request >= ${cutoff_ms}"),$(psql_dev "SELECT count(*) FROM auth_session WHERE id NOT LIKE '${marker}%' AND expires_at >= $(ts 0)"),$(psql_dev "SELECT count(*) FROM auth_verification WHERE identifier NOT LIKE '${marker}%' AND expires_at >= $(ts 0)")"
}
eligible_all() {
  echo "$(psql_dev "SELECT count(*) FROM auth_rate_limit WHERE last_request < ${cutoff_ms}"),$(psql_dev "SELECT count(*) FROM auth_session WHERE expires_at < $(ts 0)"),$(psql_dev "SELECT count(*) FROM auth_verification WHERE expires_at < $(ts 0)")"
}
fixture_present() {
  # rl-old,rl-fresh,s-expired,s-live,v-expired,v-live come 0/1
  echo "$(psql_dev "SELECT count(*) FROM auth_rate_limit WHERE id = '${marker}rl-old'"),$(psql_dev "SELECT count(*) FROM auth_rate_limit WHERE id = '${marker}rl-fresh'"),$(psql_dev "SELECT count(*) FROM auth_session WHERE id = '${marker}s-expired'"),$(psql_dev "SELECT count(*) FROM auth_session WHERE id = '${marker}s-live'"),$(psql_dev "SELECT count(*) FROM auth_verification WHERE id = '${marker}v-expired'"),$(psql_dev "SELECT count(*) FROM auth_verification WHERE id = '${marker}v-live'")"
}

kept_before="$(other_kept)"
eligible_before="$(eligible_all)"

# --- Chiamata: prima dryRun, poi la cancellazione vera ----------------------------
cat > "${tmp_ts}" <<'TS'
import { prisma } from './lib/prisma'
import { AUTH_RATE_LIMIT_RETENTION_HOURS, purgeAuthRows } from './lib/retention/purgeAuth'

;(async () => {
  const now = new Date(Number(process.env.NOW_MS))
  // MODE=dry: solo l'anteprima (il bash controlla poi che non abbia toccato nulla).
  const dry = await purgeAuthRows({ now, dryRun: true })
  const real = process.env.MODE === 'dry' ? null : await purgeAuthRows({ now })
  console.log(JSON.stringify({ hours: AUTH_RATE_LIMIT_RETENTION_HOURS, dry, real }, (_k, v) => (typeof v === 'bigint' ? Number(v) : v)))
  await prisma.$disconnect()
  process.exit(0)
})().catch((e) => { console.error('ERRORE: ' + (e?.message ?? e)); process.exit(1) })
TS

run_purge() {
  NOW_MS="${now_ms}" MODE="$1" bash scripts/dev-db.sh npx tsx "${tmp_ts}" 2>&1 | grep -E '^\{' | tail -1
}
get() { node -e "const d=JSON.parse(process.argv[1]); const v=$2; console.log(String(v))" "$1"; }

dry_out="$(run_purge dry)"
if [[ -z "${dry_out}" ]]; then
  echo "FAIL: il gate non ha prodotto output JSON (dryRun)"
  exit 1
fi

# --- dry-run: conteggi idonei giusti, nessuna riga cancellata --------------------------
IFS=',' read -r el_rl el_se el_ve <<<"${eligible_before}"
dry_rl="$(get "${dry_out}" 'd.dry.rateLimitDeleted')"
dry_se="$(get "${dry_out}" 'd.dry.sessionsDeleted')"
dry_ve="$(get "${dry_out}" 'd.dry.verificationsDeleted')"
if [[ "${dry_rl},${dry_se},${dry_ve}" == "${el_rl},${el_se},${el_ve}" ]]; then
  ok "dry-run: riporta i conteggi idonei (${el_rl} rate limit, ${el_se} sessioni, ${el_ve} stati di accesso) come lo SQL"
else
  fail "dry-run: conteggi ${dry_rl},${dry_se},${dry_ve} diversi dall'atteso ${el_rl},${el_se},${el_ve}"
fi
if [[ "$(fixture_present)" == "1,1,1,1,1,1" && "$(eligible_all)" == "${eligible_before}" ]]; then
  ok "dry-run: non ha cancellato nulla"
else
  fail "dry-run: ha cancellato righe (fixture $(fixture_present), idonee $(eligible_all) invece di ${eligible_before})"
fi
[[ "$(get "${dry_out}" 'd.hours')" == "24" ]] || fail "AUTH_RATE_LIMIT_RETENTION_HOURS non vale 24"

# --- vera cancellazione -------------------------------------------------------------------
real_out="$(NOW_MS="${now_ms}" MODE=real bash scripts/dev-db.sh npx tsx "${tmp_ts}" 2>&1 | grep -E '^\{' | tail -1)"
if [[ -z "${real_out}" ]]; then
  echo "FAIL: il gate non ha prodotto output JSON (cancellazione)"
  exit 1
fi
[[ "$(get "${real_out}" 'd.real.cutoffMs')" == "${cutoff_ms}" ]] \
  || fail "cutoffMs atteso ${cutoff_ms}, ottenuto $(get "${real_out}" 'd.real.cutoffMs')"

present="$(fixture_present)"
IFS=',' read -r p_rl_old p_rl_fresh p_s_exp p_s_live p_v_exp p_v_live <<<"${present}"
[[ "${p_rl_old}" == "0" && "${p_s_exp}" == "0" && "${p_v_exp}" == "0" ]] \
  && ok "old-deleted: rate limit di 10 minuti fa, sessione scaduta e stato di accesso scaduto cancellati" \
  || fail "old-deleted: righe vecchie ancora presenti (rl-old=${p_rl_old} s-expired=${p_s_exp} v-expired=${p_v_exp})"
[[ "${p_rl_fresh}" == "1" ]] \
  && ok "fresh-kept: il rate limit di 1 minuto fa resta" \
  || fail "fresh-kept: il rate limit di 1 minuto fa e' stato cancellato"
[[ "${p_s_live}" == "1" && "${p_v_live}" == "1" ]] \
  && ok "live-session-kept: la sessione che scade domani e lo stato di accesso vivo restano" \
  || fail "live-session-kept: cancellata una riga viva (s-live=${p_s_live} v-live=${p_v_live})"
[[ "$(eligible_all)" == "0,0,0" ]] \
  && ok "purge: nessuna riga idonea resta nelle tre tabelle" \
  || fail "purge: restano righe idonee ($(eligible_all))"
[[ "$(other_kept)" == "${kept_before}" ]] \
  && ok "untouched-rows: le righe non del gate e non idonee sono identiche (${kept_before})" \
  || fail "untouched-rows: prima ${kept_before}, dopo $(other_kept)"

echo ""
if [[ ${#failures[@]} -eq 0 ]]; then
  echo "PASS: pulizia dei dati d'accesso (vecchi cancellati, freschi e vivi intatti, dry-run senza effetti)"
  exit 0
else
  echo "FAIL: pulizia dei dati d'accesso - ${#failures[@]} controllo/i rosso/i"
  exit 1
fi
