#!/usr/bin/env bash
# Gate ROLL-07: il ricalcolo della cache dei cluster (lib/clusterCache.ts,
# computeClusterData()/updateClusterCache()) non degrada di un ORDINE DI
# GRANDEZZA al crescere del volume. NON e' un benchmark di prestazione
# assoluta — la macchina di sviluppo non e' quella di produzione — ma un
# rilevatore di regressione (query N+1 introdotta, indice perso).
#
# Misura di riferimento (bash scripts/dev-db.sh, Postgres locale, 2026-09-18,
# vedi 15-06-SUMMARY.md per il dettaglio completo e la metodologia):
#
#   volume REALE locale oggi (eventi futuri canonici con coordinate
#   risolte, idx_events_region_date_start + filtro coordinate):
#     1.791 eventi -> 24-54ms per computeClusterData() (tre run consecutive)
#
#   volume SINTETICO, generato SOLO per misurare la curva di degrado, MAI
#   committato ne' lasciato in tabella (righe con
#   source='__synthetic-cluster-volume-probe__', inserite e cancellate nella
#   stessa sessione di misura):
#     6.791 feature totali ->   94ms
#    16.791 feature totali ->  194ms
#    41.791 feature totali ->  517ms
#    81.791 feature totali ->  930ms
#   Nessun punto di degrado osservato entro ~82.000 feature: la scala resta
#   sub-lineare (una query indicizzata + una findMany dei membri in blocco,
#   nessuna N+1). Il volume nazionale realistico NON e' stato raggiunto sul
#   Postgres locale (SoloSagre nazionale e' generato ma non acceso in
#   produzione — vedi 15-06-SUMMARY.md); questo gate misura una regressione
#   al volume locale REALE di oggi, non una prestazione al volume nazionale.
#
# CAP_MS sotto e' fissato con un margine ampio (~100x il massimo osservato al
# volume reale locale) apposta: deve far scattare una regressione vera, non
# il rumore della macchina di sviluppo.
#
# Prova anche il caso vuoto (a zero eventi futuri computeClusterData()
# restituisce una FeatureCollection vuota, mai un'eccezione): sposta
# temporaneamente ogni evento futuro con coordinate risolte 100 anni nel
# passato (mutazione reversibile, SOLO sul Postgres locale via
# scripts/dev-db.sh, D-17), cattura gli id esatti toccati e li ripristina
# in ogni caso, successo o fallimento — mai una riga toccata resta spostata.
set -euo pipefail

CAP_MS=5000

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

fail() {
  echo "FAIL: $1"
  exit 1
}

if ! docker compose -f "${repo_root}/docker-compose.dev.yml" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

tmp_js="${repo_root}/scripts/.cluster-volume-empty-case.tmp.ts"
cleanup() {
  rm -f "${tmp_js}"
}
trap cleanup EXIT

# --- S1: ricalcolo sul volume locale corrente resta entro il tetto ---------
s1_output="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { computeClusterData } = await import("./lib/clusterCache")
  const t0 = Date.now()
  const geojson = await computeClusterData()
  const ms = Date.now() - t0
  console.log(`MS=${ms}`)
  console.log(`FEATURES=${geojson.features.length}`)
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null)"

s1_ms="$(echo "${s1_output}" | grep '^MS=' | cut -d= -f2)"
s1_features="$(echo "${s1_output}" | grep '^FEATURES=' | cut -d= -f2)"

[[ -n "${s1_ms}" ]] || fail "S1: impossibile leggere il tempo di ricalcolo (output: ${s1_output})"
[[ "${s1_ms}" -le "${CAP_MS}" ]] || fail "S1: ricalcolo della cache dei cluster in ${s1_ms}ms sul volume locale corrente (${s1_features} feature), sopra il tetto di ${CAP_MS}ms"
echo "S1 OK: ricalcolo in ${s1_ms}ms su ${s1_features} feature, entro il tetto di ${CAP_MS}ms (margine ~100x il baseline osservato)"

# --- S2: caso vuoto — zero eventi futuri, nessuna eccezione, righe ---------
# ripristinate esattamente com'erano
# Il confine e' date_trunc('day', now() AT TIME ZONE 'UTC'), NON now(): e' il
# `today` di computeClusterData() (lib/clusterCache.ts, today.setUTCHours(0,0,0,0)).
# Con now() questa sezione spostava solo gli eventi ANCORA a venire e lasciava
# in piedi quelli datati oggi a un'ora gia' passata — che computeClusterData()
# invece conta eccome. Il "caso vuoto" non era quindi vuoto, e l'asserzione
# "0 feature" falliva su un prodotto corretto. Latente finche' il catalogo
# locale non ha avuto eventi datati oggi: si e' manifestato con l'ingest
# dell'Alto Adige (274 righe, 2026-09-19).
before_count="$(docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
  psql -U fuorirotta -d fuorirotta_dev -tAc \
  "SELECT count(*) FROM events WHERE date_start >= date_trunc('day', now() AT TIME ZONE 'UTC') AND canonical_event_id IS NULL AND resolved_latitude IS NOT NULL AND resolved_longitude IS NOT NULL")"

cat > "${tmp_js}" <<'JS'
(async () => {
  const { prisma } = await import('../lib/prisma')
  const { computeClusterData } = await import('../lib/clusterCache')

  // Sposta 100 anni nel passato ogni evento che computeClusterData()
  // conterebbe, cosi' il suo filtro non incontra nulla. Il confine e' lo
  // STESSO che usa lei — date_trunc('day', now() AT TIME ZONE 'UTC'), cioe'
  // il `today` di lib/clusterCache.ts — e non now(): con now() restavano in
  // piedi gli eventi datati oggi a un'ora gia' passata, che lei conta, e il
  // "caso vuoto" non era vuoto.
  // RETURNING id cattura ESATTAMENTE le righe toccate, non un intervallo di
  // date che potrebbe includere righe che questo gate non ha mai spostato.
  const affected = await prisma.$queryRaw`
    UPDATE events
    SET date_start = date_start - interval '100 years'
    WHERE date_start >= date_trunc('day', now() AT TIME ZONE 'UTC')
      AND canonical_event_id IS NULL
      AND resolved_latitude IS NOT NULL AND resolved_longitude IS NOT NULL
    RETURNING id
  `

  let ok = true
  let message = ''
  try {
    const geojson = await computeClusterData()
    if (geojson.features.length !== 0) {
      ok = false
      message = `atteso 0 feature a zero eventi futuri, trovate ${geojson.features.length}`
    } else if (geojson.type !== 'FeatureCollection') {
      ok = false
      message = `atteso type FeatureCollection, trovato ${geojson.type}`
    }
  } catch (err) {
    ok = false
    message = `computeClusterData() ha sollevato: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    // Ripristino SEMPRE, anche sul percorso di fallimento sopra — mai una
    // riga toccata da questo gate resta spostata di 100 anni.
    if (affected.length > 0) {
      const ids = affected.map((r) => r.id)
      await prisma.$executeRaw`UPDATE events SET date_start = date_start + interval '100 years' WHERE id = ANY(${ids})`
    }
  }

  console.log(ok ? 'OK' : `FAIL:${message}`)
  process.exit(ok ? 0 : 1)
})().catch(async (err) => {
  console.error('ERROR: ' + (err instanceof Error ? err.message : String(err)))
  process.exit(1)
})
JS

s2_output=""
s2_exit=0
s2_output="$(bash scripts/dev-db.sh npx tsx "${tmp_js}" 2>&1)" || s2_exit=$?
echo "${s2_output}" | grep -q '^OK$' || fail "S2 (caso vuoto): ${s2_output}"

# Stesso confine di before_count qui sopra e dell'UPDATE: due conteggi che si
# confrontano devono contare la stessa cosa, altrimenti la differenza misura
# il disallineamento fra le due query invece di un ripristino mancato.
after_count="$(docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
  psql -U fuorirotta -d fuorirotta_dev -tAc \
  "SELECT count(*) FROM events WHERE date_start >= date_trunc('day', now() AT TIME ZONE 'UTC') AND canonical_event_id IS NULL AND resolved_latitude IS NOT NULL AND resolved_longitude IS NOT NULL")"
[[ "${before_count}" == "${after_count}" ]] || fail "S2: il conteggio degli eventi futuri prima/dopo il caso vuoto non torna (${before_count} vs ${after_count}) — il ripristino non ha funzionato"

echo "S2 OK: a zero eventi futuri computeClusterData() restituisce una FeatureCollection vuota senza eccezioni; righe ripristinate esattamente (${before_count} invariato)"

echo "PASS: ricalcolo cache dei cluster (ROLL-07) — S1..S2 verdi"
exit 0
