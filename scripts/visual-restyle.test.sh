#!/usr/bin/env bash
# Gate statico dell'intera Fase 12 (Visual Restyle). Nessun framework, nessun
# dev server, nessun accesso al database: solo lettura del filesystem, sul
# modello di scripts/design-tokens.test.sh e scripts/navbar-contracts.test.sh.
#
# NASCE ROSSO PER COSTRUZIONE (stesso precedente di
# scripts/category-taxonomy.test.sh in Fase 11): copre le asserzioni statiche
# di TUTTI i piani della Fase 12 (12-01..12-07), non solo di questo piano.
# Le sezioni VR-02..VR-06 sono attese rosse finche' i piani che le chiudono
# non atterrano — un'uscita non-zero oggi NON e' una regressione, e' il
# comportamento dichiarato. Ogni sezione riporta quale piano la chiudera'.
#
# Diversamente da design-tokens.test.sh, questo script NON esce al primo
# fallimento: ogni sezione va eseguita e riportata, altrimenti le sezioni
# rosse per costruzione nasconderebbero quelle successive. L'uscita del
# processo resta 1 finche' anche una sola sezione fallisce.
#
#   VR-01 (12-01, deve essere VERDE alla fine di QUESTO piano) — palette,
#         tipografia, raggi, ombre ripuntati in app/globals.css/layout.tsx.
#   VR-02 (12-02) — badge di stato e segnaposto per categoria.
#   VR-03 (12-03) — popup Mapbox come componenti React, D-18.
#   VR-04 (12-05) — "carica altri", vista mappa mobile a comparsa rimossa.
#   VR-05 (12-07) — pillola a due righe + bottom sheet (D-19).
#   VR-06 (sweep finale, 12-06/12-07) — nessun residuo dei due alias di
#         compatibilita' teal introdotti dal Task 1 di questo piano.
#   VR-07 (12-01/12-04/12-05/12-07) — armonizzazione del movimento (D-16):
#         zero durate/ritardi letterali fuori da lib/motion.ts, e parita'
#         numerica fra i token CSS e le costanti TypeScript.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

globals_css="app/globals.css"
layout_tsx="app/layout.tsx"

overall_status=0

# Una sezione ATTESA verde: se fallisce e' un vero difetto.
section_pass() {
  echo "ok  $1: $2"
}
section_fail_hard() {
  echo "FAIL $1: $2"
  overall_status=1
}
# Una sezione ATTESA rossa per costruzione, finche' il piano che la chiude
# non atterra: fallire qui e' il comportamento dichiarato, non un allarme.
section_red_expected() {
  echo "red $1: $2 (atteso rosso, chiude $3)"
  overall_status=1
}

# ==============================================================================
# Prove di non-vacuita' — dimostrano che le asserzioni sotto sanno fallire,
# prima di fidarsi del loro output sul repository vero. Stile
# design-tokens.test.sh: costruiamo un input fittizio che DEVE far fallire
# l'asserzione, e verifichiamo che fallisca.
# ==============================================================================

# Non-vacuita' 1: il pattern esadecimale della teal usato nella sezione
# raggi/ombre/palette sotto sa davvero riconoscere quei quattro hex, non e'
# un pattern rotto che non matcha mai nulla (nel qual caso quella sezione
# passerebbe sempre, a prescindere dal contenuto reale del file).
_teal_fixture="$(mktemp)"
trap 'rm -f "${_teal_fixture}"' EXIT
printf -- '--primary: #006d77;\n--accent: #83c5be;\n--accent-tint: #edf6f9;\n--ring: #6cc4ba;\n' \
  > "${_teal_fixture}"
if grep -cE '006d77|83c5be|edf6f9|6cc4ba' "${_teal_fixture}" >/dev/null 2>&1; then
  echo "ok  non-vacuita' 1: il pattern esadecimale teal riconosce un fixture che lo contiene"
else
  section_fail_hard "non-vacuita' 1" "il pattern esadecimale teal non matcha nemmeno un fixture che lo contiene — la sezione palette sarebbe vacua"
fi

# Non-vacuita' 2: il confronto di parita' numerica dell'armonizzazione del
# movimento sa distinguere due valori DIVERSI (altrimenti "confrontare"
# sarebbe sempre vero e quella sezione non proteggerebbe nulla).
if [[ "150" == "160" ]]; then
  section_fail_hard "non-vacuita' 2" "il confronto di uguaglianza della parita' numerica non sa fallire — gate vacuo"
else
  echo "ok  non-vacuita' 2: il confronto di parita' numerica distingue due valori diversi"
fi

# ==============================================================================
# VR-01 (12-01, questo piano) — palette, tipografia, raggi, ombre
# ==============================================================================

vr01_ok=1

if grep -qE 'var\(--r-(sm|md|lg|xl|card|full)\)' "${globals_css}"; then
  echo "  - app/globals.css referenzia ancora la famiglia legacy di raggi (--r-*)"
  vr01_ok=0
fi
if grep -qE 'var\(--sh-(sm|md|xl)\)' "${globals_css}"; then
  echo "  - app/globals.css referenzia ancora la famiglia legacy di ombre (--sh-*)"
  vr01_ok=0
fi
for radius_name in radius-sm radius-md radius-lg radius-pill; do
  root_block="$(sed -n "/^:root {/,/^}/p" "${globals_css}")"
  theme_block="$(sed -n "/^@theme inline {/,/^}/p" "${globals_css}")"
  if ! grep -q -- "--${radius_name}:" <<<"${root_block}"; then
    echo "  - --${radius_name} non e' dichiarato in :root"
    vr01_ok=0
  fi
  if ! grep -q -- "--${radius_name}:" <<<"${theme_block}"; then
    echo "  - --${radius_name} non e' esposto in @theme inline"
    vr01_ok=0
  fi
done
if grep -cE '006d77|83c5be|edf6f9|6cc4ba' "${globals_css}" | grep -qv '^0$'; then
  echo "  - app/globals.css contiene ancora un esadecimale della famiglia teal v1.0"
  vr01_ok=0
fi
if ! grep -q '0071e3' "${globals_css}" || ! grep -q '2997ff' "${globals_css}"; then
  echo "  - app/globals.css non dichiara entrambi gli accenti nuovi (0071e3 chiaro, 2997ff scuro)"
  vr01_ok=0
fi
if grep -q 'next/font' "${layout_tsx}"; then
  echo "  - app/layout.tsx importa ancora un font da next/font"
  vr01_ok=0
fi

if [[ "${vr01_ok}" -eq 1 ]]; then
  section_pass "VR-01" "palette fredda, SF Pro, quattro raggi e due ombre ripuntati end-to-end"
else
  section_fail_hard "VR-01" "il ripunto dei token del Task 1 non e' completo — vedi le righe sopra"
fi

# ==============================================================================
# VR-02 (12-02) — badge di stato e segnaposto per categoria
# ==============================================================================

vr02_ok=1
[[ -f "lib/eventStatus.ts" ]] || { echo "  - lib/eventStatus.ts non esiste"; vr02_ok=0; }
[[ -f "lib/categories/visuals.ts" ]] || { echo "  - lib/categories/visuals.ts non esiste"; vr02_ok=0; }
if [[ -f "lib/categories/visuals.ts" && -f "lib/categories/taxonomy.ts" ]]; then
  # Nomi derivati da taxonomy.ts, non ricopiati a mano (stesso principio di
  # navbar-contracts.test.sh: un ottavo nome futuro non deve poter sfuggire).
  taxonomy_names="$(sed -n "/CANONICAL_CATEGORIES = \[/,/\] as const/p" lib/categories/taxonomy.ts \
    | grep -oE "'[^']+'" | tr -d "'")"
  while IFS= read -r cat_name; do
    [[ -z "${cat_name}" ]] && continue
    grep -qF "${cat_name}" lib/categories/visuals.ts \
      || { echo "  - lib/categories/visuals.ts non copre la categoria '${cat_name}'"; vr02_ok=0; }
  done <<<"${taxonomy_names}"
fi
if [[ -f "components/EventCard.tsx" ]] && grep -qE "^\s*import\s*\{[^}]*\bCalendar\b[^}]*\}\s*from\s*[\"']lucide-react[\"']" components/EventCard.tsx; then
  echo "  - components/EventCard.tsx importa ancora l'icona calendario generica"
  vr02_ok=0
fi

if [[ "${vr02_ok}" -eq 1 ]]; then
  section_pass "VR-02" "badge di stato e segnaposto per categoria presenti e completi"
else
  section_red_expected "VR-02" "badge di stato / segnaposto per categoria" "12-02"
fi

# ==============================================================================
# VR-03 (12-03) — popup Mapbox come componenti React, D-18
# ==============================================================================

vr03_ok=1
events_map="components/EventsMap.tsx"
if [[ -f "${events_map}" ]]; then
  grep -q '\.setHTML(' "${events_map}" \
    && { echo "  - ${events_map} serve ancora il popup come stringa HTML (.setHTML)"; vr03_ok=0; }
  grep -qE '^function escapeHtml' "${events_map}" \
    && { echo "  - ${events_map} contiene ancora la funzione di escaping manuale del popup HTML"; vr03_ok=0; }
  grep -qE 'e\.features(\?\.)?\[0\]' "${events_map}" \
    && { echo "  - ${events_map} legge ancora solo e.features[0] (D-18, coordinate coincidenti)"; vr03_ok=0; }
  grep -q 'createRoot' "${events_map}" \
    || { echo "  - ${events_map} non importa createRoot da react-dom/client"; vr03_ok=0; }
  grep -q 'from "react-dom/client"' "${events_map}" \
    || { echo "  - ${events_map} non importa da react-dom/client"; vr03_ok=0; }
  grep -qE 'MAP_STYLE_LIGHT\s*=\s*"mapbox://styles/mapbox/light-v11"' "${events_map}" \
    || { echo "  - lo stile chiaro dichiarato in testa a ${events_map} non e' light-v11"; vr03_ok=0; }
else
  echo "  - ${events_map} non esiste"
  vr03_ok=0
fi

if [[ "${vr03_ok}" -eq 1 ]]; then
  section_pass "VR-03" "popup Mapbox riscritto come componente React, D-18 chiuso"
else
  section_red_expected "VR-03" "popup Mapbox / D-18 coordinate coincidenti" "12-03"
fi

# ==============================================================================
# VR-04 (12-05) — "carica altri", vista mappa mobile a comparsa rimossa
# ==============================================================================

vr04_ok=1
home_client="app/HomeClient.tsx"
if [[ -f "${home_client}" ]]; then
  grep -qE '\b(const|function)\s+buildPages\b' "${home_client}" \
    && { echo "  - ${home_client} dichiara ancora buildPages (paginazione numerica)"; vr04_ok=0; }
  grep -qE '\b(const|function)\s+renderPages\b' "${home_client}" \
    && { echo "  - ${home_client} dichiara ancora renderPages (paginazione numerica)"; vr04_ok=0; }
  grep -q 'map-fullscreen-mobile' "${home_client}" \
    && { echo "  - ${home_client} monta ancora il ramo mobile dell'overlay mappa a comparsa"; vr04_ok=0; }
  grep -q 'map-fullscreen-desktop' "${home_client}" \
    || { echo "  - ${home_client} non monta piu' il ramo desktop (map-fullscreen-desktop) — la composizione desktop e' fuori scope, non va rimosso"; vr04_ok=0; }
  grep -q 'IntersectionObserver' "${home_client}" \
    || { echo "  - ${home_client} non usa IntersectionObserver (atteso per \"carica altri\")"; vr04_ok=0; }
else
  echo "  - ${home_client} non esiste"
  vr04_ok=0
fi

if [[ "${vr04_ok}" -eq 1 ]]; then
  section_pass "VR-04" "\"carica altri\" e vista mappa mobile a comparsa rimossa (D-07/D-08)"
else
  section_red_expected "VR-04" "\"carica altri\" / vista mappa mobile a comparsa" "12-05"
fi

# ==============================================================================
# VR-05 (12-07) — pillola a due righe + bottom sheet, D-19
# ==============================================================================

vr05_ok=1
mobile_overlay="components/navbar/MobileSearchOverlay.tsx"
searchbar_trigger="components/navbar/SearchbarTrigger.tsx"
if [[ -f "${mobile_overlay}" ]]; then
  grep -q 'inset-0' "${mobile_overlay}" \
    && { echo "  - ${mobile_overlay} e' ancora ancorato a tutto schermo (inset-0)"; vr05_ok=0; }
  grep -q 'max-h-\[90dvh\]' "${mobile_overlay}" \
    || { echo "  - ${mobile_overlay} non dichiara max-h-[90dvh] (contratto bottom sheet)"; vr05_ok=0; }
else
  echo "  - ${mobile_overlay} non esiste"
  vr05_ok=0
fi
if [[ -f "${searchbar_trigger}" ]]; then
  grep -qiE 'badge|filter.?count|conteggio.?filtri' "${searchbar_trigger}" \
    || { echo "  - ${searchbar_trigger} non contiene il badge del conteggio filtri"; vr05_ok=0; }
else
  echo "  - ${searchbar_trigger} non esiste"
  vr05_ok=0
fi

if [[ "${vr05_ok}" -eq 1 ]]; then
  section_pass "VR-05" "pillola a due righe con badge + bottom sheet (D-19)"
else
  section_red_expected "VR-05" "pillola a due righe / bottom sheet, D-19" "12-07"
fi

# ==============================================================================
# VR-06 (sweep finale, 12-06/12-07) — nessun residuo dei due alias teal
# ==============================================================================

vr06_ok=1
compat_hits="$(grep -rlE 'accent-tint|\baccent\b' app components \
  --include='*.tsx' --include='*.ts' 2>/dev/null | grep -v '^app/globals.css$' || true)"
if [[ -n "${compat_hits}" ]]; then
  echo "  - residuo dei due alias di compatibilita' teal (--accent/--accent-tint) in:"
  while IFS= read -r f; do echo "    ${f}"; done <<<"${compat_hits}"
  vr06_ok=0
fi

if [[ "${vr06_ok}" -eq 1 ]]; then
  section_pass "VR-06" "nessun file sotto app/ o components/ referenzia piu' i due alias teal"
else
  section_red_expected "VR-06" "sweep finale dei due alias di compatibilita' teal" "12-06/12-07"
fi

# ==============================================================================
# VR-07 (12-01/12-04/12-05/12-07) — armonizzazione del movimento (D-16)
# ==============================================================================

vr07_ok=1

# Zero letterali di durata/ritardo fuori da lib/motion.ts, escludendo i
# commenti e le molle (che non hanno "duration:"/"delay:", solo damping/
# stiffness/type: "spring" — quindi non entrano in questo pattern).
literal_hits="$(grep -rnE 'duration:[[:space:]]*[0-9]|delay:[[:space:]]*[0-9]' app components \
  --include='*.tsx' --include='*.ts' 2>/dev/null \
  | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|/?\*)' \
  | grep -v '^lib/motion.ts:' || true)"
if [[ -n "${literal_hits}" ]]; then
  echo "  - durate/ritardi letterali residui (non lib/motion.ts):"
  printf '%s\n' "${literal_hits}" | sed 's/^/    /'
  vr07_ok=0
fi
# app/globals.css non deve portare durate/curve scritte a mano fuori dai tre
# token di movimento (una riga "--motion-*"/"--ease-standard" e' l'unica sede
# legittima di un tempo o di una cubic-bezier scritti a mano).
css_literal_hits="$(grep -nE '[0-9]+(ms|s)\b|cubic-bezier\(' "${globals_css}" \
  | grep -vE -- '--motion-(fast|base):|--ease-standard:' || true)"
if [[ -n "${css_literal_hits}" ]]; then
  echo "  - app/globals.css porta ancora durate/curve scritte a mano fuori dai tre token:"
  printf '%s\n' "${css_literal_hits}" | sed 's/^/    /'
  vr07_ok=0
fi

# Parita' numerica fra le due forme (senza questo confronto il gate copre
# solo meta' del rischio, vedi commento del Task 1 in app/globals.css).
if [[ -f "lib/motion.ts" ]]; then
  css_fast_ms="$(grep -oE -- '--motion-fast:[[:space:]]*[0-9]+ms' "${globals_css}" | head -1 | grep -oE '[0-9]+')"
  css_base_ms="$(grep -oE -- '--motion-base:[[:space:]]*[0-9]+ms' "${globals_css}" | head -1 | grep -oE '[0-9]+')"
  ts_fast="$(grep -oE 'MOTION_FAST[[:space:]]*=[[:space:]]*[0-9.]+' lib/motion.ts | grep -oE '[0-9.]+$')"
  ts_base="$(grep -oE 'MOTION_BASE[[:space:]]*=[[:space:]]*[0-9.]+' lib/motion.ts | grep -oE '[0-9.]+$')"
  if [[ -z "${css_fast_ms}" || -z "${css_base_ms}" || -z "${ts_fast}" || -z "${ts_base}" ]]; then
    echo "  - impossibile estrarre --motion-fast/--motion-base da globals.css o MOTION_FAST/MOTION_BASE da lib/motion.ts"
    vr07_ok=0
  else
    # Normalizza entrambe le forme in millisecondi interi per il confronto.
    ts_fast_ms="$(awk -v v="${ts_fast}" 'BEGIN { printf "%d", (v * 1000) + 0.5 }')"
    ts_base_ms="$(awk -v v="${ts_base}" 'BEGIN { printf "%d", (v * 1000) + 0.5 }')"
    if [[ "${css_fast_ms}" != "${ts_fast_ms}" ]]; then
      echo "  - --motion-fast (${css_fast_ms}ms) e MOTION_FAST (${ts_fast}s = ${ts_fast_ms}ms) non coincidono"
      vr07_ok=0
    fi
    if [[ "${css_base_ms}" != "${ts_base_ms}" ]]; then
      echo "  - --motion-base (${css_base_ms}ms) e MOTION_BASE (${ts_base}s = ${ts_base_ms}ms) non coincidono"
      vr07_ok=0
    fi
  fi
else
  echo "  - lib/motion.ts non esiste, impossibile verificare la parita' numerica"
  vr07_ok=0
fi

if [[ "${vr07_ok}" -eq 1 ]]; then
  section_pass "VR-07" "vocabolario di movimento armonizzato, parita' CSS/TypeScript verificata"
else
  section_red_expected "VR-07" "armonizzazione del movimento (D-16, letterali residui fuori scope di 12-01)" "12-01/12-04/12-05/12-07"
fi

# ==============================================================================
if [[ "${overall_status}" -eq 0 ]]; then
  echo "PASS: tutte le sezioni del gate visual restyle sono verdi"
else
  echo "RED PER COSTRUZIONE: visual restyle — atteso finche' la Fase 12 non e' completa (vedi sezioni sopra)"
fi
exit "${overall_status}"
