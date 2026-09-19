#!/usr/bin/env bash
# Giro di ingest su TUTTE le sorgenti dichiarate nel registry, contro il
# Postgres LOCALE, con un resoconto per sorgente.
#
# Perche' e' sicuro interromperlo:
#   - saveEvents() (lib/scrapers/utils.ts) fa `prisma.event.upsert` sulla
#     chiave (source, sourceId): rilanciare non duplica mai e non perde
#     niente. Il "ripristino" non e' uno stato salvato da qualche parte, e'
#     una proprieta' della scrittura — per questo qui NON c'e' logica di
#     skip: un secondo giro ricontrolla tutto da capo, com'e' giusto.
#   - il ramo CLI a sorgente singola (`runner.ts <source> --region <slug>`)
#     NON prende il lock di regione, quindi un'interruzione non lascia
#     region_locks appesi da ripulire a mano.
#   - ogni sorgente che fallisce viene registrata e si prosegue con la
#     successiva: un feed rotto non ferma il giro.
#
# Uso:
#   bash scripts/ingest-sweep.sh            # tutte tranne in-lombardia
#   bash scripts/ingest-sweep.sh --with-inlombardia
#   bash scripts/ingest-sweep.sh --only "puglia|puglia"
#
# in-lombardia e' esclusa per default e non per prudenza generica: dichiara
# Crawl-delay 10s in robots.txt E scarica una pagina di dettaglio per evento
# non ancora in cache. Su un catalogo da ~2.400 eventi e' un giro da ore, non
# da minuti. Va lanciata sapendolo.
set -uo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

WITH_INLOMBARDIA=false
ONLY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-inlombardia) WITH_INLOMBARDIA=true; shift ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    *) echo "Argomento sconosciuto: $1" >&2; exit 2 ;;
  esac
done

# Ordine deliberato: prima cio' che costa una richiesta sola, cosi' i numeri
# interessanti arrivano subito e un'interruzione precoce costa poco. Le venti
# righe solosagre condividono UN host: restano in questo unico processo, in
# sequenza, perche' il Crawl-delay e' per host (fix 15-CR02) e due processi
# paralleli lo violerebbero entrambi credendo di rispettarlo.
JOBS=(
  "puglia|"
  "emilia-romagna|"
  "opendata_lombardia|"
  "altoadige|trentino-alto-adige"
)
while IFS= read -r slug; do
  JOBS+=("solosagre|${slug}")
done < <(npx tsx -e '
import { SOURCE_META } from "./lib/scrapers/sources"
const r = (SOURCE_META as any[]).filter(s => s.id === "solosagre").map(s => s.region)
console.log(Array.from(new Set(r)).sort().join("\n"))
')
[[ "${WITH_INLOMBARDIA}" == "true" ]] && JOBS+=("in-lombardia|")

log_dir="${repo_root}/.ingest-sweep"
mkdir -p "${log_dir}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
report="${log_dir}/report-${stamp}.tsv"
printf "sorgente\tregione\tesito\tsecondi\tsalvati\taggiornati\tfuturi_dopo\n" > "${report}"

echo "Giro di ingest — ${#JOBS[@]} sorgenti, log in ${log_dir}/"
echo "Interrompibile in qualunque momento: gli upsert sono idempotenti."
echo ""

futuri_regione() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc \
    "SELECT count(*) FROM events WHERE region = '$1' AND date_start >= date_trunc('day', now() AT TIME ZONE 'UTC') AND canonical_event_id IS NULL" 2>/dev/null | tr -d ' \r' || echo "?"
}

for job in "${JOBS[@]}"; do
  src="${job%%|*}"
  reg="${job#*|}"
  etichetta="${src}${reg:+ (${reg})}"
  if [[ -n "${ONLY}" && "${job}" != "${ONLY}" ]]; then continue; fi

  echo "──> ${etichetta}"
  out="${log_dir}/${src}${reg:+-${reg}}.log"
  t0=$(date +%s)
  if [[ -n "${reg}" ]]; then
    bash scripts/dev-db.sh npx tsx lib/scrapers/runner.ts "${src}" --region "${reg}" > "${out}" 2>&1
  else
    bash scripts/dev-db.sh npx tsx lib/scrapers/runner.ts "${src}" > "${out}" 2>&1
  fi
  rc=$?
  t1=$(date +%s)

  # "N new events saved, M skipped" e' la riga che il runner stampa a fine
  # corsa; se manca (errore prima della persistenza) restano vuoti.
  linea="$(grep -oE '[0-9]+ new events saved, [0-9]+ skipped' "${out}" | tail -1 || true)"
  salvati="$(echo "${linea}" | grep -oE '^[0-9]+' || echo '')"
  aggiornati="$(echo "${linea}" | grep -oE '[0-9]+ skipped' | grep -oE '^[0-9]+' || echo '')"
  regione_effettiva="${reg}"
  [[ -z "${regione_effettiva}" ]] && regione_effettiva="$(grep -oE '\(([a-z-]+)\)' "${out}" | head -1 | tr -d '()' || true)"
  futuri="$(futuri_regione "${regione_effettiva}")"

  # Il codice di uscita del runner NON basta: un adattatore che fallisce il
  # fetch viene registrato in logMetrics come "(error: ...)" e il processo
  # esce comunque 0. Misurato il 2026-09-19 su puglia (catena TLS rotta lato
  # Regione): il primo giro di questo script la segnava "ok". Un resoconto
  # che chiama riuscita una fonte morta e' peggio di nessun resoconto.
  adapter_err="$(grep -oE '\(error: [^)]+\)' "${out}" | head -1 || true)"
  if [[ ${rc} -ne 0 ]]; then
    esito="FALLITA(rc=${rc})"
  elif [[ -n "${adapter_err}" ]]; then
    esito="FALLITA ${adapter_err}"
  else
    esito="ok"
  fi
  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "${src}" "${regione_effettiva}" "${esito}" "$((t1-t0))" "${salvati:-}" "${aggiornati:-}" "${futuri}" >> "${report}"
  echo "    ${esito} in $((t1-t0))s — salvati:${salvati:-?} aggiornati:${aggiornati:-?} futuri in ${regione_effettiva:-?}: ${futuri}"
done

echo ""
echo "Resoconto: ${report}"
column -t -s $'\t' "${report}"
