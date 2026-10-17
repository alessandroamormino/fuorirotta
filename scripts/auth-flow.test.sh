#!/usr/bin/env bash
# Gate dell'accesso con Google (check:auth-flow, test:local): dev server
# effimero sul Postgres LOCALE (scripts/dev-db.sh, mai produzione), con le
# variabili di accesso passate ESPLICITE e valori finti. .env.local puo'
# contenere valori veri, ma quelli espliciti vincono.
#
# Sezioni:
#   S1  POST sign-in/social: URL di Google con scope openid email profile,
#       redirect_uri giusto, niente include_granted_scopes; stampa i cookie
#       impostati ("cookie: <nome>", servono alla pagina /cookie)
#   S2  GET /api/v1/me/state senza cookie: {"enabled":true,"user":null}, no-store
#   S3  sessione vera (helper mint) -> lo stato restituisce nome ed e-mail
#   S4  callbackURL assoluto o protocol-relative -> 403
#   S5  statico: nessuno script di Google, nessuna pagina pubblica importa lib/auth
#   S6  dallo stesso X-Real-IP il 5o POST sign-in/social passa, il 6o da 429 con X-Retry-After
#   S7  un altro IP non e' toccato
#   S8  un X-Forwarded-For falso non cambia il bucket
#   S9  un ALTRO processo Node (helper rate) vede il contatore e risponde 429; la riga
#       in auth_rate_limit ha chiave '<ip>|/sign-in/social' e last_request in millisecondi
#   S10 con last_request spostato indietro di oltre 60 s il tentativo successivo passa
#   S11 due IPv6 della stessa /64 contano insieme, un'altra /64 no
#   S12 in produzione una richiesta senza X-Real-IP finisce nel bucket 'no-trusted-ip'
#   S13 sessione rinnovata dopo piu' di un giorno: Set-Cookie con Max-Age=5184000,
#       HttpOnly, SameSite=Lax, Path=/, senza Domain; expires_at torna a ~60 giorni
#   S14 nome Google da 120 punti di codice: 50 salvati, foto null, tre token null
#   S15 statico: lib/auth.ts nomina x-real-ip e nessun forwarded-for
#   S16 bearer: il token nudo non da' utente, quello firmato si
#
# Ogni sezione usa un X-Real-IP di TEST-NET-2 (198.51.100.x) tutto suo, cosi'
# i contatori del rate limit non si disturbano a vicenda. Utenti di prova
# sempre @fixture.invalid, cancellati all'uscita.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
# Mai la variabile generica PORT (lezione WR-05): un PORT esportato dalla
# shell farebbe uccidere da stop_server il dev server dello sviluppatore.
port="${AUTH_FLOW_TEST_PORT:-39885}"
base_url="http://localhost:${port}"
origin="${base_url}"

test_dist_dir=".next-auth-flow-test"
export NEXT_TEST_DIST_DIR="${test_dist_dir}"

compose_file="${repo_root}/docker-compose.dev.yml"
tmp_dir="$(mktemp -d)"
server_pid=""

# Valori finti, ma di forma valida: il segreto ha 40 caratteri (minimo 32).
test_secret="auth-flow-test-secret-0123456789abcdefgh"
auth_env=(
  AUTH_ENABLED=1
  "BETTER_AUTH_URL=${base_url}"
  "BETTER_AUTH_SECRET=${test_secret}"
  GOOGLE_CLIENT_ID=test-client-id.apps.googleusercontent.com
  GOOGLE_CLIENT_SECRET=test-client-secret
)

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
    lsof -ti tcp:"${port}" 2>/dev/null | xargs kill -9 2>/dev/null || true
  fi
}

# helper <sottocomando> [args...]: stesso ambiente del dev server, DB locale.
helper() {
  bash scripts/dev-db.sh env "${auth_env[@]}" npx tsx scripts/auth-flow.helper.ts "$@"
}

cleanup() {
  stop_server
  helper cleanup >/dev/null 2>&1 || true
  psql_dev "DELETE FROM auth_rate_limit WHERE key LIKE '198.51.100.%' OR key LIKE '2001:%' OR key LIKE 'no-trusted-ip|%'" >/dev/null 2>&1 || true
  rm -rf "${tmp_dir}"
  rm -rf "${repo_root}/${test_dist_dir}"
}
trap cleanup EXIT

cd "${repo_root}"

if ! docker compose -f "${compose_file}" ps postgres-dev 2>/dev/null | grep -q "Up\|running"; then
  fail "il container postgres-dev non e' in esecuzione. Esegui 'npm run db:dev:up'."
fi

# Parte pulita: utenti e contatori di prove precedenti interrotte.
helper cleanup >/dev/null
psql_dev "DELETE FROM auth_rate_limit WHERE key LIKE '198.51.100.%' OR key LIKE '2001:%' OR key LIKE 'no-trusted-ip|%'" >/dev/null

# --- Dev server effimero, Postgres locale reale -----------------------------
bash scripts/dev-db.sh env "${auth_env[@]}" npx next dev -p "${port}" >"${tmp_dir}/dev-server.log" 2>&1 &
server_pid=$!
wait_for_port "${port}"
echo "ok  dev server locale avviato sulla porta ${port} (scripts/dev-db.sh, Postgres locale, accesso attivo con valori finti)"

# call <nome> <metodo> <percorso> <ip> [argomenti curl...]
# Scrive ${tmp_dir}/<nome>.h (header) e <nome>.b (corpo); stampa il codice HTTP.
# La prima compilazione di una rotta e' lenta: --max-time 90.
call() {
  local name="$1" method="$2" path="$3" ip="$4"
  shift 4
  curl -s -X "${method}" -D "${tmp_dir}/${name}.h" -o "${tmp_dir}/${name}.b" -w '%{http_code}' \
    --max-time 90 -H "X-Real-IP: ${ip}" "$@" "http://127.0.0.1:${port}${path}"
}

# header <nome> <header> -> valore (CR tolto)
header() {
  grep -i "^$2:" "${tmp_dir}/$1.h" | head -n 1 | cut -d: -f2- | sed 's/^ *//' | tr -d '\r'
}

# json_get <file> <espressione JS su "j"> -> stampa il risultato
json_get() {
  node -e 'const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); const v = eval(process.argv[2]); console.log(v === undefined ? "undefined" : typeof v === "string" ? v : JSON.stringify(v))' "$1" "$2"
}

# sign_in <nome> <ip> <callbackURL> -> codice HTTP
sign_in() {
  call "$1" POST /api/auth/sign-in/social "$2" \
    -H "Origin: ${origin}" -H 'Content-Type: application/json' \
    --data "{\"provider\":\"google\",\"callbackURL\":\"$3\",\"errorCallbackURL\":\"$3\"}"
}

# --- S1: l'URL di Google e i cookie impostati --------------------------------
code="$(sign_in s1 198.51.100.11 '/eventi/1?a=1')"
[[ "${code}" == "200" ]] || fail "S1: POST sign-in/social: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s1.b"))"
google_url="$(json_get "${tmp_dir}/s1.b" 'j.url')"
node -e '
const u = new URL(process.argv[1]);
const expectedRedirect = process.argv[2] + "/api/auth/callback/google";
if (u.hostname !== "accounts.google.com") { console.error("host " + u.hostname); process.exit(1) }
const scopes = new Set((u.searchParams.get("scope") || "").split(/[ +]/).filter(Boolean));
const want = ["openid", "email", "profile"];
if (scopes.size !== want.length || !want.every((s) => scopes.has(s))) { console.error("scope: " + [...scopes].join(",")); process.exit(1) }
if (u.searchParams.get("redirect_uri") !== expectedRedirect) { console.error("redirect_uri: " + u.searchParams.get("redirect_uri")); process.exit(1) }
if (u.searchParams.has("include_granted_scopes")) { console.error("include_granted_scopes presente"); process.exit(1) }
' "${google_url}" "${base_url}" || fail "S1: l'URL di Google non ha scope {openid,email,profile}, redirect_uri ${base_url}/api/auth/callback/google e nessun include_granted_scopes"
echo "ok  S1: sign-in/social restituisce un URL di Google con scope openid email profile, redirect_uri ${base_url}/api/auth/callback/google, senza include_granted_scopes"
# I nomi dei cookie del sign-in vanno nel SUMMARY e alla pagina /cookie (D-14).
cookie_names="$(grep -i '^set-cookie:' "${tmp_dir}/s1.h" | sed -E 's/^[Ss]et-[Cc]ookie: *([^=]*)=.*/\1/' | sort -u)"
if [[ -n "${cookie_names}" ]]; then
  while IFS= read -r name; do echo "cookie: ${name}"; done <<<"${cookie_names}"
else
  echo "cookie: (nessuno)"
fi

# --- S2: senza cookie lo stato e' "ospite", mai in cache condivisa -------------
code="$(call s2 GET /api/v1/me/state 198.51.100.12)"
[[ "${code}" == "200" ]] || fail "S2: GET /api/v1/me/state: atteso 200, ottenuto ${code}"
[[ "$(cat "${tmp_dir}/s2.b")" == '{"enabled":true,"user":null}' ]] || fail "S2: corpo inatteso: '$(cat "${tmp_dir}/s2.b")'"
[[ "$(header s2 cache-control)" == "private, no-store" ]] || fail "S2: cache-control atteso 'private, no-store', ottenuto '$(header s2 cache-control)'"
echo "ok  S2: senza cookie lo stato e' {\"enabled\":true,\"user\":null} con private, no-store"

# --- S3: una sessione vera restituisce l'utente --------------------------------
read -r s3_user s3_cookie _s3_token <<<"$(helper mint s3-anna@fixture.invalid 'Anna Verdi' 0 | tail -n 1)"
[[ -n "${s3_user}" && -n "${s3_cookie}" ]] || fail "S3: helper mint non ha stampato utente e cookie"
code="$(call s3 GET /api/v1/me/state 198.51.100.13 -H "Cookie: fuorirotta.session_token=${s3_cookie}")"
[[ "${code}" == "200" ]] || fail "S3: GET /api/v1/me/state con cookie: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/s3.b" 'j.enabled')" == "true" ]] || fail "S3: enabled non e' true"
[[ "$(json_get "${tmp_dir}/s3.b" 'j.user.name')" == "Anna Verdi" ]] || fail "S3: nome atteso 'Anna Verdi', corpo: '$(cat "${tmp_dir}/s3.b")'"
[[ "$(json_get "${tmp_dir}/s3.b" 'j.user.email')" == "s3-anna@fixture.invalid" ]] || fail "S3: e-mail attesa s3-anna@fixture.invalid, corpo: '$(cat "${tmp_dir}/s3.b")'"
[[ "$(header s3 cache-control)" == "private, no-store" ]] || fail "S3: cache-control atteso 'private, no-store'"
echo "ok  S3: il cookie di sessione firmato restituisce nome ed e-mail dell'utente"

# --- S4: niente open redirect dai callback URL --------------------------------
for evil in 'https://evil.example/x' '//evil.example/x'; do
  code="$(sign_in s4 198.51.100.14 "${evil}")"
  [[ "${code}" == "403" ]] || fail "S4: callbackURL '${evil}': atteso 403, ottenuto ${code}"
done
echo "ok  S4: callbackURL assoluto e protocol-relative -> 403"

# --- S5: statico, nessuno script di Google e nessuna pagina pubblica sull'auth ---
gsi_hits="$(grep -rnE 'accounts\.google\.com/gsi|googleusercontent' app components lib || true)"
[[ -z "${gsi_hits}" ]] || fail "S5: script Google o host googleusercontent nel codice: ${gsi_hits}"
public_hits="$(grep -rnE "lib/auth([\"'/]|$)" app/layout.tsx app/page.tsx app/eventi "app/[regione]" || true)"
[[ -z "${public_hits}" ]] || fail "S5: una pagina pubblica importa lib/auth: ${public_hits}"
echo "ok  S5: nessuno script di Google in app/ components/ lib/, nessuna pagina pubblica importa lib/auth"

# --- S6: il sesto tentativo dallo stesso IP e' un 429 --------------------------
ip_a="198.51.100.21"
for attempt in 1 2 3 4 5; do
  code="$(sign_in s6 "${ip_a}" '/')"
  [[ "${code}" == "200" ]] || fail "S6: tentativo ${attempt} da ${ip_a}: atteso 200, ottenuto ${code}"
done
code="$(sign_in s6 "${ip_a}" '/')"
[[ "${code}" == "429" ]] || fail "S6: il 6o tentativo da ${ip_a}: atteso 429, ottenuto ${code}"
[[ -n "$(header s6 x-retry-after)" ]] || fail "S6: manca X-Retry-After nel 429"
echo "ok  S6: 5 tentativi passano, il 6o da ${ip_a} e' 429 con X-Retry-After: $(header s6 x-retry-after)"

# --- S7: un altro IP non e' toccato --------------------------------------------
code="$(sign_in s7 198.51.100.22 '/')"
[[ "${code}" == "200" ]] || fail "S7: altro IP: atteso 200, ottenuto ${code}"
echo "ok  S7: un altro X-Real-IP risponde 200"

# --- S8: un forwarded-for falso non sposta il bucket ---------------------------
code="$(call s8 POST /api/auth/sign-in/social "${ip_a}" -H "Origin: ${origin}" -H 'Content-Type: application/json' \
  -H 'X-Forwarded-For: 198.51.100.99' --data '{"provider":"google","callbackURL":"/","errorCallbackURL":"/"}')"
[[ "${code}" == "429" ]] || fail "S8: con X-Forwarded-For falso: atteso 429, ottenuto ${code}"
echo "ok  S8: un X-Forwarded-For falso non cambia il bucket (429)"

# --- S9: un processo separato vede il contatore scritto dal dev server ------------
status="$(helper rate "${ip_a}" | tail -n 1)"
[[ "${status}" == "429" ]] || fail "S9: il processo separato: atteso 429, ottenuto '${status}'"
key="${ip_a}|/sign-in/social"
rows="$(psql_dev "SELECT count(*) FROM auth_rate_limit WHERE key = '${key}'")"
[[ "${rows}" == "1" ]] || fail "S9: attesa una riga auth_rate_limit con chiave '${key}', trovate ${rows}"
digits="$(psql_dev "SELECT length(last_request::text) FROM auth_rate_limit WHERE key = '${key}'")"
[[ "${digits}" == "13" ]] || fail "S9: last_request atteso in millisecondi (13 cifre), ottenute ${digits}"
echo "ok  S9: un altro processo Node risponde 429; la riga '${key}' ha last_request a 13 cifre"

# --- S10: passata la finestra il tentativo successivo passa ----------------------
psql_dev "UPDATE auth_rate_limit SET last_request = last_request - 61000 WHERE key = '${key}'" >/dev/null
code="$(sign_in s10 "${ip_a}" '/')"
[[ "${code}" == "200" ]] || fail "S10: dopo 61 s: atteso 200, ottenuto ${code}"
echo "ok  S10: con last_request spostato indietro di 61 s il tentativo passa (200)"

# --- S11: IPv6, contano le /64 ----------------------------------------------------
for attempt in 1 2 3 4 5; do
  code="$(sign_in s11 2001:db8:abcd:12::1 '/')"
  [[ "${code}" == "200" ]] || fail "S11: tentativo ${attempt} da 2001:db8:abcd:12::1: atteso 200, ottenuto ${code}"
done
code="$(sign_in s11 2001:db8:abcd:12::2 '/')"
[[ "${code}" == "429" ]] || fail "S11: stessa /64, altro indirizzo: atteso 429, ottenuto ${code}"
code="$(sign_in s11 2001:db8:abcd:13::1 '/')"
[[ "${code}" == "200" ]] || fail "S11: un'altra /64: atteso 200, ottenuto ${code}"
v6_keys="$(psql_dev "SELECT count(*) FROM auth_rate_limit WHERE key LIKE '2001:%|/sign-in/social'")"
[[ "${v6_keys}" == "2" ]] || fail "S11: attese 2 chiavi IPv6 (una per /64), trovate ${v6_keys}: $(psql_dev "SELECT key FROM auth_rate_limit WHERE key LIKE '2001:%'" | tr '\n' ' ')"
echo "ok  S11: due indirizzi della stessa /64 contano insieme (429), un'altra /64 no; chiavi: $(psql_dev "SELECT key FROM auth_rate_limit WHERE key LIKE '2001:%' ORDER BY key" | tr '\n' ' ')"

# --- S12: in produzione, senza X-Real-IP, un bucket condiviso -----------------------
status="$(NODE_ENV=production helper rate --no-ip | tail -n 1)"
[[ "${status}" == "200" || "${status}" == "429" ]] || fail "S12: richiesta senza X-Real-IP in produzione: stato inatteso '${status}'"
shared="$(psql_dev "SELECT count(*) FROM auth_rate_limit WHERE key = 'no-trusted-ip|/sign-in/social'")"
[[ "${shared}" == "1" ]] || fail "S12: attesa la riga 'no-trusted-ip|/sign-in/social', trovate ${shared}"
echo "ok  S12: senza X-Real-IP in produzione la richiesta finisce nel bucket condiviso 'no-trusted-ip'"

# --- S13: rinnovo a scorrimento, il cookie nuovo arriva al browser -------------------
read -r s13_user s13_cookie s13_token <<<"$(helper mint s13-rinnovo@fixture.invalid 'Rina Neri' 0 | tail -n 1)"
code="$(call s13a GET /api/v1/me/state 198.51.100.31 -H "Cookie: fuorirotta.session_token=${s13_cookie}")"
[[ "${code}" == "200" ]] || fail "S13: stato con sessione nuova: atteso 200, ottenuto ${code}"
if grep -qi '^set-cookie:' "${tmp_dir}/s13a.h"; then
  fail "S13: una sessione appena creata non va rinnovata, ma c'e' un Set-Cookie"
fi
# La libreria rinnova quando expires_at - expiresIn + updateAge e' nel passato:
# 2 giorni indietro portano expires_at a ~58 giorni da ora.
psql_dev "UPDATE auth_session SET expires_at = expires_at - interval '2 days', updated_at = updated_at - interval '2 days' WHERE token = '${s13_token}'" >/dev/null
days_before="$(psql_dev "SELECT round(extract(epoch FROM (expires_at - now())) / 86400) FROM auth_session WHERE token = '${s13_token}'")"
[[ "${days_before}" == "58" ]] || fail "S13: prima del rinnovo expires_at atteso a ~58 giorni, trovato ${days_before}"
code="$(call s13b GET /api/v1/me/state 198.51.100.31 -H "Cookie: fuorirotta.session_token=${s13_cookie}")"
[[ "${code}" == "200" ]] || fail "S13: stato con sessione da rinnovare: atteso 200, ottenuto ${code}"
renew="$(grep -i '^set-cookie: fuorirotta.session_token=' "${tmp_dir}/s13b.h" | head -n 1 | tr -d '\r' || true)"
[[ -n "${renew}" ]] || fail "S13: manca il Set-Cookie di rinnovo"
for needle in 'Max-Age=5184000' 'HttpOnly' 'SameSite=Lax' 'Path=/'; do
  grep -qiF "${needle}" <<<"${renew}" || fail "S13: il Set-Cookie di rinnovo non ha '${needle}': ${renew}"
done
if grep -qi 'domain=' <<<"${renew}"; then fail "S13: il Set-Cookie di rinnovo ha Domain: ${renew}"; fi
days_after="$(psql_dev "SELECT round(extract(epoch FROM (expires_at - now())) / 86400) FROM auth_session WHERE token = '${s13_token}'")"
[[ "${days_after}" == "60" ]] || fail "S13: dopo il rinnovo expires_at atteso a ~60 giorni, trovato ${days_after}"
echo "ok  S13: sessione a 58 giorni rinnovata: Set-Cookie Max-Age=5184000, HttpOnly, SameSite=Lax, Path=/, senza Domain; expires_at 58 -> 60 giorni"

# --- S14: nome lungo di Google, nessuna foto, nessun token --------------------------
long_name="$(node -e 'process.stdout.write("Ünï" + "\u{1F600}".repeat(60) + "x".repeat(57))')"
out="$(helper create-google-user "${long_name}" | tail -n 1)"
[[ "${out}" == "codepoints=50 lone_surrogates=false image=null accessToken=null refreshToken=null idToken=null" ]] \
  || fail "S14: atteso 'codepoints=50 lone_surrogates=false image=null accessToken=null refreshToken=null idToken=null', ottenuto '${out}'"
echo "ok  S14: nome da 120 punti di codice salvato a 50, foto null, access/refresh/id token null"

# --- S15: statico, l'IP si legge solo da x-real-ip -----------------------------------
code_lines="$(grep -vE '^[[:space:]]*//' lib/auth.ts)"
grep -qi 'x-real-ip' <<<"${code_lines}" || fail "S15: lib/auth.ts non nomina x-real-ip fuori dai commenti"
if grep -qiE 'forwarded' <<<"${code_lines}"; then fail "S15: lib/auth.ts nomina un header forwarded-for fuori dai commenti"; fi
echo "ok  S15: lib/auth.ts legge l'IP solo da x-real-ip e non nomina forwarded-for"

# --- S16: bearer, solo il valore firmato vale -------------------------------------------
read -r s16_user s16_cookie s16_token <<<"$(helper mint s16-bearer@fixture.invalid 'Bruno Blu' 0 | tail -n 1)"
code="$(call s16a GET /api/v1/me/state 198.51.100.32 -H "Authorization: Bearer ${s16_token}")"
[[ "${code}" == "200" ]] || fail "S16: bearer nudo: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/s16a.b" 'j.user')" == "null" ]] || fail "S16: un token di sessione nudo come bearer ha dato un utente: '$(cat "${tmp_dir}/s16a.b")'"
code="$(call s16b GET /api/v1/me/state 198.51.100.32 -H "Authorization: Bearer ${s16_cookie}")"
[[ "${code}" == "200" ]] || fail "S16: bearer firmato: atteso 200, ottenuto ${code}"
[[ "$(json_get "${tmp_dir}/s16b.b" 'j.user.email')" == "s16-bearer@fixture.invalid" ]] || fail "S16: il bearer firmato non ha dato l'utente: '$(cat "${tmp_dir}/s16b.b")'"
echo "ok  S16: il token nudo come bearer non da' utente, quello firmato si"

# --- S17-S21: modifica del nome (ACCT-01, D-09) -----------------------------------------
read -r s17_user s17_cookie _s17_token <<<"$(helper mint s17-giulia@fixture.invalid 'Giulia Rossi' 0 | tail -n 1)"
s17_cookie_hdr="Cookie: fuorirotta.session_token=${s17_cookie}"
stored_name() { psql_dev "SELECT name FROM auth_user WHERE id = '$1'"; }
patch_name() { # <nome-file> <ip> <corpo> [argomenti curl...]
  local name="$1" ip="$2" body="$3"
  shift 3
  call "${name}" PATCH /api/v1/me/profile "${ip}" -H 'Content-Type: application/json' --data "${body}" "$@"
}
no_store() { [[ "$(header "$1" cache-control)" == "private, no-store" ]] || fail "$2: cache-control atteso 'private, no-store' su $1, ottenuto '$(header "$1" cache-control)'"; }

code="$(patch_name s17 198.51.100.41 '{"name":"  Giulia  "}' -H "Origin: ${origin}" -H "${s17_cookie_hdr}")"
[[ "${code}" == "200" ]] || fail "S17: PATCH nome: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s17.b"))"
[[ "$(cat "${tmp_dir}/s17.b")" == '{"name":"Giulia"}' ]] || fail "S17: corpo inatteso: '$(cat "${tmp_dir}/s17.b")'"
[[ "$(stored_name "${s17_user}")" == "Giulia" ]] || fail "S17: nel database il nome e' '$(stored_name "${s17_user}")'"
no_store s17 S17
echo "ok  S17: PATCH {name:'  Giulia  '} con cookie e Origin -> 200 {\"name\":\"Giulia\"}, il database dice Giulia"

fifty_one="$(node -e 'process.stdout.write("a".repeat(51))')"
n=0
for body in '{"name":""}' '{"name":"   "}' "{\"name\":\"${fifty_one}\"}" '{"name":123}' 'questo non e json' ''; do
  n=$((n + 1))
  code="$(patch_name s18 198.51.100.42 "${body}" -H "Origin: ${origin}" -H "${s17_cookie_hdr}")"
  [[ "${code}" == "400" ]] || fail "S18: corpo #${n} '${body}': atteso 400, ottenuto ${code}"
  [[ "$(cat "${tmp_dir}/s18.b")" == '{"error":"Nome non valido"}' ]] || fail "S18: corpo #${n}: risposta inattesa '$(cat "${tmp_dir}/s18.b")'"
  no_store s18 S18
  [[ "$(stored_name "${s17_user}")" == "Giulia" ]] || fail "S18: corpo #${n}: il nome salvato e' cambiato in '$(stored_name "${s17_user}")'"
done
echo "ok  S18: stringa vuota, solo spazi, 51 punti di codice, numero, non-JSON e corpo vuoto -> 400 {\"error\":\"Nome non valido\"}, nome invariato"

fifty_emoji="$(node -e 'process.stdout.write("\u{1F600}".repeat(50))')"
code="$(patch_name s19 198.51.100.43 "{\"name\":\"${fifty_emoji}\"}" -H "Origin: ${origin}" -H "${s17_cookie_hdr}")"
[[ "${code}" == "200" ]] || fail "S19: 50 emoji: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s19.b"))"
[[ "$(stored_name "${s17_user}")" == "${fifty_emoji}" ]] || fail "S19: le 50 emoji non sono state salvate intere"
echo "ok  S19: cinquanta emoji (100 unita' UTF-16, 50 punti di codice) -> 200 e salvate intere"

code="$(patch_name s20a 198.51.100.44 '{"name":"Hacker"}' -H "${s17_cookie_hdr}")"
[[ "${code}" == "403" ]] || fail "S20: senza Origin: atteso 403, ottenuto ${code}"
no_store s20a S20
code="$(patch_name s20b 198.51.100.44 '{"name":"Hacker"}' -H 'Origin: https://evil.example' -H "${s17_cookie_hdr}")"
[[ "${code}" == "403" ]] || fail "S20: Origin esterno: atteso 403, ottenuto ${code}"
no_store s20b S20
[[ "$(stored_name "${s17_user}")" == "${fifty_emoji}" ]] || fail "S20: una richiesta rifiutata ha cambiato il nome"
echo "ok  S20: PATCH senza Origin e con Origin https://evil.example -> 403, nome invariato"

code="$(patch_name s21 198.51.100.45 '{"name":"Anonimo"}' -H "Origin: ${origin}")"
[[ "${code}" == "401" ]] || fail "S21: senza cookie: atteso 401, ottenuto ${code}"
[[ "$(cat "${tmp_dir}/s21.b")" == '{"error":"unauthenticated"}' ]] || fail "S21: corpo inatteso '$(cat "${tmp_dir}/s21.b")'"
no_store s21 S21
echo "ok  S21: PATCH senza cookie -> 401 {\"error\":\"unauthenticated\"}"
