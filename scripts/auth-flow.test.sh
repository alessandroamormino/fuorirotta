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
#   S14 nome Google da 120 punti di codice: 50 salvati, foto di Google tenuta, tre token null;
#       foto non https o non *.googleusercontent.com -> null; accesso successivo: cambia solo la foto
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
  AUTH_ENABLED=true
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
[[ "$(json_get "${tmp_dir}/s3.b" 'j.user.image')" == "https://lh3.googleusercontent.com/a/fixture-photo=s96-c" ]] || fail "S3: foto attesa nello stato, corpo: '$(cat "${tmp_dir}/s3.b")'"
[[ "$(header s3 cache-control)" == "private, no-store" ]] || fail "S3: cache-control atteso 'private, no-store'"
echo "ok  S3: il cookie di sessione firmato restituisce nome, e-mail e foto dell'utente"

# --- S4: niente open redirect dai callback URL --------------------------------
for evil in 'https://evil.example/x' '//evil.example/x'; do
  code="$(sign_in s4 198.51.100.14 "${evil}")"
  [[ "${code}" == "403" ]] || fail "S4: callbackURL '${evil}': atteso 403, ottenuto ${code}"
done
echo "ok  S4: callbackURL assoluto e protocol-relative -> 403"

# --- S5: statico, nessuno script di Google e nessuna pagina pubblica sull'auth ---
# googleusercontent compare in un solo posto: il validatore della foto (D-20).
gsi_hits="$(grep -rnE 'accounts\.google\.com/gsi|googleusercontent' app components lib --exclude=profileImage.ts || true)"
[[ -z "${gsi_hits}" ]] || fail "S5: script Google o host googleusercontent nel codice: ${gsi_hits}"
public_hits="$(grep -rnE "lib/auth([\"'/]|$)" app/layout.tsx app/page.tsx app/eventi "app/[regione]" || true)"
[[ -z "${public_hits}" ]] || fail "S5: una pagina pubblica importa lib/auth: ${public_hits}"
echo "ok  S5: nessuno script di Google in app/ components/ lib/ (googleusercontent solo in lib/profileImage.ts), nessuna pagina pubblica importa lib/auth"

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

# --- S14: nome lungo di Google, foto di Google, nessun token ------------------------
long_name="$(node -e 'process.stdout.write("Ünï" + "\u{1F600}".repeat(60) + "x".repeat(57))')"
out="$(helper create-google-user "${long_name}" | tail -n 1)"
s14_expected="codepoints=50 lone_surrogates=false image=https://lh3.googleusercontent.com/a/fixture accessToken=null refreshToken=null idToken=null"
[[ "${out}" == "${s14_expected}" ]] || fail "S14: atteso '${s14_expected}', ottenuto '${out}'"
echo "ok  S14: nome da 120 punti di codice salvato a 50, foto di Google tenuta, access/refresh/id token null"

out="$(helper image-rules | tail -n 1)"
s14_rules="http=null foreign=null suffix=null creds=null junk=null good=https://lh3.googleusercontent.com/a/fixture-photo=s96-c override_image=true override_name=Img good override_email=true override_verified=true override_none=null direct_foreign=null direct_name=Zeno"
[[ "${out}" == "${s14_rules}" ]] || fail "S14: regole della foto: atteso '${s14_rules}', ottenuto '${out}'"
echo "ok  S14: foto http, di altro dominio, con suffisso simile, con credenziali o non-URL -> null; all'accesso successivo cambia solo la foto (nome ed e-mail restano), senza foto -> null; scrittura diretta di una foto estranea -> null"

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
for body in '{"name":""}' '{"name":"   "}' "{\"name\":\"${fifty_one}\"}" '{"name":123}' '{"name":"a\u0000b"}' '{"name":"a\u202Eb"}' 'questo non e json' ''; do
  n=$((n + 1))
  code="$(patch_name s18 198.51.100.42 "${body}" -H "Origin: ${origin}" -H "${s17_cookie_hdr}")"
  [[ "${code}" == "400" ]] || fail "S18: corpo #${n} '${body}': atteso 400, ottenuto ${code}"
  [[ "$(cat "${tmp_dir}/s18.b")" == '{"error":"Nome non valido"}' ]] || fail "S18: corpo #${n}: risposta inattesa '$(cat "${tmp_dir}/s18.b")'"
  no_store s18 S18
  [[ "$(stored_name "${s17_user}")" == "Giulia" ]] || fail "S18: corpo #${n}: il nome salvato e' cambiato in '$(stored_name "${s17_user}")'"
done
echo "ok  S18: stringa vuota, solo spazi, 51 punti di codice, NUL, override bidi, numero, non-JSON e corpo vuoto -> 400 {\"error\":\"Nome non valido\"}, nome invariato"

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

# --- S22-S28: sessioni attive (AUTH-06, D-08) ---------------------------------------------
ua_mac='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
ua_iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
read -r a_user a_cookie a_token <<<"$(helper mint s22-a@fixture.invalid 'Anna A' 0 "${ua_mac}" | tail -n 1)"
a_id="$(psql_dev "SELECT id FROM auth_session WHERE token = '${a_token}'")"
a_cookie_hdr="Cookie: fuorirotta.session_token=${a_cookie}"
read -r a_old_id _a_old_cookie _a_old_token <<<"$(helper session "${a_user}" 3 "${ua_iphone}" | tail -n 1)"
read -r b_user b_cookie b_token <<<"$(helper mint s22-b@fixture.invalid 'Bruno B' 0 "${ua_mac}" | tail -n 1)"
b_id="$(psql_dev "SELECT id FROM auth_session WHERE token = '${b_token}'")"
session_count() { psql_dev "SELECT count(*) FROM auth_session WHERE user_id = '$1'"; }

code="$(call s22 GET /api/v1/me/sessions 198.51.100.51 -H "${a_cookie_hdr}")"
[[ "${code}" == "200" ]] || fail "S22: GET sessions: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s22.b"))"
no_store s22 S22
[[ "$(json_get "${tmp_dir}/s22.b" 'j.sessions.length')" == "2" ]] || fail "S22: attese 2 sessioni (anche quella di 3 giorni fa), corpo: '$(cat "${tmp_dir}/s22.b")'"
[[ "$(json_get "${tmp_dir}/s22.b" 'j.sessions[0].id')" == "${a_id}" && "$(json_get "${tmp_dir}/s22.b" 'j.sessions[0].current')" == "true" ]] \
  || fail "S22: la prima riga non e' la sessione corrente"
[[ "$(json_get "${tmp_dir}/s22.b" 'j.sessions[1].id')" == "${a_old_id}" && "$(json_get "${tmp_dir}/s22.b" 'j.sessions[1].current')" == "false" ]] \
  || fail "S22: la seconda riga non e' la sessione di 3 giorni fa"
[[ "$(json_get "${tmp_dir}/s22.b" 'j.sessions.map((s) => s.device + "/" + s.kind).join(",")')" == "Chrome su Mac/desktop,Safari su iPhone/phone" ]] \
  || fail "S22: device/kind inattesi: '$(cat "${tmp_dir}/s22.b")'"
[[ "$(json_get "${tmp_dir}/s22.b" 'j.sessions.every((s) => Object.keys(s).sort().join() === "createdAt,current,device,expiresAt,id,kind,lastActive")')" == "true" ]] \
  || fail "S22: le chiavi di ogni riga non sono esattamente id/device/kind/createdAt/lastActive/expiresAt/current: '$(cat "${tmp_dir}/s22.b")'"
if grep -qiE 'token|ipAddress' "${tmp_dir}/s22.b"; then fail "S22: il corpo nomina token o ipAddress"; fi
echo "ok  S22: l'elenco ha 2 righe (la corrente prima, quella di 3 giorni fa c'e'), 'Chrome su Mac' e 'Safari su iPhone', chiavi esatte, niente token ne' IP"

code="$(call s23 DELETE "/api/v1/me/sessions/${b_id}" 198.51.100.52 -H "Origin: ${origin}" -H "${a_cookie_hdr}")"
[[ "${code}" == "404" ]] || fail "S23: DELETE dell'id di un altro utente: atteso 404, ottenuto ${code}"
[[ "$(psql_dev "SELECT count(*) FROM auth_session WHERE id = '${b_id}'")" == "1" ]] || fail "S23: la sessione di B e' stata cancellata (IDOR)"
no_store s23 S23
echo "ok  S23: DELETE /sessions/<id di B> con il cookie di A -> 404 e la riga di B resta"

code="$(call s24 DELETE "/api/v1/me/sessions/${a_id}" 198.51.100.53 -H "Origin: ${origin}" -H "${a_cookie_hdr}")"
[[ "${code}" == "400" ]] || fail "S24: DELETE della sessione corrente: atteso 400, ottenuto ${code}"
[[ "$(cat "${tmp_dir}/s24.b")" == '{"error":"current"}' ]] || fail "S24: corpo inatteso '$(cat "${tmp_dir}/s24.b")'"
[[ "$(session_count "${a_user}")" == "2" ]] || fail "S24: una richiesta rifiutata ha cambiato le sessioni di A"
echo "ok  S24: DELETE della sessione corrente -> 400 {\"error\":\"current\"}, nulla cancellato"

code="$(call s25 DELETE "/api/v1/me/sessions/${a_old_id}" 198.51.100.54 -H "Origin: ${origin}" -H "${a_cookie_hdr}")"
[[ "${code}" == "200" ]] || fail "S25: DELETE della sessione di 3 giorni fa: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s25.b"))"
[[ "$(cat "${tmp_dir}/s25.b")" == '{"revoked":1}' ]] || fail "S25: corpo inatteso '$(cat "${tmp_dir}/s25.b")'"
code="$(call s25b GET /api/v1/me/sessions 198.51.100.54 -H "${a_cookie_hdr}")"
[[ "$(json_get "${tmp_dir}/s25b.b" 'j.sessions.length')" == "1" ]] || fail "S25: dopo la revoca l'elenco deve avere 1 riga: '$(cat "${tmp_dir}/s25b.b")'"
echo "ok  S25: DELETE della sessione di 3 giorni fa -> 200 {\"revoked\":1}, l'elenco ha 1 riga"

helper session "${a_user}" 1 "${ua_iphone}" >/dev/null
helper session "${a_user}" 2 >/dev/null
[[ "$(session_count "${a_user}")" == "3" ]] || fail "S26: preparazione: attese 3 sessioni di A"
code="$(call s26 DELETE /api/v1/me/sessions 198.51.100.55 -H "Origin: ${origin}" -H "${a_cookie_hdr}")"
[[ "${code}" == "200" ]] || fail "S26: DELETE di tutte le altre: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s26.b"))"
[[ "$(cat "${tmp_dir}/s26.b")" == '{"revoked":2}' ]] || fail "S26: corpo atteso {\"revoked\":2}, ottenuto '$(cat "${tmp_dir}/s26.b")'"
[[ "$(psql_dev "SELECT string_agg(id, ',') FROM auth_session WHERE user_id = '${a_user}'")" == "${a_id}" ]] \
  || fail "S26: deve restare esattamente la sessione corrente"
[[ "$(session_count "${b_user}")" == "1" ]] || fail "S26: le sessioni di B sono cambiate"
echo "ok  S26: DELETE /sessions -> {\"revoked\":2}, resta solo la sessione corrente di A, B intatto"

for target in /api/v1/me/sessions "/api/v1/me/sessions/${a_old_id}"; do
  code="$(call s27a DELETE "${target}" 198.51.100.56 -H "${a_cookie_hdr}")"
  [[ "${code}" == "403" ]] || fail "S27: DELETE ${target} senza Origin: atteso 403, ottenuto ${code}"
  no_store s27a S27
  code="$(call s27b DELETE "${target}" 198.51.100.56 -H "Origin: ${origin}")"
  [[ "${code}" == "401" ]] || fail "S27: DELETE ${target} senza cookie: atteso 401, ottenuto ${code}"
  no_store s27b S27
done
[[ "$(session_count "${a_user}")" == "1" ]] || fail "S27: una richiesta rifiutata ha cambiato le sessioni di A"
echo "ok  S27: DELETE senza Origin -> 403, senza cookie -> 401 (elenco e singola), private no-store"

long_id="$(node -e 'process.stdout.write("a".repeat(65))')"
for bad in "${long_id}" 'a%2Fb' '%2e%2e%2f%2e%2e' 'x.y'; do
  code="$(call s28 DELETE "/api/v1/me/sessions/${bad}" 198.51.100.57 -H "Origin: ${origin}" -H "${a_cookie_hdr}")"
  [[ "${code}" == "404" ]] || fail "S28: id '${bad}': atteso 404, ottenuto ${code}"
done
[[ "$(session_count "${a_user}")" == "1" && "$(session_count "${b_user}")" == "1" ]] || fail "S28: un id non valido ha cancellato una riga"
echo "ok  S28: un id di 65 caratteri, con barra codificata, con '..' o con un punto -> 404, nessuna riga toccata"

# --- S29-S35: esportazione e cancellazione dell'account (ACCT-02, ACCT-03) ----------------
ua_b_only='BOnlyAgent/9.9 (fixture b-only)'
read -r x_user x_cookie x_token <<<"$(helper mint s29-a@fixture.invalid 'Anna Esporta' 0 "${ua_mac}" --fake-tokens | tail -n 1)"
x_cookie_hdr="Cookie: fuorirotta.session_token=${x_cookie}"
helper session "${x_user}" 3 "${ua_iphone}" >/dev/null
read -r y_user y_cookie y_token <<<"$(helper mint s29-b@fixture.invalid 'Bruno Altro' 0 "${ua_b_only}" --fake-tokens | tail -n 1)"
rome_today="$(node -e 'process.stdout.write(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date()))')"

code="$(call s29 GET /api/v1/me/export 198.51.100.61 -H "${x_cookie_hdr}")"
[[ "${code}" == "200" ]] || fail "S29: GET export: atteso 200, ottenuto ${code} ($(head -c 300 "${tmp_dir}/s29.b"))"
[[ "$(header s29 content-disposition)" == "attachment; filename=\"fuorirotta-dati-${rome_today}.json\"" ]] \
  || fail "S29: content-disposition atteso attachment con fuorirotta-dati-${rome_today}.json, ottenuto '$(header s29 content-disposition)'"
[[ "$(header s29 content-type)" == "application/json; charset=utf-8" ]] || fail "S29: content-type inatteso '$(header s29 content-type)'"
no_store s29 S29
[[ "$(json_get "${tmp_dir}/s29.b" 'Object.keys(j).sort().join()')" == "exportedAt,format,linkedAccounts,profile,sessions" ]] \
  || fail "S29: chiavi di primo livello inattese: $(json_get "${tmp_dir}/s29.b" 'Object.keys(j).join()')"
[[ "$(json_get "${tmp_dir}/s29.b" 'j.format === 1 && !Number.isNaN(Date.parse(j.exportedAt))')" == "true" ]] || fail "S29: format o exportedAt inattesi"
[[ "$(json_get "${tmp_dir}/s29.b" 'Object.keys(j.profile).sort().join() + "|" + j.profile.name + "|" + j.profile.email')" == "createdAt,email,emailVerified,image,name|Anna Esporta|s29-a@fixture.invalid" ]] \
  || fail "S29: profilo inatteso: $(json_get "${tmp_dir}/s29.b" 'j.profile')"
[[ "$(json_get "${tmp_dir}/s29.b" 'j.profile.image')" == "https://lh3.googleusercontent.com/a/fixture-photo=s96-c" ]] \
  || fail "S29: l'export deve contenere l'indirizzo della foto (D-20): $(json_get "${tmp_dir}/s29.b" 'j.profile')"
[[ "$(json_get "${tmp_dir}/s29.b" 'j.linkedAccounts.length + "|" + Object.keys(j.linkedAccounts[0]).sort().join() + "|" + j.linkedAccounts[0].provider')" == "1|createdAt,provider,providerAccountId|google" ]] \
  || fail "S29: linkedAccounts inattesi: $(json_get "${tmp_dir}/s29.b" 'j.linkedAccounts')"
[[ "$(json_get "${tmp_dir}/s29.b" 'j.sessions.length + "|" + j.sessions.filter((s) => s.current).length + "|" + j.sessions.every((s) => typeof s.device === "string" && s.device.length > 0)')" == "2|1|true" ]] \
  || fail "S29: sessioni inattese (attese 2, una sola corrente, tutte con device): $(json_get "${tmp_dir}/s29.b" 'j.sessions')"
[[ "$(json_get "${tmp_dir}/s29.b" 'j.sessions.map((s) => s.device).join()')" == "Chrome su Mac,Safari su iPhone" ]] || fail "S29: ordine o device delle sessioni inattesi: $(json_get "${tmp_dir}/s29.b" 'j.sessions.map((s) => s.device)')"
echo "ok  S29: export 200, attachment fuorirotta-dati-${rome_today}.json, private no-store; profile, linkedAccounts (1), sessions (2, una sola current, con device)"

node -e '
const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const secrets = process.argv.slice(2);
const bad = [];
(function walk(v, path) {
  if (Array.isArray(v)) return v.forEach((x, i) => walk(x, path + "[" + i + "]"));
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      if (/token|password|secret/i.test(k)) bad.push("chiave " + path + "." + k);
      walk(x, path + "." + k);
    }
    return;
  }
  if (typeof v === "string" && (secrets.some((s) => v.includes(s)) || /fake-/.test(v))) bad.push("valore in " + path);
})(j, "$");
if (bad.length) { console.error(bad.join("; ")); process.exit(1) }
' "${tmp_dir}/s29.b" "${x_token}" "${x_cookie}" || fail "S30: l'export contiene una chiave o un valore segreto"
echo "ok  S30: nessuna chiave /token|password|secret/i, nessun valore uguale al token di sessione, nessun token finto di Google"

for needle in 's29-b@fixture.invalid' "fixture-${y_user}" "${y_user}" 'BOnlyAgent' 'Bruno Altro' "${y_token}"; do
  if grep -qF "${needle}" "${tmp_dir}/s29.b"; then fail "S31: l'export di A contiene un dato di B: '${needle}'"; fi
done
code="$(call s31 GET /api/v1/me/export 198.51.100.62 -H "Cookie: fuorirotta.session_token=${y_cookie}")"
[[ "${code}" == "200" ]] || fail "S31: export di B: atteso 200, ottenuto ${code}"
if grep -qF 's29-a@fixture.invalid' "${tmp_dir}/s31.b"; then fail "S31: l'export di B contiene l'e-mail di A"; fi
[[ "$(json_get "${tmp_dir}/s31.b" 'j.sessions.length + "|" + j.sessions[0].device')" == "1|Browser sconosciuto" ]] || fail "S31: sessioni di B inattese: $(json_get "${tmp_dir}/s31.b" 'j.sessions')"
echo "ok  S31: nell'export di A nessuna e-mail, account id, nome o user agent di B; e viceversa"

[[ "$(json_get "${tmp_dir}/s31.b" 'Array.isArray(j.linkedAccounts) && Array.isArray(j.sessions) && j.linkedAccounts.length === 1 && j.sessions.length === 1')" == "true" ]] \
  || fail "S32: un utente con un account e una sessione deve avere array di lunghezza 1: $(cat "${tmp_dir}/s31.b")"
echo "ok  S32: un utente con un account e una sessione ha linkedAccounts e sessions di lunghezza 1 (mai null)"

# S33: cancellazione totale con una sessione di 3 giorni fa, due dispositivi, token finti.
read -r c_user c_cookie c_token <<<"$(helper mint s33-c@fixture.invalid 'Carla Cancella' 3 "${ua_mac}" --fake-tokens | tail -n 1)"
c_cookie_hdr="Cookie: fuorirotta.session_token=${c_cookie}"
helper session "${c_user}" 1 "${ua_iphone}" >/dev/null
registry_tables="$(helper registry-tables | grep -E '^auth_' || true)"
[[ -n "${registry_tables}" ]] || fail "S33: il registro non ha tabelle"
user_rows() { # <userId> -> "tabella=conteggio ..." (auth_user + ogni tabella del registro)
  local out="auth_user=$(psql_dev "SELECT count(*) FROM auth_user WHERE id = '$1'")" t
  for t in ${registry_tables}; do out+=" ${t}=$(psql_dev "SELECT count(*) FROM ${t} WHERE user_id = '$1'")"; done
  echo "${out}"
}
[[ "$(user_rows "${c_user}")" == "auth_user=1 auth_session=2 auth_account=1" ]] \
  || fail "S33: preparazione: righe di C inattese '$(user_rows "${c_user}")'"
b_before="$(user_rows "${y_user}")"
code="$(call s33 POST /api/auth/delete-user 198.51.100.63 -H "Origin: ${origin}" -H 'Content-Type: application/json' -H "${c_cookie_hdr}" --data '{}')"
[[ "${code}" == "200" ]] || fail "S33: delete-user con la sessione di 3 giorni fa: atteso 200, ottenuto ${code} ($(cat "${tmp_dir}/s33.b"))"
cleared="$(grep -i '^set-cookie: fuorirotta.session_token=' "${tmp_dir}/s33.h" | head -n 1 | tr -d '\r' || true)"
grep -qi 'max-age=0' <<<"${cleared}" || fail "S33: manca il Set-Cookie che azzera il cookie di sessione (Max-Age=0): '${cleared}'"
after="$(user_rows "${c_user}")"
for t in auth_user ${registry_tables}; do
  grep -qF "${t}=0" <<<"${after}" || fail "S33: dopo la cancellazione restano righe in ${t}: ${after}"
done
[[ "$(user_rows "${y_user}")" == "${b_before}" ]] || fail "S33: le righe di B sono cambiate: prima '${b_before}', dopo '$(user_rows "${y_user}")'"
echo "ok  S33: delete-user {} con il cookie di una sessione di 3 giorni fa -> 200, Set-Cookie Max-Age=0; zero righe di C in ${after}; B intatto (${b_before})"

code="$(call s34a POST /api/auth/delete-user 198.51.100.64 -H "Origin: ${origin}" -H 'Content-Type: application/json' -H "${c_cookie_hdr}" --data '{}')"
[[ "${code}" == "401" ]] || fail "S34: secondo delete-user con il cookie ormai morto: atteso 401, ottenuto ${code}"
code="$(call s34b POST /api/auth/delete-user 198.51.100.64 -H "Origin: ${origin}" -H 'Content-Type: application/json' --data '{}')"
[[ "${code}" == "401" ]] || fail "S34: delete-user senza cookie: atteso 401, ottenuto ${code}"
[[ "$(user_rows "${y_user}")" == "${b_before}" ]] || fail "S34: le righe di B sono cambiate"
echo "ok  S34: un secondo delete-user con lo stesso cookie ormai morto e uno senza cookie -> 401, nessuna riga toccata"

for target in /api/v1/me/export /api/v1/me/sessions; do
  code="$(call s35 GET "${target}" 198.51.100.65)"
  [[ "${code}" == "401" ]] || fail "S35: GET ${target} senza cookie: atteso 401, ottenuto ${code}"
  no_store s35 S35
done
echo "ok  S35: export ed elenco sessioni senza cookie -> 401, private no-store"
