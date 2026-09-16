#!/usr/bin/env bash
# Gate del dettaglio incrementale: saltare la pagina di dettaglio di un evento
# gia' noto deve far risparmiare richieste SENZA cancellare i dati che solo
# quella pagina sa produrre.
#
# Il difetto che questo gate esiste per impedire: `saveEvents` scriveva ogni
# campo a ogni upsert. Con il dettaglio saltato, description/coordinate/telefono
# valgono null, e un update cieco li avrebbe azzerati su TUTTO il catalogo al
# primo scrape incrementale — perdita di dati silenziosa, visibile solo aprendo
# una scheda evento.
#
# Usa una sorgente di prova dedicata (__test_detail__) assente dal registry,
# cosi' non puo' toccare dati reali. Richiede il Postgres locale
# (scripts/dev-db.sh, D-17) — mai il database di produzione.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

test_source="__test_detail__"
export DETAIL_TEST_SOURCE="${test_source}"

fail() {
  echo "FAIL: $1"
  exit 1
}

psql_dev() {
  docker compose -f "${repo_root}/docker-compose.dev.yml" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}

cleanup() {
  psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! docker compose -f "${repo_root}/docker-compose.dev.yml" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

cleanup

# Salva un evento; $1 = 'full' (dettaglio presente) | 'skipped' (dettaglio saltato)
# $2 = titolo, $3 = giorno del mese di dateStart
save_event() {
  DETAIL_TEST_MODE="$1" DETAIL_TEST_TITLE="$2" DETAIL_TEST_DAY="$3" \
  bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { saveEvents } = await import("./lib/scrapers/utils")
  const skipped = process.env.DETAIL_TEST_MODE === "skipped"
  await saveEvents([{
    source: process.env.DETAIL_TEST_SOURCE as string,
    sourceId: "evento-di-prova",
    title: process.env.DETAIL_TEST_TITLE as string,
    description: skipped ? null : "descrizione dalla pagina di dettaglio",
    dateStart: new Date(`2026-11-${process.env.DETAIL_TEST_DAY}T10:00:00Z`),
    dateEnd: new Date(`2026-11-${process.env.DETAIL_TEST_DAY}T18:00:00Z`),
    locationName: skipped ? "Lombardia" : "Teatro Sociale",
    address: skipped ? null : "Via Roma 1, Como (CO)",
    latitude: skipped ? null : 45.81,
    longitude: skipped ? null : 9.08,
    category: "Musica e spettacolo",
    sourceUrl: "https://example.invalid/evento-di-prova",
    imageUrl: skipped ? null : "https://example.invalid/foto.jpg",
    phone: skipped ? null : "031123456",
    ...(skipped ? { detailSkipped: true } : {})
  }])
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' 2>/dev/null
}

field() {
  psql_dev "SELECT coalesce(${1}::text, 'NULL') FROM events WHERE source = '${test_source}' AND source_id = 'evento-di-prova'"
}

# --- S1: primo salvataggio completo, il dettaglio finisce in database --------
save_event full "Concerto d'autunno" 12 >/dev/null
[[ "$(field description)" == "descrizione dalla pagina di dettaglio" ]] || fail "S1: description non salvata al primo giro"
[[ "$(field latitude)" != "NULL" ]] || fail "S1: latitude non salvata al primo giro"
echo "ok  S1: un evento con dettaglio nasce completo in database"

# --- S2: secondo giro con dettaglio SALTATO -> i campi del dettaglio restano -
save_event skipped "Concerto d'autunno (rinviato)" 19 >/dev/null

[[ "$(field description)" == "descrizione dalla pagina di dettaglio" ]] \
  || fail "S2: description CANCELLATA da un salvataggio con dettaglio saltato"
[[ "$(field location_name)" == "Teatro Sociale" ]] \
  || fail "S2: locationName degradato alla versione povera della lista"
[[ "$(field address)" == "Via Roma 1, Como (CO)" ]] || fail "S2: address cancellato"
[[ "$(field latitude)" != "NULL" ]] || fail "S2: latitude cancellata"
[[ "$(field longitude)" != "NULL" ]] || fail "S2: longitude cancellata"
[[ "$(field phone)" == "031123456" ]] || fail "S2: phone cancellato"
[[ "$(field image_url)" != "NULL" ]] || fail "S2: imageUrl cancellato"
echo "ok  S2: con il dettaglio saltato i campi del dettaglio sopravvivono"

# --- S3: ma cio' che viene dalla LISTA si aggiorna comunque -----------------
# E' la ragione per cui un evento saltato viene salvato invece che ignorato:
# una data spostata deve arrivare anche nei giorni senza refresh completo.
[[ "$(field title)" == "Concerto d'autunno (rinviato)" ]] \
  || fail "S3: title NON aggiornato da un salvataggio con dettaglio saltato"
[[ "$(field date_start)" == *"2026-11-19"* ]] \
  || fail "S3: dateStart NON aggiornata (letto '$(field date_start)')"
echo "ok  S3: title e dateStart si aggiornano anche col dettaglio saltato"

# --- S4: prova di non-vacuita' — senza il flag, i campi vengono sovrascritti -
# Se questo passasse anche con detailSkipped, S2 non starebbe provando nulla.
save_event skipped_without_flag "Concerto d'autunno" 12 >/dev/null 2>&1 || true
DETAIL_TEST_MODE="nullify" bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const { saveEvents } = await import("./lib/scrapers/utils")
  await saveEvents([{
    source: process.env.DETAIL_TEST_SOURCE as string,
    sourceId: "evento-di-prova",
    title: "Concerto d\x27autunno",
    description: null, dateStart: new Date("2026-11-12T10:00:00Z"), dateEnd: null,
    locationName: null, address: null, latitude: null, longitude: null,
    category: "Musica e spettacolo", sourceUrl: "https://example.invalid/evento-di-prova",
    imageUrl: null, phone: null
  }])
  process.exit(0)
})().catch((err) => { console.error("ERROR: " + err.message); process.exit(1) })
' >/dev/null 2>&1

[[ "$(field description)" == "NULL" ]] \
  || fail "S4: senza detailSkipped la description NON e' stata sovrascritta — S2 non prova nulla"
echo "ok  S4: senza il flag i campi vengono davvero sovrascritti (S2 non e' vacuo)"

# --- S5: il refresh completo settimanale cade di domenica -------------------
weekday_check="$(npx tsx -e '
import { isFullDetailRefreshDay } from "./lib/scrapers/runner"
const domenica = new Date("2026-09-20T04:00:00Z")
const lunedi = new Date("2026-09-21T04:00:00Z")
console.log(isFullDetailRefreshDay(domenica) && !isFullDetailRefreshDay(lunedi) ? "ok" : "ko")
' 2>/dev/null)"
[[ "${weekday_check}" == "ok" ]] || fail "S5: isFullDetailRefreshDay non distingue domenica dagli altri giorni"
echo "ok  S5: il refresh completo cade di domenica (UTC) e non negli altri giorni"

echo "PASS: dettaglio incrementale — meno richieste, nessun dato cancellato"
