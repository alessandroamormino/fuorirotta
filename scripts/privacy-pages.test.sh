#!/usr/bin/env bash
# Gate delle pagine legali (check:privacy-pages, test:ci) - ACCT-04, D-15.
# Solo file system: gira anche su Ubuntu in CI, nessun database, nessun server.
#
# Perche' esiste: /privacy e /cookie sono dichiarazioni di cui il titolare e'
# responsabile. Una pagina che dice "24 ore" mentre il codice cancella dopo 48,
# o che nomina una funzione non ancora uscita, e' una dichiarazione falsa. Il
# gate lega i numeri alle costanti del codice e vieta i residui della bozza.
#
#   P1  le due pagine esistono, sono statiche: niente "use client", niente
#       cookies(, headers( o searchParams (nemmeno nel guscio LegalPage)
#   P2  nessun segnaposto della bozza ("NOTA PER", "[data", "MODIFICA D-20", TODO...)
#   P3  /privacy nomina titolare ed e-mail, i fornitori e il Garante; la durata
#       della sessione e' quella di lib/auth.ts (expiresIn)
#   P4  le ore dei tentativi di accesso sono AUTH_RATE_LIMIT_RETENTION_HOURS e i
#       giorni di backup sono il default di scripts/cron-backup.sh
#   P5  /cookie apre con la frase fissa e nomina i due cookie che il sign-in imposta
#       (21-03: session_token e state), con la durata della sessione del codice
#   P6  nessuna riga per funzioni non ancora uscite (elenco "Da riaggiungere" di 21-02,
#       meno gli eventi salvati e il calendario, usciti con la fase 22)
#   P7  il dialogo di accesso e il piede di pagina collegano le pagine
#   P8  i mesi di conservazione dei salvati sono SAVED_RETENTION_MONTHS (22-05), in /privacy e /cookie
#   P9  /privacy nomina gli eventi salvati e il rimedio del collegamento al calendario ("Rigenera link")
#
# Regola della TAB letterale: niente `\t` nei grep (BSD e GNU differiscono),
# solo classi [[:space:]]. Dove un grep puo' legittimamente non trovare nulla
# c'e' `|| true`.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

privacy="app/privacy/page.tsx"
cookie="app/cookie/page.tsx"
shell="components/legal/LegalPage.tsx"
purge="lib/retention/purgeAuth.ts"
auth="lib/auth.ts"
backup="scripts/cron-backup.sh"
retention="lib/saved/retention.ts"

fail() {
  echo "FAIL: $1"
  exit 1
}

# has <file> <testo letterale>: il testo compare nel file.
has() { grep -qF -- "$2" "$1"; }

for f in "${privacy}" "${cookie}" "${shell}" "${purge}" "${auth}" "${backup}" "${retention}" \
  components/account/SignIn.tsx components/Footer.tsx; do
  [[ -f "${f}" ]] || fail "${f} non esiste"
done

# --- P1 ------------------------------------------------------------------
for f in "${privacy}" "${cookie}" "${shell}"; do
  first="$(grep -vE '^[[:space:]]*(//|/\*|\*|$)' "${f}" | head -n 1 || true)"
  case "${first}" in
    *'use client'*) fail "P1 ${f} e' un componente client: la pagina legale deve restare statica" ;;
  esac
  if grep -nE 'cookies\(|headers\(|searchParams' "${f}" >/dev/null 2>&1; then
    # I commenti possono citare i nomi: contano solo le righe di codice.
    code_hits="$(grep -nE 'cookies\(|headers\(|searchParams' "${f}" | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*)' || true)"
    [[ -z "${code_hits}" ]] || fail "P1 ${f} legge la richiesta: ${code_hits}"
  fi
done
echo "ok  P1 pagine presenti e statiche"

# --- P2 ------------------------------------------------------------------
for f in "${privacy}" "${cookie}"; do
  hit="$(grep -nE 'NOTA PER|MODIFICA D-20|\[data|da inserire|TODO|FIXME|TBD|lorem' "${f}" || true)"
  [[ -z "${hit}" ]] || fail "P2 segnaposto della bozza in ${f}: ${hit}"
done
echo "ok  P2 nessun segnaposto della bozza"

# --- P3 ------------------------------------------------------------------
# Nome ed e-mail del titolare sono scritti qui perche' il testo approvato sta in
# .planning (ignorato da git) e non c'e' in CI.
for needle in "Alessandro Amormino" "amormino.alessandro97@gmail.com" "Supabase" "Hetzner" "Mapbox" \
  "Google" "Garante per la protezione dei dati personali" "Titolare del trattamento" \
  "Destinatari e responsabili del trattamento" "Conservazione" "In questa pagina"; do
  if [[ "${needle}" == "In questa pagina" ]]; then
    has "${shell}" "${needle}" || fail "P3 ${shell} non contiene '${needle}'"
  else
    has "${privacy}" "${needle}" || fail "P3 ${privacy} non contiene '${needle}'"
  fi
done
session_days="$(sed -nE 's/.*expiresIn:[[:space:]]*60[[:space:]]*\*[[:space:]]*60[[:space:]]*\*[[:space:]]*24[[:space:]]*\*[[:space:]]*([0-9]+).*/\1/p' "${auth}" | head -n 1 || true)"
[[ -n "${session_days}" ]] || fail "P3 non trovo 'expiresIn: 60 * 60 * 24 * N' in ${auth}"
has "${privacy}" "${session_days} giorni" || fail "P3 ${privacy} non dice '${session_days} giorni' per le sessioni (expiresIn)"
echo "ok  P3 titolare, fornitori e Garante; sessioni ${session_days} giorni come il codice"

# --- P4 ------------------------------------------------------------------
hours="$(sed -nE 's/.*AUTH_RATE_LIMIT_RETENTION_HOURS[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' "${purge}" | head -n 1 || true)"
[[ -n "${hours}" ]] || fail "P4 non trovo 'AUTH_RATE_LIMIT_RETENTION_HOURS = N' in ${purge}"
has "${privacy}" "${hours} ore" || fail "P4 ${privacy} non dice '${hours} ore' per i tentativi di accesso (AUTH_RATE_LIMIT_RETENTION_HOURS)"
# Un'altra durata in ore accanto ai tentativi sarebbe una dichiarazione falsa.
other_hours="$(grep -oE '[0-9]+ ore' "${privacy}" | grep -vxF "${hours} ore" || true)"
[[ -z "${other_hours}" ]] || fail "P4 ${privacy} dice anche '${other_hours}': solo '${hours} ore' e' nel codice"
backup_days="$(sed -nE 's/.*retention_days="\$\{retention_days:-([0-9]+)\}".*/\1/p' "${backup}" | head -n 1 || true)"
[[ -n "${backup_days}" ]] || fail "P4 non trovo il default di retention_days in ${backup}"
has "${privacy}" "la teniamo per ${backup_days} giorni" || fail "P4 ${privacy} non dice 'la teniamo per ${backup_days} giorni' (default di ${backup})"
has "${privacy}" "fino a ${backup_days} giorni" || fail "P4 ${privacy} non dice 'fino a ${backup_days} giorni' per i dati nei backup"
echo "ok  P4 ${hours} ore e backup ${backup_days} giorni come il codice"

# --- P5 ------------------------------------------------------------------
has "${cookie}" "Non usiamo cookie di profilazione né di terze parti, quindi non c'è nessun banner." \
  || fail "P5 ${cookie} non apre con la frase fissa (D-14)"
has "${cookie}" "__Secure-fuorirotta.session_token" || fail "P5 ${cookie} non nomina __Secure-fuorirotta.session_token"
has "${cookie}" "__Secure-fuorirotta.state" || fail "P5 ${cookie} non nomina __Secure-fuorirotta.state (cookie del passaggio da Google, 21-03)"
has "${cookie}" "${session_days} giorni" || fail "P5 ${cookie} non dice '${session_days} giorni' per la sessione"
n_tec="$(grep -cF 'Tecnico, necessario' "${cookie}" || true)"
[[ "${n_tec}" -ge 2 ]] || fail "P5 ogni cookie deve avere il tipo 'Tecnico, necessario' (trovati ${n_tec})"
echo "ok  P5 /cookie: frase fissa e due cookie con tipo"

# --- P6 ------------------------------------------------------------------
# Funzioni di fasi successive (21-02 "Da riaggiungere"): non devono comparire.
for f in "${privacy}" "${cookie}"; do
  hit="$(grep -niE 'luoghi seguiti|categorie seguite|token del dispositivo|device token|notifiche push|notifiche|Apple' "${f}" || true)"
  [[ -z "${hit}" ]] || fail "P6 ${f} parla di funzioni non ancora uscite: ${hit}"
done
echo "ok  P6 nessuna funzione non ancora uscita"

# --- P7 ------------------------------------------------------------------
has components/account/SignIn.tsx 'href="/privacy"' || fail "P7 SignIn.tsx non collega /privacy"
has components/Footer.tsx 'href="/privacy"' || fail "P7 Footer.tsx non collega /privacy"
has components/Footer.tsx 'href="/cookie"' || fail "P7 Footer.tsx non collega /cookie"
echo "ok  P7 dialogo di accesso e piede di pagina collegano le pagine"

# --- P8 ------------------------------------------------------------------
months="$(sed -nE 's/.*SAVED_RETENTION_MONTHS[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' "${retention}" | head -n 1 || true)"
[[ -n "${months}" ]] || fail "P8 non trovo 'SAVED_RETENTION_MONTHS = N' in ${retention}"
for f in "${privacy}" "${cookie}"; do
  has "${f}" "${months} mesi" || fail "P8 ${f} non dice '${months} mesi' per i salvati (SAVED_RETENTION_MONTHS)"
done
# Un'altra durata in mesi sarebbe una dichiarazione falsa (specchio di P4).
other_months="$(grep -oE '[0-9]+ mesi' "${privacy}" | grep -vxF "${months} mesi" || true)"
[[ -z "${other_months}" ]] || fail "P8 ${privacy} dice anche '${other_months}': solo '${months} mesi' e' nel codice"
echo "ok  P8 salvati ${months} mesi come il codice"

# --- P9 ------------------------------------------------------------------
has "${privacy}" "eventi salvati" || fail "P9 ${privacy} non nomina gli eventi salvati"
has "${privacy}" "Rigenera link" || fail "P9 ${privacy} non nomina il rimedio 'Rigenera link' del collegamento al calendario"
echo "ok  P9 eventi salvati e rimedio del collegamento al calendario"
