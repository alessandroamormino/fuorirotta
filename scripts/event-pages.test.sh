#!/usr/bin/env bash
# Gate delle pagine evento della Fase 20: dev server effimero sul Postgres
# LOCALE (scripts/dev-db.sh, mai produzione) con eventi di prova scritti nei
# DUE formati con cui le sorgenti salvano le date, poi asserzioni sull'HTML
# renderizzato. E' l'unico gate con dev server di questa fase: i piani 20-04,
# 20-05 e 20-06 aggiungono qui fixture e sezioni.
#
# Perche' esiste: il DB locale e' nel formato di Roma (22:00Z/21:59Z), la
# produzione nel formato UTC (00:00Z/23:59:59.999Z). Una pagina vera con dati
# nel formato di produzione e' l'unico modo di vedere, da un Mac, il difetto
# dell'evento 1100954 (un giorno mostrato come due). "Verde in locale non dice
# nulla" se i dati di prova sono tutti nel formato di Roma.
#
# Fixture (sorgente '__test_event_pages__', cancellata prima e dopo):
#   F1  formato UTC, un giorno      2027-03-28 (cambio ora legale)
#   F2  formato UTC, intervallo     2027-04-10 -> 2027-04-11
#   F3  formato Roma, un giorno     2027-04-21
#   F4  formato UTC, fine a mezzanotte 2027-05-12
#   F5  formato UTC, un giorno, con source_url   2027-06-05 (canonica per F6)
#   F6  riga membro di F5 (canonical_event_id = F5)
#   F7  titolo con CR LF + END:VEVENT + una proprieta' extra (iniezione nel .ics)
#   F8  formato UTC, un giorno PASSATO 2025-01-10 (nessun bottone calendario)
#   F9  senza immagine ne' descrizione, 'Sagre e feste', comune Vigolzone, 2027-06-05
#   F10 con immagine della fonte (https://example.invalid/foto.jpg)
#   F11 senza immagine, titolo con emoji, cirillico e 150 caratteri
#
# Le colonne sono "timestamp without time zone": le cifre scritte qui sono
# l'istante UTC memorizzato.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (stessa lezione WR-05 di
# scripts/comuni-search.test.sh): un PORT esportato dalla shell farebbe
# uccidere da stop_server il dev server dello sviluppatore.
port="${EVENT_PAGES_TEST_PORT:-39884}"

# Il lock di `next dev` e' per-distDir: un distDir separato permette di girare
# anche con `npm run dev:local` gia' attivo su :3000.
test_dist_dir=".next-event-pages-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

test_source="__test_event_pages__"
compose_file="${repo_root}/docker-compose.dev.yml"
# La versione della card si legge da lib/og/brand.ts: il restyling la incrementa.
og_version="$(grep -oE 'OG_VERSION = [0-9]+' "${repo_root}/lib/og/brand.ts" | grep -oE '[0-9]+$')"
[[ "${og_version}" =~ ^[0-9]+$ ]] || { echo "FAIL: OG_VERSION non trovato in lib/og/brand.ts"; exit 1; }

tmp_dir="$(mktemp -d)"
server_pid=""

fail() {
  echo "FAIL: $1"
  exit 1
}

psql_dev() {
  docker compose -f "${compose_file}" exec -T postgres-dev \
    psql -U fuorirotta -d fuorirotta_dev -tAc "$1"
}

wait_for_port() {
  local target_port="$1"
  local attempts=0
  while ! (exec 3<>"/dev/tcp/127.0.0.1/${target_port}") 2>/dev/null; do
    exec 3>&- 2>/dev/null || true
    attempts=$((attempts + 1))
    if [[ "${attempts}" -ge 150 ]]; then
      fail "porta ${target_port} non ha risposto entro il timeout"
    fi
    sleep 0.1
  done
  exec 3>&- 2>/dev/null || true
}

stop_server() {
  if [[ -n "${server_pid}" ]]; then
    # `next dev` spawna figli non sempre raggiungibili da un kill sul pid:
    # pkill -P prova l'albero, lsof sulla porta e' la rete di sicurezza.
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
    # Dentro il guard su server_pid: solo se QUESTO script ha avviato un
    # server ha senso riprendersi la porta con kill -9 (WR-05).
    lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

cleanup() {
  stop_server
  psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null 2>&1 || true
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

psql_dev "DELETE FROM events WHERE source = '${test_source}'" >/dev/null

# insert_event <source_id> <titolo> <date_start> <date_end> -> stampa l'id
insert_event() {
  psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, location_name, canonical_category)
            VALUES ('${test_source}', '$1', '$2', '$3', '$4', 'Piazza di prova', 'Musica e spettacolo')
            RETURNING id" | head -n 1
}

F1="$(insert_event f1 'Prova un giorno formato UTC' '2027-03-28 00:00:00' '2027-03-28 23:59:59.999')"
F2="$(insert_event f2 'Prova intervallo formato UTC' '2027-04-10 00:00:00' '2027-04-11 23:59:59.999')"
F3="$(insert_event f3 'Prova un giorno formato Roma' '2027-04-20 22:00:00' '2027-04-21 21:59:59.999')"
F4="$(insert_event f4 'Prova fine a mezzanotte UTC' '2027-05-12 00:00:00' '2027-05-12 00:00:00')"
F5="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, location_name, canonical_category, source_url)
                VALUES ('${test_source}', 'f5', 'Prova canonica con fonte', '2027-06-05 00:00:00', '2027-06-05 23:59:59.999', 'Piazza di prova', 'Musica e spettacolo', 'https://example.invalid/f5')
                RETURNING id" | head -n 1)"
F6="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, location_name, canonical_category, canonical_event_id)
                VALUES ('${test_source}', 'f6', 'Prova membro', '2027-06-05 00:00:00', '2027-06-05 23:59:59.999', 'Piazza di prova', 'Musica e spettacolo', ${F5})
                RETURNING id" | head -n 1)"
# F7: il titolo e' costruito in SQL con escape E'' (CR = \r, LF = \n).
F7="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, location_name, canonical_category)
                VALUES ('${test_source}', 'f7', E'Titolo normale\\r\\nEND:VEVENT\\r\\nATTENDEE:mailto:x@example.invalid', '2027-07-10 00:00:00', '2027-07-10 23:59:59.999', 'Piazza di prova', 'Musica e spettacolo')
                RETURNING id" | head -n 1)"
F8="$(insert_event f8 'Prova evento concluso' '2025-01-10 00:00:00' '2025-01-10 23:59:59.999')"
# F9: comune_id da sottoquery per nome; NULL se il comune non c'e' nel DB locale.
F9="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, location_name, canonical_category, comune_id)
                VALUES ('${test_source}', 'f9', 'Prova senza immagine', '2027-06-05 00:00:00', '2027-06-05 23:59:59.999', 'Piazza di prova', 'Sagre e feste', (SELECT id FROM comuni WHERE name = 'Vigolzone' LIMIT 1))
                RETURNING id" | head -n 1)"
F10="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, location_name, canonical_category, image_url)
                 VALUES ('${test_source}', 'f10', 'Prova con immagine della fonte', '2027-06-06 00:00:00', '2027-06-06 23:59:59.999', 'Piazza di prova', 'Sagre e feste', 'https://example.invalid/foto.jpg')
                 RETURNING id" | head -n 1)"
# F11: il titolo e' costruito in SQL (emoji e cirillico con escape unicode, 150 caratteri).
F11="$(psql_dev "INSERT INTO events (source, source_id, title, date_start, date_end, location_name, canonical_category)
                 VALUES ('${test_source}', 'f11', E'Sagra \\U0001F355 \\u041f\\u0440\\u0438\\u0432\\u0435\\u0442 del tortello ' || repeat('lunghissimo ', 11), '2027-06-07 00:00:00', '2027-06-07 23:59:59.999', 'Piazza di prova', 'Sagre e feste')
                 RETURNING id" | head -n 1)"
for id in "${F1}" "${F2}" "${F3}" "${F4}" "${F5}" "${F6}" "${F7}" "${F8}" "${F9}" "${F10}" "${F11}"; do
  [[ "${id}" =~ ^[0-9]+$ ]] || fail "fixture non inserita (id ottenuto: '${id}')"
done
echo "ok  fixture inserite (F1=${F1} F2=${F2} F3=${F3} F4=${F4} F5=${F5} F6=${F6} F7=${F7} F8=${F8} F9=${F9} F10=${F10} F11=${F11})"

# --- Dev server effimero, Postgres locale reale -----------------------------
bash scripts/dev-db.sh npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# fetch_page <id> -> scrive l'HTML in ${tmp_dir}/page-<id>.html. Una sola
# richiesta per pagina: la prima compilazione e' lenta, da qui --max-time 60.
fetch_page() {
  local code
  code="$(curl -s -o "${tmp_dir}/page-$1.html" -w '%{http_code}' --max-time 60 "http://127.0.0.1:${port}/eventi/$1")"
  [[ "${code}" == "200" ]] || fail "GET /eventi/$1: atteso 200, ottenuto ${code}"
}

fetch_page "${F1}"
fetch_page "${F2}"
fetch_page "${F3}"
fetch_page "${F4}"

# --- S1: un giorno, formato UTC: riga Quando col giorno lungo, non il vecchio intervallo
page="${tmp_dir}/page-${F1}.html"
grep -qF "28 marzo 2027" "${page}" || fail "S1: la riga Quando di F1 non contiene '28 marzo 2027'"
if grep -qF "28 mar – 29 mar" "${page}"; then
  fail "S1: F1 mostra ancora '28 mar – 29 mar' (un giorno letto come due)"
fi
echo "ok  S1: F1 (formato UTC, un giorno) mostra 28 marzo 2027 e non un intervallo"

# --- S2: intervallo UTC, "Quando" mostra 10 apr – 11 apr, non il vecchio 12 --
page="${tmp_dir}/page-${F2}.html"
grep -qF "10 apr – 11 apr" "${page}" || fail "S2: la riga Quando di F2 non contiene '10 apr – 11 apr'"
if grep -qF "10 apr – 12 apr" "${page}"; then
  fail "S2: F2 mostra ancora '10 apr – 12 apr' (la fine 23:59:59.999Z letta come giorno dopo)"
fi
echo "ok  S2: F2 (formato UTC, intervallo) mostra 10 apr – 11 apr"

# --- S3: un giorno, formato Roma (22:00Z -> 21:59:59.999Z) ------------------
grep -qF "21 aprile 2027" "${tmp_dir}/page-${F3}.html" || fail "S3: la riga Quando di F3 non contiene '21 aprile 2027'"
echo "ok  S3: F3 (formato Roma, un giorno) mostra 21 aprile 2027"

# --- S4: fine a mezzanotte UTC ----------------------------------------------
grep -qF "12 maggio 2027" "${tmp_dir}/page-${F4}.html" || fail "S4: la riga Quando di F4 non contiene '12 maggio 2027'"
echo "ok  S4: F4 (fine a mezzanotte UTC) mostra 12 maggio 2027"

# --- S5: dati strutturati: giorni di calendario, non istanti ----------------
page="${tmp_dir}/page-${F1}.html"
grep -qF '"startDate":"2027-03-28"' "${page}" || fail "S5: il JSON-LD di F1 non ha startDate 2027-03-28"
grep -qF '"endDate":"2027-03-28"' "${page}" || fail "S5: il JSON-LD di F1 non ha endDate 2027-03-28"
echo "ok  S5: JSON-LD di F1 con startDate e endDate 2027-03-28"

# --- .ics (CAL-01): un file per evento, giorni interi, anonimo ---------------
# Controlli sui byte con node -e: grep tratta CR e tab in modo diverso tra
# macOS e Node 24 su Linux (CI), node no.
#
# fetch_ics <nome> <percorso> -> ${tmp_dir}/<nome>.h (header), <nome>.b (corpo);
# stampa il codice HTTP. Niente -L: i redirect si guardano, non si seguono.
fetch_ics() {
  curl -s -D "${tmp_dir}/$1.h" -o "${tmp_dir}/$1.b" -w '%{http_code}' --max-time 60 "http://127.0.0.1:${port}$2"
}
# header <nome> <header> -> valore (minuscolo il nome, CR tolto)
header() {
  grep -i "^$2:" "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r'
}

# --- S6: F1 scaricabile, intestazioni e giorni giusti (esclusivo) -------------
code="$(fetch_ics ics-f1 "/api/events/${F1}/ics")"
[[ "${code}" == "200" ]] || fail "S6: GET /api/events/${F1}/ics: atteso 200, ottenuto ${code}"
[[ "$(header ics-f1 content-type)" == text/calendar* ]] || fail "S6: content-type non text/calendar: '$(header ics-f1 content-type)'"
header ics-f1 content-type | grep -qi "charset=utf-8" || fail "S6: manca charset=utf-8 nel content-type"
disp="$(header ics-f1 content-disposition)"
[[ "${disp}" == inline* ]] || fail "S6: content-disposition non inline: '${disp}'"
[[ "${disp}" == *"filename=\"fuorirotta-${F1}.ics\""* ]] || fail "S6: filename atteso fuorirotta-${F1}.ics, ottenuto '${disp}'"
[[ "$(header ics-f1 cache-control)" == "public, max-age=600" ]] || fail "S6: cache-control atteso 'public, max-age=600', ottenuto '$(header ics-f1 cache-control)'"
for needle in "BEGIN:VCALENDAR" "DTSTART;VALUE=DATE:20270328" "DTEND;VALUE=DATE:20270329"; do
  grep -qF "${needle}" "${tmp_dir}/ics-f1.b" || fail "S6: il corpo di F1 non contiene '${needle}'"
done
echo "ok  S6: .ics di F1 (200, text/calendar, inline, 20270328 -> 20270329 esclusivo)"

# --- S7: solo CRLF, righe fino a 75 ottetti ----------------------------------
node -e '
const b = require("fs").readFileSync(process.argv[1]);
const s = b.toString("latin1");
if (/(^|[^\r])\n/.test(s)) { console.error("LF nudo"); process.exit(1) }
if (/\r(?!\n)/.test(s)) { console.error("CR nudo"); process.exit(1) }
const longest = Math.max(...b.toString("utf8").split("\r\n").map(l => Buffer.byteLength(l)));
if (longest > 75) { console.error("riga di " + longest + " ottetti"); process.exit(1) }
' "${tmp_dir}/ics-f1.b" || fail "S7: il .ics di F1 non e' solo-CRLF con righe da 75 ottetti al massimo"
echo "ok  S7: .ics di F1 solo CRLF, nessuna riga oltre 75 ottetti"

# --- S8: intervallo UTC, la fine e' il giorno dopo l'ultimo -------------------
code="$(fetch_ics ics-f2 "/api/events/${F2}/ics")"
[[ "${code}" == "200" ]] || fail "S8: GET /api/events/${F2}/ics: atteso 200, ottenuto ${code}"
grep -qF "DTEND;VALUE=DATE:20270412" "${tmp_dir}/ics-f2.b" || fail "S8: F2 non ha DTEND 20270412"
grep -qF "DTSTART;VALUE=DATE:20270410" "${tmp_dir}/ics-f2.b" || fail "S8: F2 non ha DTSTART 20270410"
echo "ok  S8: .ics di F2 (10 apr -> DTEND 20270412)"

# --- S9: ?download=1 -> attachment -------------------------------------------
code="$(fetch_ics ics-dl "/api/events/${F1}/ics?download=1")"
[[ "${code}" == "200" ]] || fail "S9: ?download=1: atteso 200, ottenuto ${code}"
[[ "$(header ics-dl content-disposition)" == attachment* ]] || fail "S9: content-disposition non attachment: '$(header ics-dl content-disposition)'"
echo "ok  S9: ?download=1 serve l'.ics come attachment"

# --- S10: id malformati -> 400 con corpo breve in italiano --------------------
for bad in abc 12abc; do
  code="$(fetch_ics ics-bad "/api/events/${bad}/ics")"
  [[ "${code}" == "400" ]] || fail "S10: /api/events/${bad}/ics: atteso 400, ottenuto ${code}"
  [[ "$(cat "${tmp_dir}/ics-bad.b")" == "Identificativo non valido" ]] || fail "S10: corpo del 400 per '${bad}': '$(cat "${tmp_dir}/ics-bad.b")'"
done
echo "ok  S10: id malformati (abc, 12abc) -> 400 'Identificativo non valido'"

# --- S11: id sconosciuto -> 404 in testo semplice, non una pagina HTML --------
code="$(fetch_ics ics-404 "/api/events/999999999/ics")"
[[ "${code}" == "404" ]] || fail "S11: id sconosciuto: atteso 404, ottenuto ${code}"
[[ "$(cat "${tmp_dir}/ics-404.b")" == "Evento non trovato" ]] || fail "S11: corpo del 404: '$(cat "${tmp_dir}/ics-404.b")'"
[[ "$(header ics-404 content-type)" == text/plain* ]] || fail "S11: content-type del 404 non text/plain: '$(header ics-404 content-type)'"
echo "ok  S11: id sconosciuto -> 404 'Evento non trovato' (text/plain)"

# --- S12: riga membro -> 307 alla canonica, tenendo download=1 ----------------
code="$(fetch_ics ics-member "/api/events/${F6}/ics?download=1")"
[[ "${code}" == "307" ]] || fail "S12: membro: atteso 307, ottenuto ${code}"
[[ "$(header ics-member location)" == */api/events/${F5}/ics?download=1 ]] || fail "S12: Location attesa .../api/events/${F5}/ics?download=1, ottenuta '$(header ics-member location)'"
echo "ok  S12: il membro F6 rimanda con 307 alla canonica F5 (download=1 mantenuto)"

# --- S13: nessuna iniezione dal titolo ----------------------------------------
code="$(fetch_ics ics-f7 "/api/events/${F7}/ics")"
[[ "${code}" == "200" ]] || fail "S13: GET /api/events/${F7}/ics: atteso 200, ottenuto ${code}"
node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\r\n");
const n = lines.filter(l => l === "END:VEVENT").length;
if (n !== 1) { console.error("END:VEVENT: " + n); process.exit(1) }
if (lines.some(l => l.startsWith("ATTENDEE"))) { console.error("riga ATTENDEE iniettata"); process.exit(1) }
' "${tmp_dir}/ics-f7.b" || fail "S13: il titolo di F7 ha iniettato righe nel .ics"
echo "ok  S13: titolo con CR LF + END:VEVENT -> un solo END:VEVENT, nessuna riga iniettata"

# --- S14: la pagina di F1 ha "Condividi evento" e il messaggio di stato sr-only ---
grep -qF "Condividi evento" "${page}" || fail "S14: la pagina di F1 non contiene 'Condividi evento'"
grep -qE 'role="status"[^>]*sr-only|sr-only[^>]*role="status"' "${page}" || fail "S14: manca l'elemento role=\"status\" sr-only"
echo "ok  S14: la pagina di F1 ha 'Condividi evento' e il role=status sr-only"

# --- S15: un evento futuro offre il pulsante del calendario --------------------
grep -qF "Aggiungi al calendario" "${page}" || fail "S15: la pagina di F1 non contiene 'Aggiungi al calendario'"
echo "ok  S15: la pagina di F1 ha il pulsante 'Aggiungi al calendario'"

# --- S16: un evento concluso ha badge e Condividi, ma non il calendario (D-05) --
fetch_page "${F8}"
page8="${tmp_dir}/page-${F8}.html"
grep -qF "Concluso" "${page8}" || fail "S16: la pagina di F8 non mostra il badge 'Concluso'"
grep -qF "Condividi evento" "${page8}" || fail "S16: la pagina di F8 non contiene 'Condividi evento'"
if grep -qF "Aggiungi al calendario" "${page8}"; then
  fail "S16: la pagina di F8 (concluso) contiene ancora 'Aggiungi al calendario'"
fi
echo "ok  S16: F8 (concluso) ha 'Concluso' e 'Condividi evento', senza 'Aggiungi al calendario'"

# --- Card Open Graph (SHARE-01, D-08, D-09) ----------------------------------
# og_meta <file> <property> -> valore del meta (i meta di Next sono self-closing)
og_meta() {
  grep -oE "<meta property=\"$2\" content=\"[^\"]*\"" "$1" | head -n 1 | sed -E 's/.*content="([^"]*)".*/\1/'
}

# --- S17: un evento senza immagine punta alla card generata -------------------
fetch_page "${F9}"
img="$(og_meta "${tmp_dir}/page-${F9}.html" og:image)"
[[ "${img}" == http* ]] || fail "S17: og:image di F9 non e' un URL assoluto: '${img}'"
[[ "${img}" == */eventi/${F9}/og?v=${og_version} ]] || fail "S17: og:image di F9 atteso .../eventi/${F9}/og?v=${og_version}, ottenuto '${img}'"
[[ "$(og_meta "${tmp_dir}/page-${F9}.html" og:image:width)" == "1200" ]] || fail "S17: og:image:width di F9 non e' 1200"
echo "ok  S17: F9 (senza immagine) ha og:image .../eventi/${F9}/og?v=${og_version}, 1200 di larghezza"

# --- S18: l'immagine della fonte resta com'e' (D-08) --------------------------
fetch_page "${F10}"
img="$(og_meta "${tmp_dir}/page-${F10}.html" og:image)"
[[ "${img}" == "https://example.invalid/foto.jpg" ]] || fail "S18: og:image di F10 atteso l'immagine della fonte, ottenuto '${img}'"
if grep -qF "/og?v=" "${tmp_dir}/page-${F10}.html"; then
  fail "S18: la pagina di F10 (con immagine) linka comunque la card generata"
fi
echo "ok  S18: F10 (con immagine) tiene l'immagine della fonte e non linka la card"

# --- S19: la card e' un PNG 1200x630, in cache per un giorno -------------------
code="$(fetch_ics og-f9 "/eventi/${F9}/og?v=${og_version}")"
[[ "${code}" == "200" ]] || fail "S19: GET /eventi/${F9}/og: atteso 200, ottenuto ${code}"
[[ "$(header og-f9 content-type)" == image/png* ]] || fail "S19: content-type non image/png: '$(header og-f9 content-type)'"
[[ "$(header og-f9 cache-control)" == "public, max-age=86400" ]] || fail "S19: cache-control atteso 'public, max-age=86400', ottenuto '$(header og-f9 cache-control)'"
node -e '
const b = require("fs").readFileSync(process.argv[1]);
const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
if (!b.subarray(0, 8).equals(sig)) { console.error("firma PNG assente"); process.exit(1) }
const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
if (w !== 1200 || h !== 630) { console.error("dimensioni " + w + "x" + h); process.exit(1) }
' "${tmp_dir}/og-f9.b" || fail "S19: la card di F9 non e' un PNG 1200x630"
echo "ok  S19: la card di F9 e' un PNG 1200x630 con cache-control public, max-age=86400"

# --- S20: id sconosciuto -> 404 in testo semplice, prima di ogni render -------
code="$(fetch_ics og-404 "/eventi/999999999/og")"
[[ "${code}" == "404" ]] || fail "S20: /eventi/999999999/og: atteso 404, ottenuto ${code}"
[[ "$(header og-404 content-type)" == text/plain* ]] || fail "S20: content-type del 404 non text/plain: '$(header og-404 content-type)'"
[[ "$(cat "${tmp_dir}/og-404.b")" == "Evento non trovato" ]] || fail "S20: corpo del 404: '$(cat "${tmp_dir}/og-404.b")'"
echo "ok  S20: card di un id sconosciuto -> 404 text/plain"

# --- S21: id malformato -> 404 -------------------------------------------------
for bad in abc 12abc; do
  code="$(fetch_ics og-bad "/eventi/${bad}/og")"
  [[ "${code}" == "404" ]] || fail "S21: /eventi/${bad}/og: atteso 404, ottenuto ${code}"
done
echo "ok  S21: card di un id malformato -> 404"

# --- S22: titolo con emoji, cirillico e 150 caratteri: PNG sotto il limite di WhatsApp ----
code="$(fetch_ics og-f11 "/eventi/${F11}/og?v=${og_version}")"
[[ "${code}" == "200" ]] || fail "S22: GET /eventi/${F11}/og: atteso 200, ottenuto ${code}"
[[ "$(header og-f11 content-type)" == image/png* ]] || fail "S22: content-type non image/png: '$(header og-f11 content-type)'"
size="$(wc -c <"${tmp_dir}/og-f11.b" | tr -d ' ')"
[[ "${size}" -lt 600000 ]] || fail "S22: la card di F11 pesa ${size} byte (limite di WhatsApp 600000)"
echo "ok  S22: la card di F11 (emoji, cirillico, titolo lungo) e' un PNG da ${size} byte"

# --- S23: senza descrizione, og:description dice quando e dove -----------------
desc="$(og_meta "${tmp_dir}/page-${F9}.html" og:description)"
[[ "${desc}" == *"sab 5 giu"* ]] || fail "S23: og:description di F9 atteso con 'sab 5 giu', ottenuto '${desc}'"
[[ "${desc}" != *"Scopri questo evento"* ]] || fail "S23: og:description di F9 e' ancora la frase generica"
echo "ok  S23: og:description di F9: '${desc}'"

# Per guardarla a occhio: OG_SAMPLE_OUT=/percorso/card.png npm run check:event-pages
if [[ -n "${OG_SAMPLE_OUT:-}" ]]; then
  cp "${tmp_dir}/og-f9.b" "${OG_SAMPLE_OUT}"
  [[ -z "${OG_SAMPLE_OUT_F11:-}" ]] || cp "${tmp_dir}/og-f11.b" "${OG_SAMPLE_OUT_F11}"
  echo "ok  card di F9 copiata in ${OG_SAMPLE_OUT}"
fi
