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

echo "PASS: contratti Navbar verificabili senza browser (D-06, D-12, D-09, D-10)"
