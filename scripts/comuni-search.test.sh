#!/usr/bin/env bash
# Gate bash per il contratto dell'autocomplete comuni (UI-02, D-01/D-03/D-04/D-05,
# D-07, T-09-01/T-09-02/T-09-05). Nessun framework: dev server effimero via
# scripts/dev-db.sh (D-17, Postgres locale), asserzioni di forma con node -e,
# stesso modello di scripts/monitoring-endpoint.test.sh. Un solo avvio del
# server per tutte le asserzioni.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
port="${PORT:-39882}"

# Il lock di sviluppo di Next (.next/dev/lock) e' per-distDir, non per-porta:
# se un'altra istanza di `next dev` e' gia' attiva su questo progetto (es.
# npm run dev:local su :3000), un secondo avvio sulla stessa .next fallisce
# anche su una porta diversa. NEXT_TEST_DIST_DIR (next.config.ts) isola questo
# harness in un distDir separato, ripulito a fine esecuzione.
test_dist_dir=".next-comuni-search-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

tmp_dir="$(mktemp -d)"
server_pid=""

fail() {
  echo "FAIL: $1"
  exit 1
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
    # `next dev` spawna processi figli non sempre raggiungibili da un semplice
    # kill sul pid del comando: pkill -P prova a fermare l'albero, lsof sulla
    # porta e' la rete di sicurezza se un figlio e' sopravvissuto comunque.
    pkill -P "${server_pid}" 2>/dev/null || true
    kill "${server_pid}" 2>/dev/null || true
    wait "${server_pid}" 2>/dev/null || true
    server_pid=""
  fi
  lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
}

cleanup() {
  stop_server
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

# --- Dev server effimero, Postgres locale reale (D-17) ----------------------
bash scripts/dev-db.sh npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale)"

# --- 1. q=Mil: 200, application/json, results<=8, Milano presente (UI-02, D-03)
resp1="${tmp_dir}/resp1.json"
headers1="${tmp_dir}/headers1.txt"
http_code="$(curl -s -o "${resp1}" -w '%{http_code}' -D "${headers1}" --max-time 15 "http://127.0.0.1:${port}/api/comuni/search?q=Mil")"
[[ "${http_code}" == "200" ]] || fail "D-03: atteso 200 su q=Mil, ottenuto ${http_code}"
grep -qi '^content-type:.*application/json' "${headers1}" || fail "D-03: content-type non e' application/json (header: $(cat "${headers1}"))"
node -e "
  const body = require('${resp1}');
  if (!Array.isArray(body.results)) throw new Error('results non e\' un array');
  if (body.results.length > 8) throw new Error('results supera 8 righe: ' + body.results.length);
  if (!body.results.some((r) => r.name === 'Milano')) throw new Error('Milano assente dai risultati per q=Mil');
" || fail "D-03/UI-02: forma o contenuto della risposta q=Mil non valido"
echo "ok  GET /api/comuni/search?q=Mil risponde 200, <=8 risultati, Milano presente (UI-02, D-03)"

# --- 2. ogni riga ha id/istatCode/name/provinceName/regionName (D-04) -------
node -e "
  const body = require('${resp1}');
  for (const r of body.results) {
    if (typeof r.id !== 'number') throw new Error('id non numerico per ' + JSON.stringify(r));
    if (typeof r.istatCode !== 'string' || !r.istatCode) throw new Error('istatCode assente/non stringa per ' + JSON.stringify(r));
    for (const field of ['name', 'provinceName', 'regionName']) {
      if (typeof r[field] !== 'string' || !r[field]) throw new Error(field + ' assente/vuoto per ' + JSON.stringify(r));
    }
  }
" || fail "D-04: forma di una riga di risultato non valida"
echo "ok  ogni riga di results ha id numerico, istatCode/name/provinceName/regionName non vuoti (D-04)"

# --- 3. q vuoto e q di soli spazi: 200, results vuoto, nessun accesso DB (D-03)
resp3a="${tmp_dir}/resp3a.json"
http_code="$(curl -s -o "${resp3a}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/comuni/search?q=")"
[[ "${http_code}" == "200" ]] || fail "D-03: atteso 200 su q vuoto, ottenuto ${http_code}"
node -e "
  const body = require('${resp3a}');
  if (!Array.isArray(body.results) || body.results.length !== 0) throw new Error('results non e\' un array vuoto per q vuoto: ' + JSON.stringify(body));
" || fail "D-03: q vuoto non restituisce results vuoto"

resp3b="${tmp_dir}/resp3b.json"
http_code="$(curl -s -o "${resp3b}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/comuni/search?q=%20%20")"
[[ "${http_code}" == "200" ]] || fail "D-03: atteso 200 su q di soli spazi, ottenuto ${http_code}"
node -e "
  const body = require('${resp3b}');
  if (!Array.isArray(body.results) || body.results.length !== 0) throw new Error('results non e\' un array vuoto per q di soli spazi: ' + JSON.stringify(body));
" || fail "D-03: q di soli spazi non restituisce results vuoto"
echo "ok  GET /api/comuni/search con q vuoto o di soli spazi risponde 200 con results vuoto, senza interrogare il database (D-03)"

# --- 4. alias/diacritici: q=cantu (senza accento) -> nome contiene 'Cant' (D-04)
resp4="${tmp_dir}/resp4.json"
http_code="$(curl -s -o "${resp4}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/comuni/search?q=cantu")"
[[ "${http_code}" == "200" ]] || fail "D-04: atteso 200 su q=cantu, ottenuto ${http_code}"
node -e "
  const body = require('${resp4}');
  if (!body.results.some((r) => r.name.includes('Cant'))) throw new Error('nessun risultato con nome contenente Cant per q=cantu: ' + JSON.stringify(body.results));
" || fail "D-04: normalizzazione diacritici/alias non funzionante per q=cantu"
echo "ok  GET /api/comuni/search?q=cantu trova un comune con nome contenente 'Cant' (normalizzazione condivisa, non ILIKE grezzo, D-04)"

# --- 5. iniezione: mai 500, mai leak del nome tabella nell'errore (T-09-01) --
resp5="${tmp_dir}/resp5.json"
http_code="$(curl -s -o "${resp5}" -w '%{http_code}' -G --data-urlencode "q=' OR 1=1 --" --max-time 15 "http://127.0.0.1:${port}/api/comuni/search")"
[[ "${http_code}" != "500" ]] || fail "T-09-01: la query con sintassi SQL nel parametro q ha prodotto un 500"
node -e "
  const body = require('${resp5}');
  if (!Array.isArray(body.results)) throw new Error('results assente/non array per la query con sintassi SQL: ' + JSON.stringify(body));
" || fail "T-09-01: la risposta alla query con sintassi SQL non ha la forma attesa"
body5_raw="$(cat "${resp5}")"
if echo "${body5_raw}" | grep -qi 'comuni'; then
  fail "T-09-01: il corpo della risposta contiene la stringa 'comuni' — possibile leak di un messaggio d'errore interno"
fi
echo "ok  GET /api/comuni/search con sintassi SQL nel parametro q risponde senza 500 e senza leak del nome tabella (T-09-01)"

# --- 6. ordine: q=Como -> Como e' il primo elemento (match esatto, D-04) ----
resp6="${tmp_dir}/resp6.json"
http_code="$(curl -s -o "${resp6}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/comuni/search?q=Como")"
[[ "${http_code}" == "200" ]] || fail "D-04: atteso 200 su q=Como, ottenuto ${http_code}"
node -e "
  const body = require('${resp6}');
  if (!body.results.length) throw new Error('nessun risultato per q=Como');
  if (body.results[0].name !== 'Como') throw new Error('primo elemento non e\' Como: ' + JSON.stringify(body.results[0]));
" || fail "D-04: il match esatto non e' ordinato per primo su q=Como"
echo "ok  GET /api/comuni/search?q=Como ha 'Como' come primo elemento, match esatto prima dell'alfabetico (D-04)"

# --- 7. contratto con /api/events: identita' del comune (D-01, D-07) --------
resp_milano="${tmp_dir}/resp_milano.json"
http_code="$(curl -s -o "${resp_milano}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/comuni/search?q=Milano")"
[[ "${http_code}" == "200" ]] || fail "D-01: atteso 200 su q=Milano, ottenuto ${http_code}"
milano_id="$(node -e "
  const body = require('${resp_milano}');
  const m = body.results.find((r) => r.name === 'Milano');
  if (!m) throw new Error('Milano assente dai risultati per q=Milano');
  process.stdout.write(String(m.id));
")" || fail "D-01: impossibile leggere id di Milano da q=Milano"
milano_istat="$(node -e "
  const body = require('${resp_milano}');
  const m = body.results.find((r) => r.name === 'Milano');
  process.stdout.write(String(m.istatCode));
")" || fail "D-01: impossibile leggere istatCode di Milano da q=Milano"

resp_events_id="${tmp_dir}/resp_events_id.json"
http_code="$(curl -s -o "${resp_events_id}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/events?location=Milano&comuneId=${milano_id}&limit=5")"
[[ "${http_code}" == "200" ]] || fail "D-01: atteso 200 su /api/events con comuneId, ottenuto ${http_code}"
node -e "
  const body = require('${resp_events_id}');
  if (!Array.isArray(body.events)) throw new Error('events non e\' un array con comuneId: ' + JSON.stringify(body));
" || fail "D-01: /api/events con comuneId non restituisce events array"

resp_events_istat="${tmp_dir}/resp_events_istat.json"
http_code="$(curl -s -o "${resp_events_istat}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/events?location=Milano&istatCode=${milano_istat}&limit=5")"
[[ "${http_code}" == "200" ]] || fail "D-07: atteso 200 su /api/events con istatCode, ottenuto ${http_code}"
node -e "
  const body = require('${resp_events_istat}');
  if (!Array.isArray(body.events)) throw new Error('events non e\' un array con istatCode: ' + JSON.stringify(body));
" || fail "D-07: /api/events con istatCode non restituisce events array"
echo "ok  GET /api/events accetta comuneId e istatCode di Milano risolti da /api/comuni/search e risponde 200 con events array (D-01, D-07)"

# --- 8. comuneId malformato: ignorato, mai un 500 (T-09-05) -----------------
resp8="${tmp_dir}/resp8.json"
http_code="$(curl -s -o "${resp8}" -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/events?location=Milano&comuneId=abc&limit=5")"
[[ "${http_code}" == "200" ]] || fail "T-09-05: atteso 200 con comuneId=abc, ottenuto ${http_code}"
node -e "
  const body = require('${resp8}');
  if (!Array.isArray(body.events)) throw new Error('events non e\' un array con comuneId=abc: ' + JSON.stringify(body));
" || fail "T-09-05: /api/events con comuneId=abc non restituisce events array"
echo "ok  GET /api/events con comuneId=abc (non intero) risponde 200 con events array, il parametro viene ignorato non propagato a Prisma (T-09-05)"

# --- 9. prova di non-vacuita': un percorso inesistente deve dare 404 -------
http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://127.0.0.1:${port}/api/comuni/search-inesistente")"
[[ "${http_code}" == "404" ]] || fail "prova di non-vacuita': /api/comuni/search-inesistente atteso 404, ottenuto ${http_code} — il controllo del codice HTTP non sa fallire"
echo "ok  GET /api/comuni/search-inesistente risponde 404 — il gate e' dimostrato capace di fallire"

stop_server

echo "PASS: contratto autocomplete comuni (UI-02, D-01, D-03, D-04, D-07, T-09-01, T-09-05)"
exit 0
