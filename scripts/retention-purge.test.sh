#!/usr/bin/env bash
# Gate della cancellazione degli eventi conclusi (D-RET-01).
#
# Le due asserzioni che contano non sono "cancella le righe vecchie" — quella
# e' la parte facile. Sono:
#
#   S2  un evento COMINCIATO nel passato ma che finisce nel FUTURO e' IN CORSO
#       e non va toccato. Un purge su `date_start` invece che su
#       COALESCE(date_end, date_start) lo cancellerebbe mentre e' ancora in
#       programma: e' il modo piu' facile di sbagliare questa funzione.
#   S3  la FK canonical_event_id e' ON DELETE SET NULL. Cancellare una riga
#       CANONICA mentre un suo duplicato sopravvive azzera il puntatore del
#       duplicato, che torna VISIBILE. Un evento cancellato che ricompare e'
#       peggio di una riga vecchia che resta.
#
# Tutto su righe di prova create e rimosse da questo gate, su un `source`
# dedicato: nessuna riga reale viene mai letta o toccata. Solo Postgres LOCALE
# (scripts/dev-db.sh).
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

failures=()
fail() { failures+=("$1"); echo "FAIL: $1"; }
ok() { echo "ok  $1"; }

test_source="__retention_gate__"
tmp_ts="${repo_root}/retention-gate.tmp.ts"

cleanup() {
  rm -f "${tmp_ts}"
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -c \
    "DELETE FROM events WHERE source = '${test_source}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup  # righe orfane di un giro interrotto

cat > "${tmp_ts}" <<'TS'
import { prisma } from './lib/prisma'
import { purgeConcludedEvents, purgeCutoff, RETENTION_DAYS } from './lib/retention/purge'

const SRC = '__retention_gate__'
const day = 24 * 60 * 60 * 1000

;(async () => {
  const cutoff = purgeCutoff()
  const mk = async (sourceId: string, start: Date, end: Date | null) =>
    (await prisma.event.create({
      data: { title: 'gate ' + sourceId, source: SRC, sourceId, dateStart: start, dateEnd: end }
    })).id

  // A: concluso ben oltre la soglia -> deve sparire
  const vecchio = await mk('vecchio', new Date(cutoff.getTime() - 30 * day), new Date(cutoff.getTime() - 29 * day))
  // B: IN CORSO (iniziato prima della soglia, finisce domani) -> deve restare
  const inCorso = await mk('in-corso', new Date(cutoff.getTime() - 30 * day), new Date(Date.now() + day))
  // C: concluso ma DENTRO la finestra di grazia -> deve restare
  const recente = await mk('recente', new Date(Date.now() - day), new Date(Date.now() - day))
  // D+E: canonico concluso, con duplicato ANCORA IN CORSO che lo referenzia
  const canonico = await mk('canonico', new Date(cutoff.getTime() - 30 * day), new Date(cutoff.getTime() - 29 * day))
  const duplicato = await mk('duplicato', new Date(cutoff.getTime() - 30 * day), new Date(Date.now() + day))
  await prisma.event.update({ where: { id: duplicato }, data: { canonicalEventId: canonico } })

  const report = await purgeConcludedEvents({ onlySource: SRC })

  const vivo = async (id: number) => (await prisma.event.findUnique({ where: { id } })) !== null
  const dupRow = await prisma.event.findUnique({ where: { id: duplicato } })

  console.log(JSON.stringify({
    retentionDays: RETENTION_DAYS,
    cutoff: cutoff.toISOString().slice(0, 10),
    eligible: report.eligible,
    deleted: report.deleted,
    keptAsCanonical: report.keptAsCanonical,
    vecchioSopravvive: await vivo(vecchio),
    inCorsoSopravvive: await vivo(inCorso),
    recenteSopravvive: await vivo(recente),
    canonicoSopravvive: await vivo(canonico),
    duplicatoAncoraAgganciato: dupRow?.canonicalEventId === canonico
  }))
  process.exit(0)
})().catch((e) => { console.error('ERRORE: ' + (e?.message ?? e)); process.exit(1) })
TS

out="$(bash scripts/dev-db.sh npx tsx "${tmp_ts}" 2>&1 | grep -E '^\{' | tail -1)"
if [[ -z "${out}" ]]; then
  echo "FAIL: il gate non ha prodotto output JSON"
  exit 1
fi

get() { node -e "const d=JSON.parse(process.argv[1]); console.log(String(d['$1']))" "${out}"; }

echo "soglia: $(get cutoff) (RETENTION_DAYS=$(get retentionDays))"

# --- S1: un evento concluso oltre la soglia sparisce davvero -----------------
if [[ "$(get vecchioSopravvive)" == "false" ]]; then
  ok "S1: un evento concluso oltre la finestra di grazia viene cancellato"
else
  fail "S1: l'evento concluso da 30 giorni e' ancora in tabella — il purge non cancella"
fi

# --- S2: un evento IN CORSO non si tocca ------------------------------------
if [[ "$(get inCorsoSopravvive)" == "true" ]]; then
  ok "S2: un evento iniziato nel passato ma che finisce domani resta (e' in corso)"
else
  fail "S2: cancellato un evento ANCORA IN CORSO — il filtro guarda date_start invece di COALESCE(date_end, date_start)"
fi

if [[ "$(get recenteSopravvive)" == "true" ]]; then
  ok "S2: un evento concluso ieri resta (dentro la finestra di grazia)"
else
  fail "S2: cancellato un evento concluso ieri — la finestra di grazia di ${RETENTION_DAYS:-7} giorni non viene applicata"
fi

# --- S3: nessuna resurrezione -----------------------------------------------
if [[ "$(get canonicoSopravvive)" == "true" && "$(get duplicatoAncoraAgganciato)" == "true" ]]; then
  ok "S3: un canonico concluso con duplicato vivo NON viene cancellato, e il duplicato resta agganciato"
elif [[ "$(get canonicoSopravvive)" == "false" ]]; then
  fail "S3: cancellato un canonico ancora referenziato — ON DELETE SET NULL ha appena fatto RIAPPARIRE il suo duplicato fra i risultati"
else
  fail "S3: il duplicato ha perso l'aggancio al canonico (canonical_event_id azzerato) — torna visibile come evento a se'"
fi

if [[ "$(get keptAsCanonical)" -ge 1 ]]; then
  ok "S3: la guardia ha contato $(get keptAsCanonical) riga/e risparmiata/e, non e' un ramo morto"
else
  fail "S3: keptAsCanonical vale 0 con un caso costruito apposta — la guardia non e' stata esercitata (prova di non-vacuita')"
fi

echo ""
if [[ ${#failures[@]} -eq 0 ]]; then
  echo "PASS: cancellazione eventi conclusi (S1 cancella, S2 rispetta gli eventi in corso, S3 nessuna resurrezione)"
  exit 0
else
  echo "FAIL: cancellazione eventi conclusi — ${#failures[@]} sezione/i rossa/e"
  exit 1
fi
