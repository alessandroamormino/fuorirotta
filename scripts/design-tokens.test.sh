#!/usr/bin/env bash
# Self-check per il sistema di design token della Fase 7. Nessun framework,
# nessuna fixture: un solo file eseguibile che legge app/globals.css e il
# filesystem. Copre le due invarianti meccaniche che nessun altro gate protegge.
#
#   DS-01  :root e .dark devono dichiarare esattamente gli stessi token.
#          La regressione tipica e' aggiungere un token a uno solo dei due
#          blocchi: il tema opposto eredita silenziosamente il valore sbagliato
#          (o nessun valore) e nessun type-check se ne accorge.
#   DS-06  I due file di codice morto devono restare cancellati.
#
# DS-02 (zero hex fuori dai token) e' gia' coperto da `npm run check:tokens`.
# DS-03 e DS-05 richiedono un browser e restano manual-only per progetto.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
globals_css="${repo_root}/app/globals.css"

fail() {
  echo "FAIL: $1"
  exit 1
}

[[ -f "${globals_css}" ]] || fail "app/globals.css non trovato in ${repo_root}"

# Estrae i NOMI delle custom property dichiarate dentro un blocco CSS.
# Il blocco va da "<selettore> {" fino alla prima riga che e' solo "}".
token_names_in_block() {
  local selector_pattern="$1"
  # NB: `tr -d '[:space:]'` qui sarebbe un bug — cancella anche i newline e
  # collassa tutti i nomi in un'unica riga, rendendo il diff vacuo. Si strappano
  # solo spazi e tab, per riga.
  sed -n "/^${selector_pattern} {/,/^}/p" "${globals_css}" \
    | grep -oE '^[[:space:]]*--[a-z0-9-]+' \
    | sed 's/^[[:space:]]*//' \
    | sort
}

# --- DS-01: parita' dei token fra :root e .dark ------------------------------

root_tokens="$(token_names_in_block ':root')"
dark_tokens="$(token_names_in_block '\.dark')"

[[ -n "${root_tokens}" ]] || fail "DS-01: nessun token trovato in :root — il parser e' rotto o globals.css e' cambiato struttura"
[[ -n "${dark_tokens}" ]] || fail "DS-01: nessun token trovato in .dark — il parser e' rotto o globals.css e' cambiato struttura"

if ! diff_out="$(diff <(printf '%s\n' "${root_tokens}") <(printf '%s\n' "${dark_tokens}"))"; then
  echo "DS-01: :root e .dark dichiarano insiemi di token diversi."
  echo "  '<' = presente solo in :root   '>' = presente solo in .dark"
  printf '%s\n' "${diff_out}" | sed 's/^/    /'
  fail "DS-01: parita' dei token violata"
fi

root_count="$(printf '%s\n' "${root_tokens}" | wc -l | tr -d ' ')"
echo "ok  DS-01: :root e .dark dichiarano gli stessi ${root_count} token"

# Prova di non-vacuita': il confronto deve saper fallire. Se aggiungiamo un
# token fittizio a uno solo dei due insiemi, il diff deve segnalarlo — altrimenti
# il test sopra passerebbe anche con un parser che non estrae nulla di utile.
if diff <(printf '%s\n--token-inesistente\n' "${root_tokens}" | sort) \
        <(printf '%s\n' "${dark_tokens}") >/dev/null 2>&1; then
  fail "DS-01: il confronto non sa fallire — gate vacuo"
fi
echo "ok  DS-01: il confronto e' dimostrato capace di fallire"

# --- DS-06: il codice morto resta cancellato ---------------------------------

for dead_file in "components/Hero.tsx" "lib/hooks/useInfiniteScroll.ts"; do
  if [[ -e "${repo_root}/${dead_file}" ]]; then
    fail "DS-06: ${dead_file} e' stato reintrodotto — era stato rimosso nella Fase 7"
  fi
done
echo "ok  DS-06: components/Hero.tsx e lib/hooks/useInfiniteScroll.ts restano assenti"

echo "PASS: design token (DS-01, DS-06)"
