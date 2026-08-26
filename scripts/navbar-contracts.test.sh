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

echo "PASS: contratti Navbar verificabili senza browser (D-06, D-12, D-09, D-10, D-07, D-08, D-09/D-10 Fase 17)"
