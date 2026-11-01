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
# una data spostata deve arrivare anche nei giorni in cui il suo dettaglio non e' in scadenza.
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

# --- S5: ogni URL ha un giorno fisso e i 7 giorni sono bilanciati ----------
# Puro: nessuna riga scritta. Il valore fissato (5) cambia solo se cambia la
# formula, e allora cambia il giorno di refresh di ogni evento gia' in cache.
weekday_check="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const mod = await import("./lib/scrapers/runner")
  const m = mod.default ?? mod
  const esempio = "https://www.in-lombardia.it/it/eventi-in-lombardia/esempio"
  const a = m.detailRefreshWeekday(esempio)
  const b = m.detailRefreshWeekday(esempio)
  if (a !== 5 || b !== 5) { console.log(`ko: esempio vale ${a}/${b}, atteso 5`); process.exit(0) }
  const conteggi = [0, 0, 0, 0, 0, 0, 0]
  for (let i = 0; i < 7000; i++) {
    const d = m.detailRefreshWeekday(`https://www.in-lombardia.it/it/eventi-in-lombardia/evento-${i}`)
    if (!(d >= 0 && d <= 6)) { console.log(`ko: giorno fuori da 0..6 (${d})`); process.exit(0) }
    conteggi[d]++
  }
  const sbilanciato = conteggi.some(c => c < 850 || c > 1150)
  console.log(sbilanciato ? `ko: conteggi ${conteggi.join(",")}` : "ok")
  process.exit(0)
})().catch((err) => { console.log("ko: " + err.message); process.exit(0) })
' 2>/dev/null)"
[[ "${weekday_check}" == "ok" ]] || fail "S5: detailRefreshWeekday non e' stabile o bilanciato (${weekday_check})"
echo "ok  S5: ogni URL ha un giorno fisso (valore fissato), i 7 giorni sono bilanciati"

# --- S6: nel suo giorno una URL in cache esce dal set --------------------------
# Giorni UTC dal 2026-11-01 (domenica, 0): spalmato-1 -> 0, -2 -> 1, -3 -> 2.
slice_check="$(bash scripts/dev-db.sh npx tsx -e '
(async () => {
  const utils = await import("./lib/scrapers/utils")
  const runner = await import("./lib/scrapers/runner")
  const { saveEvents } = utils.default ?? utils
  const { detailCachedUrls } = runner.default ?? runner
  const src = process.env.DETAIL_TEST_SOURCE as string
  const urls = [1, 2, 3].map(n => `https://example.invalid/spalmato-${n}`)
  await saveEvents(urls.map((sourceUrl, i) => ({
    source: src,
    sourceId: `spalmato-${i + 1}`,
    title: `Evento spalmato ${i + 1}`,
    description: "descrizione dalla pagina di dettaglio",
    dateStart: new Date("2026-12-10T10:00:00Z"),
    dateEnd: new Date("2026-12-10T18:00:00Z"),
    locationName: "Teatro Sociale",
    address: "Via Roma 1, Como (CO)",
    latitude: 45.81,
    longitude: 9.08,
    category: "Musica e spettacolo",
    sourceUrl,
    imageUrl: null,
    phone: null
  })))
  const domenica = await detailCachedUrls(src, new Date("2026-11-01T04:00:00Z"))
  if (domenica.has(urls[0]) || !domenica.has(urls[1]) || !domenica.has(urls[2])) {
    console.log("ko: domenica 2026-11-01"); process.exit(0)
  }
  const lunedi = await detailCachedUrls(src, new Date("2026-11-02T04:00:00Z"))
  if (lunedi.has(urls[1]) || !lunedi.has(urls[0]) || !lunedi.has(urls[2])) {
    console.log("ko: lunedi 2026-11-02"); process.exit(0)
  }
  const mancanze = urls.map(() => 0)
  for (let g = 1; g <= 7; g++) {
    const set = await detailCachedUrls(src, new Date(`2026-11-0${g}T04:00:00Z`))
    urls.forEach((u, i) => { if (!set.has(u)) mancanze[i]++ })
  }
  console.log(mancanze.every(n => n === 1) ? "ok" : `ko: assenze nei 7 giorni ${mancanze.join(",")}`)
  process.exit(0)
})().catch((err) => { console.log("ko: " + err.message); process.exit(0) })
' 2>/dev/null | tail -n 1)"
[[ "${slice_check}" == "ok" ]] || fail "S6: la fetta in scadenza non esce dal set (${slice_check})"
echo "ok  S6: nel suo giorno una URL in cache esce dal set e viene riscaricata, negli altri sei resta"

echo "PASS: dettaglio incrementale — meno richieste, nessun dato cancellato, refresh spalmato sui 7 giorni"
