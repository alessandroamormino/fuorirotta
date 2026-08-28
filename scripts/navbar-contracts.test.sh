#!/usr/bin/env bash
# Gate bash per i due contratti della decomposizione Navbar verificabili senza
# browser (D-14). Nessun framework, nessun dev server, nessun accesso al
# database: solo lettura del filesystem, sul modello di
# scripts/design-tokens.test.sh.
#
#   D-06  la lista redazionale delle destinazioni non torna dentro il
#         componente: resta importata da lib/destinations.ts.
#   D-12  la direttiva "use client" sta solo sui sei file che ne hanno
#         bisogno, e ciascuno porta un commento di motivazione entro le
#         righe 2-4. Presenza e assenza sono entrambe verificate: un gate
#         che controllasse solo la presenza passerebbe anche con la
#         direttiva su ogni file del repository.
#   D-09/D-10  lo stato non si duplica fuori dalla shell: l'hook condiviso
#         e' chiamato una volta sola, dalla shell, e nessuno dei cinque
#         componenti di superficie lo richiama per conto proprio.
#   D-07  fonte unica in app/HomeClient.tsx: la Navbar e' un componente
#         controllato (filters + onFiltersChange), senza copia interna dei
#         filtri e senza il rattoppo restoredFilters di Fase 11; il
#         ripristino da sessionStorage gira prima del primo paint.
#   D-08  regola di propagazione unica per mobile e desktop: clearMobile
#         chiama la stessa resetFilters() di clear(), l'asimmetria D-16 di
#         Fase 9 e' chiusa.
#   D-09/D-10 (Fase 17)  un solo montaggio di ThemeToggle in tutto il
#         prodotto reso a utente, dentro components/Navbar.tsx; il logo e'
#         in flusso (niente piu' absolute left-4). Sigla condivisa con le
#         D-09/D-10 della Fase 9 sopra (fasi diverse, decisioni diverse:
#         qui e' posizione del toggle/logo, li' era chiamata unica
#         dell'hook).
#   D-01/D-02/D-04/D-05 (Fase 17, piano 03)  la pillola collassata desktop
#         e' lo stesso componente condiviso col mobile (SearchbarTrigger.tsx,
#         montato due volte, nessuna terza copia), e il morph pillola/barra
#         usa la stessa famiglia di animazione a molla dei due
#         layoutId="activeRing" gia' presenti — non un secondo layoutId.
#   D-03/D-11 (Fase 17, piano 04)  nessun gate puo' osservare dove va il
#         focus: queste asserzioni verificano che i MECCANISMI del
#         confinamento (inert su <main>, onPanelOpenChange) e del contratto
#         mobile (Dialog.ContentUnstyled+asChild, autoFocus) esistano, e che
#         il listener manuale su document rimosso da T-09-13 non torni.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

fail() {
  echo "FAIL: $1"
  exit 1
}

# WR-04: le liste erano hard-coded e MobileSearchbarTrigger.tsx (un vero
# componente client: "use client" + framer-motion + onClick) non compariva
# in nessuna delle due, sfuggendo sia al controllo D-12 sia al controllo
# D-09/D-10. Derivate da components/navbar/*.tsx cosi' un settimo componente
# futuro non puo' sfuggire allo stesso modo.
# mapfile/readarray richiede bash 4+: non e' un'opzione portabile qui, il
# bash di sistema su macOS resta 3.2 (licenza GPLv3, mai aggiornato da
# Apple) — read -r in un while e' l'equivalente compatibile.
navbar_components=()
while IFS= read -r f; do
  navbar_components+=("${f}")
done < <(find components/navbar -name '*.tsx' | sort)
client_files=("${navbar_components[@]}" "components/Navbar.tsx")
server_files=(
  "lib/destinations.ts"
  "lib/hooks/useNavbarSearch.ts"
  "lib/types.ts"
)
surface_files=("${navbar_components[@]}")

for f in "${client_files[@]}" "${server_files[@]}"; do
  [[ -f "${f}" ]] || fail "file atteso assente: ${f}"
done

# --- D-06: la lista redazionale non torna nel componente ---------------------
#
# Cerca la FORMA DICHIARATIVA (parola chiave di dichiarazione seguita dal nome
# della costante), non la semplice occorrenza del nome, che e' legittima
# nell'import e nell'uso.
for f in "${client_files[@]}"; do
  if grep -nE '\b(const|let|var)[[:space:]]+SUGGESTED_DESTINATIONS\b' "${f}" >/dev/null; then
    fail "D-06: ${f} dichiara SUGGESTED_DESTINATIONS invece di importarla da lib/destinations.ts"
  fi
done
grep -lq 'SUGGESTED_DESTINATIONS' "${client_files[@]}" lib/hooks/useNavbarSearch.ts \
  || fail "D-06: nessun file della Navbar importa/usa piu' SUGGESTED_DESTINATIONS — il collegamento a lib/destinations.ts sembra perso"
echo "ok  D-06: SUGGESTED_DESTINATIONS non e' ridichiarata in nessuno dei sei file client"

# --- D-12: direttiva client presente con motivazione, e assente altrove ------

# Verifica un singolo file: la prima riga e' esattamente '"use client";' e
# almeno una delle righe 2-4 e' un commento (// o /*). Restituisce 0 se il
# contratto e' rispettato, 1 altrimenti — cosi' la stessa funzione serve sia
# per il controllo vero sia per la prova di non-vacuita' piu' sotto.
has_client_directive_with_reason() {
  local file="$1"
  head -n 1 "${file}" | grep -qE '^"use client";?$' || return 1
  sed -n '2,4p' "${file}" | grep -qE '^[[:space:]]*(//|/\*)' || return 1
  return 0
}

for f in "${client_files[@]}"; do
  has_client_directive_with_reason "${f}" \
    || fail "D-12: ${f} non porta 'use client' in prima riga con un commento di motivazione entro le righe 2-4"
done
echo "ok  D-12: tutti e ${#client_files[@]} i file client portano la direttiva e un commento di motivazione"

for f in "${server_files[@]}"; do
  grep -q 'use client' "${f}" && fail "D-12: ${f} porta la direttiva 'use client' ma non e' un componente — non dovrebbe averne bisogno"
done
echo "ok  D-12: lib/destinations.ts, lib/hooks/useNavbarSearch.ts e lib/types.ts restano privi della direttiva"

# Prova di non-vacuita' (stile DS-01): un file fittizio che viola il
# contratto deve essere rilevato dalla stessa funzione di controllo. Senza
# questo passo un parser rotto produrrebbe un gate verde e silenzioso.
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

bad_file="${tmp_dir}/BadClientFile.tsx"
{
  echo '"use client";'
  echo 'import { useState } from "react";'
  echo ''
  echo 'export default function BadClientFile() { return null; }'
} > "${bad_file}"

if has_client_directive_with_reason "${bad_file}"; then
  fail "D-12: il controllo non sa rilevare un file client senza commento di motivazione — gate vacuo"
fi
echo "ok  D-12: il controllo e' dimostrato capace di fallire su un file client senza motivazione"

# --- D-09/D-10: nessuna copia di stato fuori dalla shell ----------------------
#
# L'hook condiviso e' chiamato esattamente una volta, dalla shell. I cinque
# componenti di superficie ricevono valori e callback via props (D-10): non
# devono richiamare l'hook per conto proprio, il che ricreerebbe una seconda
# fonte di stato indipendente da quella della shell.
shell_hook_calls="$(grep -oE 'useNavbarSearch\(' components/Navbar.tsx | wc -l | tr -d ' ')"
[[ "${shell_hook_calls}" -eq 1 ]] \
  || fail "D-09/D-10: components/Navbar.tsx chiama useNavbarSearch ${shell_hook_calls} volte, atteso esattamente 1"
echo "ok  D-09/D-10: la shell chiama l'hook condiviso esattamente una volta"

for f in "${surface_files[@]}"; do
  if grep -qE 'useNavbarSearch\(' "${f}"; then
    fail "D-09/D-10: ${f} chiama useNavbarSearch per conto proprio — lo stato deve restare nella shell e arrivare via props"
  fi
done
echo "ok  D-09/D-10: nessuno dei ${#surface_files[@]} componenti di superficie richiama l'hook per conto proprio"

# --- D-07/D-08: fonte unica dei filtri e regola unica di propagazione --------
#
# Sola lettura del filesystem, nessun server ne' database: il contratto
# dichiarato in testa a questo file (D-14) vale anche per le asserzioni
# aggiunte dalla Fase 17.

# Filtra i commenti prima di contare — un'annotazione che spiega la rimozione
# (es. "restoredFilters e' sparita da qui") e' legittima e non deve far
# fallire il gate.
strip_comments() {
  grep -vE '^[[:space:]]*(//|\*|/\*)' "$1"
}

# 1. Nessuna copia dei filtri fuori da HomeClient.
for f in "lib/hooks/useNavbarSearch.ts" "components/Navbar.tsx"; do
  if strip_comments "${f}" | grep -qE '\buseState<SearchFilters>'; then
    fail "D-07: ${f} dichiara ancora un useState<SearchFilters> — la copia dei filtri non e' stata rimossa"
  fi
  if strip_comments "${f}" | grep -q 'restoredFilters'; then
    fail "D-07: ${f} nomina ancora restoredFilters (la prop di ponte di Fase 11) fuori da un commento"
  fi
done
echo "ok  D-07: nessuna copia dei filtri (useState<SearchFilters> o restoredFilters) fuori da HomeClient"

# 2. L'hook riceve i filtri invece di crearli, e Navbar li passa alla chiamata.
grep -qE '\bfilters:[[:space:]]*SearchFilters' lib/hooks/useNavbarSearch.ts \
  || fail "D-07: lib/hooks/useNavbarSearch.ts non dichiara filters come argomento"
grep -qE '\bonFiltersChange:' lib/hooks/useNavbarSearch.ts \
  || fail "D-07: lib/hooks/useNavbarSearch.ts non dichiara onFiltersChange come argomento"
grep -qE 'useNavbarSearch\(\{[^}]*filters' components/Navbar.tsx \
  || fail "D-07: components/Navbar.tsx non passa filters alla chiamata di useNavbarSearch"
grep -qE 'useNavbarSearch\(\{[^}]*onFiltersChange' components/Navbar.tsx \
  || fail "D-07: components/Navbar.tsx non passa onFiltersChange alla chiamata di useNavbarSearch"
echo "ok  D-07: l'hook dichiara filters/onFiltersChange e Navbar li passa alla chiamata"

# 3. Un solo proprietario: HomeClient dichiara draftFilters, lo passa alla
# Navbar come filters, e setDraftFilters compare nel blocco di ripristino da
# sessionStorage (non solo altrove nel file, es. handleSearch).
grep -qE '\bdraftFilters\b' app/HomeClient.tsx \
  || fail "D-07: app/HomeClient.tsx non dichiara draftFilters"
grep -qE 'filters=\{draftFilters\}' app/HomeClient.tsx \
  || fail "D-07: app/HomeClient.tsx non passa draftFilters alla Navbar come filters"
grep -A 20 'JSON.parse(savedFilters)' app/HomeClient.tsx | grep -q 'setDraftFilters' \
  || fail "D-07: app/HomeClient.tsx non chiama setDraftFilters nel blocco di ripristino da sessionStorage"
echo "ok  D-07: HomeClient.tsx e' l'unico proprietario — draftFilters passato alla Navbar, setDraftFilters nel ripristino"

# 4. Le guardie di tipo sul ripristino sono ancora al loro posto (T-17-01).
# Conta le occorrenze attese, non la sola presenza.
number_guards="$(grep -cE 'typeof parsed\.[a-zA-Z]+ === "number"' app/HomeClient.tsx)"
[[ "${number_guards}" -eq 2 ]] \
  || fail "T-17-01: attese 2 guardie typeof ... === \"number\" (radius, comuneId) in app/HomeClient.tsx, trovate ${number_guards}"
string_guards="$(grep -cE 'typeof parsed\.[a-zA-Z]+ === "string"' app/HomeClient.tsx)"
[[ "${string_guards}" -eq 1 ]] \
  || fail "T-17-01: attesa 1 guardia typeof ... === \"string\" (comuneIstatCode) in app/HomeClient.tsx, trovate ${string_guards}"
grep -qE 'Number\.isInteger\(parsedPage\)' app/HomeClient.tsx \
  || fail "T-17-01: la guardia Number.isInteger su currentPage e' sparita da app/HomeClient.tsx"
echo "ok  T-17-01: le guardie di tipo sul ripristino (radius/comuneId/comuneIstatCode/currentPage) sono ancora al loro posto"

# 5. D-08, regola unica: clearMobile chiama resetFilters, senza un proprio
# azzeramento duplicato. Verificato sull'intervallo di righe della funzione,
# non sull'intero file.
clearmobile_body="$(sed -n '/const clearMobile = () => {/,/^\t};$/p' lib/hooks/useNavbarSearch.ts)"
[[ -n "${clearmobile_body}" ]] \
  || fail "D-08: clearMobile non trovata in lib/hooks/useNavbarSearch.ts"
echo "${clearmobile_body}" | grep -q 'resetFilters()' \
  || fail "D-08: clearMobile non chiama piu' resetFilters()"
if echo "${clearmobile_body}" | grep -q 'setFilters({'; then
  fail "D-08: clearMobile ha ancora un proprio setFilters({ di azzeramento — l'asimmetria D-16 non e' chiusa"
fi
echo "ok  D-08: clearMobile chiama resetFilters(), nessun azzeramento duplicato nel suo corpo"

# 6. Il ripristino gira prima del paint: useIsomorphicLayoutEffect dichiarata
# e usata esattamente una volta.
declared="$(grep -cE 'const useIsomorphicLayoutEffect' app/HomeClient.tsx)"
[[ "${declared}" -eq 1 ]] \
  || fail "D-07: app/HomeClient.tsx non dichiara useIsomorphicLayoutEffect esattamente una volta (trovate ${declared})"
invocations="$(grep -cE 'useIsomorphicLayoutEffect\(' app/HomeClient.tsx)"
[[ "${invocations}" -eq 1 ]] \
  || fail "D-07: useIsomorphicLayoutEffect usata ${invocations} volte in app/HomeClient.tsx, attesa esattamente 1"
echo "ok  D-07: useIsomorphicLayoutEffect e' dichiarata e usata esattamente una volta"

# Prova di non-vacuita': la stessa asserzione 1 deve rilevare una violazione
# reintrodotta ad arte. Senza questo passo un gate mai visto fallire non e'
# un gate.
tmp_bad="${tmp_dir}/useNavbarSearch.bad.ts"
{
  echo 'export function useNavbarSearch() {'
  echo '  const [filters, setFilters] = useState<SearchFilters>({ location: "" });'
  echo '  return { filters, setFilters };'
  echo '}'
} > "${tmp_bad}"
if ! strip_comments "${tmp_bad}" | grep -qE '\buseState<SearchFilters>'; then
  fail "D-07: la prova di non-vacuita' non rileva un useState<SearchFilters> reintrodotto — asserzione 1 vacua"
fi
echo "ok  D-07: l'asserzione 1 e' dimostrata capace di fallire su un useState<SearchFilters> reintrodotto"

# --- D-09/D-10 (Fase 17): un solo montaggio del toggle, logo in flusso -------
#
# D-09  il toggle tema ha una sola posizione dichiarata, dentro la barra —
#       nessun secondo montaggio flottante (app/layout.tsx) ne' nell'overlay
#       mobile (MobileSearchOverlay.tsx).
# D-10  il logo esce dal posizionamento assoluto ed entra nel flusso della
#       riga a tre fratelli flex.

# 1. Un solo montaggio reso a utente, e deve stare in components/Navbar.tsx.
# app/dev/ (vetrina dei componenti) e' escluso di proposito: non e' prodotto.
theme_toggle_all="$(grep -rn '<ThemeToggle' app components --include='*.tsx' || true)"
theme_toggle_prod="$(printf '%s\n' "${theme_toggle_all}" | grep -v '^app/dev/' || true)"
theme_toggle_prod_count="$(printf '%s\n' "${theme_toggle_prod}" | grep -c '<ThemeToggle' || true)"
[[ "${theme_toggle_prod_count}" -eq 1 ]] \
  || fail "D-09: trovati ${theme_toggle_prod_count} montaggi di <ThemeToggle fuori da app/dev/ (atteso esattamente 1)"
printf '%s\n' "${theme_toggle_prod}" | grep -q '^components/Navbar\.tsx:' \
  || fail "D-09: l'unico montaggio di ThemeToggle non e' in components/Navbar.tsx"
echo "ok  D-09: un solo montaggio di ThemeToggle reso a utente, in components/Navbar.tsx"

# 2. Nome accessibile che dichiara l'azione, non lo stato — entrambi i temi.
grep -q 'Passa al tema scuro' components/ui/ThemeToggle.tsx \
  || fail "D-09: components/ui/ThemeToggle.tsx non dichiara piu' l'aria-label 'Passa al tema scuro'"
grep -q 'Passa al tema chiaro' components/ui/ThemeToggle.tsx \
  || fail "D-09: components/ui/ThemeToggle.tsx non dichiara piu' l'aria-label 'Passa al tema chiaro'"
echo "ok  D-09: il toggle dichiara un aria-label che nomina l'azione in entrambi i temi"

# 3. Logo in flusso: niente piu' absolute, la riga dichiara il contratto.
# Commenti filtrati prima di contare (una riga che nomina absolute left-4 in
# un commento di spiegazione non deve far fallire il gate).
if strip_comments components/Navbar.tsx | grep -q 'absolute left-4'; then
  fail "D-10: components/Navbar.tsx contiene ancora il posizionamento assoluto del logo (absolute left-4)"
fi
strip_comments components/Navbar.tsx | grep -q 'flex-none' \
  || fail "D-10: components/Navbar.tsx non dichiara piu' flex-none (logo/toggle)"
strip_comments components/Navbar.tsx | grep -q 'flex-1 min-w-0' \
  || fail "D-10: components/Navbar.tsx non dichiara piu' flex-1 min-w-0 (zona di ricerca)"
echo "ok  D-10: il logo e' in flusso (nessun absolute left-4), la riga dichiara flex-none/flex-1 min-w-0"

# 4. Nessun ritorno del montaggio flottante o dell'overlay (righe non commento).
if strip_comments app/layout.tsx | grep -q 'ThemeToggle'; then
  fail "D-09: app/layout.tsx importa ancora ThemeToggle — il montaggio flottante non deve tornare"
fi
if strip_comments components/navbar/MobileSearchOverlay.tsx | grep -q 'ThemeToggle'; then
  fail "D-09: components/navbar/MobileSearchOverlay.tsx importa ancora ThemeToggle — il secondo montaggio non deve tornare"
fi
echo "ok  D-09: app/layout.tsx e components/navbar/MobileSearchOverlay.tsx non importano piu' ThemeToggle"

# 5. Il DEFAULT del componente non deve mai produrre un toggle "fixed":
# altrimenti un <ThemeToggle /> nudo (come la vetrina /dev/ui-primitives)
# farebbe rinascere la variante flottante che D-09 ha rimosso, senza che il
# conteggio dell'asserzione 1 se ne accorga (il montaggio resterebbe unico,
# solo con l'aspetto sbagliato). Isola il blocco `className ?? ...` e
# filtra i commenti prima di cercare "fixed", perche' il commento che spiega
# la regola nomina la parola legittimamente.
default_classname_block="$(sed -n '/className ??/,/^\t\t\t}/p' components/ui/ThemeToggle.tsx | grep -vE '^[[:space:]]*(//|\*|/\*)')"
[[ -n "${default_classname_block}" ]] \
  || fail "D-09: non trovo piu' il blocco del default className in components/ui/ThemeToggle.tsx — il gate non puo' verificarlo"
if echo "${default_classname_block}" | grep -qE '\bfixed\b'; then
  fail "D-09: il default className di components/ui/ThemeToggle.tsx torna a dichiarare 'fixed' — un <ThemeToggle /> nudo fluttuerebbe di nuovo"
fi
echo "ok  D-09: il default di ThemeToggle non e' mai 'fixed' — un montaggio nudo resta in flusso"

# --- D-01/D-02/D-04/D-05 (Fase 17, piano 03): una sola pillola, una sola ----
# famiglia di animazione -------------------------------------------------
#
# D-01/D-02  la pillola collassata desktop e' lo stesso componente montato
#            dal mobile — nessuna terza implementazione della stessa idea.
# D-04       il morph pillola/barra usa la stessa famiglia di animazione a
#            molla dei due layoutId="activeRing" gia' presenti, non un
#            secondo layoutId (che animerebbe l'anello invece della forma).
# D-05       SearchbarTrigger.tsx e' l'unico file, montato due volte da
#            components/Navbar.tsx (una per superficie).

# 1. Il copy della pillola compare esattamente una volta in components/: un
# conteggio esatto, non una ricerca di assenza, e' cio' che rende
# falsificabile "non e' una terza copia". Commenti filtrati prima di
# contare — un commento che nomina il copy a scopo di documentazione (come
# quello poco sopra in questo stesso file, o nel componente) e' legittimo e
# non deve far fallire il gate.
pill_copy_count=0
while IFS= read -r f; do
  file_count="$(strip_comments "${f}" | grep -c 'Inizia la ricerca' || true)"
  pill_copy_count=$((pill_copy_count + file_count))
done < <(find components -name '*.tsx' | sort)
[[ "${pill_copy_count}" -eq 1 ]] \
  || fail "D-02/D-05: 'Inizia la ricerca' compare ${pill_copy_count} volte (fuori dai commenti) in components/*.tsx (atteso esattamente 1) — rischio di una seconda implementazione della pillola"
echo "ok  D-02/D-05: il copy della pillola compare esattamente una volta (fuori dai commenti) in components/"

# 2. Il componente e' montato da entrambe le superfici, e la vecchia
# implementazione mobile-only non esiste piu'.
if [[ -f components/navbar/MobileSearchbarTrigger.tsx ]]; then
  fail "D-05: components/navbar/MobileSearchbarTrigger.tsx esiste ancora — doveva essere rinominato in SearchbarTrigger.tsx (promozione, non una copia)"
fi
searchbar_mount_count="$(grep -c '<SearchbarTrigger' components/Navbar.tsx)"
[[ "${searchbar_mount_count}" -eq 2 ]] \
  || fail "D-05: components/Navbar.tsx monta <SearchbarTrigger ${searchbar_mount_count} volte (attese esattamente 2 — una per superficie)"
echo "ok  D-05: SearchbarTrigger e' l'unica implementazione, montata due volte (mobile + desktop) in components/Navbar.tsx"

# 3. Stessa famiglia di animazione: i due layoutId="activeRing" preesistenti
# piu' il morph del contenitore condividono type e stiffness.
#
# Lo smorzamento si e' separato il 2026-08-28, deviazione da D-04 approvata
# dall'utente: con massa 1 lo smorzamento critico e' 2*sqrt(500) ~ 44.7, quindi
# damping 40 e' sotto-smorzato e supera il bersaglio. Sui due anelli l'overshoot
# e' una traslazione orizzontale breve e resta desiderabile; sul morph cambia
# anche l'altezza (nav 86->100px, misurato) e lo stesso rimbalzo diventa un
# cenno verticale. Da qui 2 molle a damping 40 e 1 a damping 45.
spring_type_count="$(grep -c 'type: "spring",' components/Navbar.tsx)"
spring_stiffness_count="$(grep -c 'stiffness: 500,' components/Navbar.tsx)"
spring_damping40_count="$(grep -c 'damping: 40,' components/Navbar.tsx)"
spring_damping45_count="$(grep -c 'damping: 45,' components/Navbar.tsx)"
if [[ "${spring_type_count}" -ne 3 || "${spring_stiffness_count}" -ne 3 ]]; then
  fail "D-04: attesi 3 blocchi a molla con type/stiffness identici in components/Navbar.tsx (i due activeRing piu' il morph) — trovati type=${spring_type_count} stiffness=${spring_stiffness_count}"
fi
if [[ "${spring_damping40_count}" -ne 2 || "${spring_damping45_count}" -ne 1 ]]; then
  fail "D-04: atteso damping 40 sui due activeRing e 45 sul solo morph del contenitore — trovati damping40=${spring_damping40_count} damping45=${spring_damping45_count}. Sotto 44.7 la molla e' sotto-smorzata: riportare il morph a 40 fa tornare il rimbalzo verticale"
fi
awk '/data-navbar-searchbar/,/^$/' components/Navbar.tsx | grep -q 'damping: 45,' \
  || fail "D-04: il damping 45 non e' quello del contenitore [data-navbar-searchbar] — la molla critica deve stare sul morph, non su un anello"
echo "ok  D-04: molle nella stessa famiglia (type/stiffness identici), damping 40 sui due activeRing e 45 critico sul morph del contenitore"

# 4. Nessun secondo layoutId sulla barra: il morph usa `layout`, non un
# layoutId nuovo che condividerebbe l'animazione con l'anello invece che
# animare la forma del contenitore. Commenti filtrati prima di contare
# (stesso strip_comments usato sopra per D-07/D-08).
layoutid_count="$(strip_comments components/Navbar.tsx | grep -c 'layoutId=')"
[[ "${layoutid_count}" -eq 2 ]] \
  || fail "D-04: attesi esattamente 2 layoutId in components/Navbar.tsx (solo l'anello activeRing), trovati ${layoutid_count} — il morph deve usare layout, non un secondo layoutId"
activering_count="$(strip_comments components/Navbar.tsx | grep -c 'layoutId="activeRing"')"
[[ "${activering_count}" -eq 2 ]] \
  || fail "D-04: i 2 layoutId in components/Navbar.tsx non sono entrambi \"activeRing\""
echo "ok  D-04: esattamente due layoutId in components/Navbar.tsx, entrambi activeRing — il morph del contenitore usa layout, non un secondo layoutId"

# 5. Il marcatore dell'ancora sopravvive: e' il legame che regge il passaggio
# con un solo click fra Dove e Quando (onInteractOutside in
# DesktopSearchDropdown.tsx), e sparirebbe in silenzio con una riscrittura
# del contenitore.
grep -q 'data-navbar-searchbar' components/Navbar.tsx \
  || fail "D-04/D-05: components/Navbar.tsx non dichiara piu' data-navbar-searchbar"
grep -q 'data-navbar-searchbar' components/navbar/DesktopSearchDropdown.tsx \
  || fail "D-04/D-05: components/navbar/DesktopSearchDropdown.tsx non cerca piu' data-navbar-searchbar in onInteractOutside"
echo "ok  D-04/D-05: il marcatore data-navbar-searchbar e' ancora presente in Navbar.tsx e cercato da DesktopSearchDropdown.tsx"

# --- D-03/D-11 (Fase 17, piano 04): confinamento e ritorno del focus --------
#
# Nessun gate puo' osservare dove va il focus a runtime: queste asserzioni
# verificano che i MECCANISMI esistano. Il comportamento (dove va il focus,
# se il trap tiene) e' coperto dal checkpoint umano del Task 3, non da qui.

# 1. Overlay mobile: Dialog.ContentUnstyled+asChild e autoFocus sul campo
#    Dove sono ancora al loro posto — le due righe da cui dipende l'intero
#    contratto mobile (D-13 di Fase 9), verificato non riscritto qui.
grep -q 'Dialog.ContentUnstyled' components/navbar/MobileSearchOverlay.tsx \
  || fail "D-11: components/navbar/MobileSearchOverlay.tsx non usa piu' Dialog.ContentUnstyled"
grep -q 'asChild' components/navbar/MobileSearchOverlay.tsx \
  || fail "D-11: components/navbar/MobileSearchOverlay.tsx non passa piu' asChild al contenuto del Dialog"
grep -q 'autoFocus' components/navbar/MobileSearchOverlay.tsx \
  || fail "D-11: components/navbar/MobileSearchOverlay.tsx non passa piu' autoFocus al campo Dove"
echo "ok  D-11: l'overlay mobile mantiene Dialog.ContentUnstyled+asChild e autoFocus sul campo Dove"

# 2. Il dropdown desktop continua a prevenire onOpenAutoFocus di Radix: se
#    sparisse, Radix sposterebbe il focus dentro il dropdown invece di
#    lasciarlo sul campo Dove nella barra — D-11 violata in silenzio.
grep -qE 'onOpenAutoFocus=\{\(e\) => e\.preventDefault\(\)\}' components/navbar/DesktopSearchDropdown.tsx \
  || fail "D-11: components/navbar/DesktopSearchDropdown.tsx non previene piu' onOpenAutoFocus — Radix sposterebbe il focus dentro il dropdown"
echo "ok  D-11: DesktopSearchDropdown.tsx previene ancora onOpenAutoFocus"

# 3. Il confinamento e' cablato end-to-end: la Navbar dichiara e invoca
#    onPanelOpenChange, i due <main> applicano inert.
onpanel_count="$(grep -c 'onPanelOpenChange' components/Navbar.tsx)"
[[ "${onpanel_count}" -ge 2 ]] \
  || fail "D-11: components/Navbar.tsx nomina onPanelOpenChange ${onpanel_count} volta/e (attese almeno 2: dichiarazione in NavbarProps + invocazione nell'effect)"
grep -q 'inert={' app/HomeClient.tsx \
  || fail "D-11: app/HomeClient.tsx non applica piu' inert al proprio <main>"
grep -q 'inert={' "app/eventi/[id]/EventDetailClient.tsx" \
  || fail "D-11: app/eventi/[id]/EventDetailClient.tsx non applica piu' inert al proprio <main>"
echo "ok  D-11: onPanelOpenChange e' cablata dalla Navbar ai due <main> (HomeClient, EventDetailClient)"

# 4. Nessun listener manuale di dismissione e' tornato — la regressione piu'
#    plausibile di questo piano, esattamente cio' che T-09-13 aveva rimosso.
for f in "components/Navbar.tsx" "lib/hooks/useNavbarSearch.ts"; do
  if strip_comments "${f}" | grep -q 'document.addEventListener'; then
    fail "T-09-13: ${f} reintroduce un document.addEventListener manuale — la chiusura per click esterno deve restare di Radix"
  fi
done
echo "ok  T-09-13: nessun document.addEventListener manuale in components/Navbar.tsx o lib/hooks/useNavbarSearch.ts"

# Prova di non-vacuita' (richiesta dall'acceptance criteria, su questa o
# sull'asserzione 2): un file fittizio con la regressione deve essere
# rilevato dalla stessa ricerca usata sopra.
tmp_bad_listener="${tmp_dir}/BadNavbarSearch.ts"
{
  echo 'export function useNavbarSearch() {'
  echo '  document.addEventListener("click", () => {});'
  echo '}'
} > "${tmp_bad_listener}"
if ! strip_comments "${tmp_bad_listener}" | grep -q 'document.addEventListener'; then
  fail "T-09-13: la prova di non-vacuita' non rileva un document.addEventListener reintrodotto — asserzione 4 vacua"
fi
echo "ok  T-09-13: l'asserzione 4 e' dimostrata capace di fallire su un document.addEventListener reintrodotto"

# 5. Le primitive restano thin wrapper Radix, non riscritte in questa fase:
#    entrambe importano ancora il rispettivo pacchetto @radix-ui, non
#    reimplementano trap/Escape/focus a mano (17-04-PLAN.md: "le primitive
#    si usano, non si toccano").
grep -q '@radix-ui/react-dialog' components/ui/Dialog.tsx \
  || fail "D-11: components/ui/Dialog.tsx non importa piu' @radix-ui/react-dialog — non e' piu' un thin wrapper"
grep -q '@radix-ui/react-popover' components/ui/Popover.tsx \
  || fail "D-11: components/ui/Popover.tsx non importa piu' @radix-ui/react-popover — non e' piu' un thin wrapper"
echo "ok  D-11: components/ui/Dialog.tsx e components/ui/Popover.tsx restano thin wrapper Radix (non riscritti in questa fase)"

# ─────────────────────────────────────────────────────────────────────────────
# D-04 (lag del morph, misurato il 2026-08-28) — nessuna transizione CSS sulle
# proprieta' che framer-motion `layout` guida a ogni frame.
#
# Misura che ha motivato l'asserzione (letta dal vivo, non dedotta dal sorgente):
# l'elemento [data-navbar-searchbar] aveva transition-property "all" a 0.15s,
# mentre il layoutId="activeRing" — che l'utente indica come fluido — ha
# transition-duration 0s. Con "all" il CSS re-interpola transform e width, cioe'
# proprio cio' che `layout` riscrive ogni frame, e anima width una seconda volta
# in parallelo alla scale di framer.
#
# ${searchbarWidthClass} identifica univocamente la className di quell'elemento.
searchbar_class_line=$(grep -n 'searchbarWidthClass}`}' components/Navbar.tsx || true)
[[ -n "${searchbar_class_line}" ]] \
  || fail "D-04: non trovo piu' la className di [data-navbar-searchbar] in components/Navbar.tsx — il gate non puo' verificarla"
if grep -q 'transition-all.*searchbarWidthClass}`}' components/Navbar.tsx; then
  fail "D-04: la barra che porta \`layout\` e' tornata a transition-all — il CSS re-interpola transform/width a ogni frame di framer-motion e il morph torna a scattare"
fi
grep -q 'transition-\[.*\].*searchbarWidthClass}`}' components/Navbar.tsx \
  || fail "D-04: la className di [data-navbar-searchbar] non dichiara piu' un elenco esplicito transition-[...] — serve a escludere transform e width"
echo "ok  D-04: [data-navbar-searchbar] transiziona in CSS solo un elenco esplicito di proprieta', mai transform/width"

# Prova di non-vacuita': lo stesso confronto deve segnalare un transition-all
# rimesso sulla riga della className.
tmp_bad_transition="${tmp_dir}/BadNavbarTransition.tsx"
{
  echo 'export const A = () => ('
  echo '  <motion.div layout className={`flex items-center transition-all px-2 ${searchbarWidthClass}`} />'
  echo ');'
} > "${tmp_bad_transition}"
if ! grep -q 'transition-all.*searchbarWidthClass}`}' "${tmp_bad_transition}"; then
  fail "D-04: la prova di non-vacuita' non rileva un transition-all rimesso sulla barra — asserzione vacua"
fi
echo "ok  D-04: l'asserzione e' dimostrata capace di fallire su un transition-all rimesso"

echo "PASS: contratti Navbar verificabili senza browser (D-06, D-12, D-09, D-10, D-07, D-08, D-09/D-10 Fase 17, D-01/D-02/D-04/D-05 Fase 17, D-03/D-11 Fase 17)"
