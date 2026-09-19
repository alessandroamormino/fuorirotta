#!/usr/bin/env bash
# Gate WR-01 (Fase 15 review, commit d63cbde) — STATIC-ONLY, per esplicita
# dichiarazione di questo gate: NON prova il comportamento a runtime.
#
# Perche' non e' un gate comportamentale: triggerRegionRefresh() in
# app/api/events/route.ts non e' esportata, e riprodurre deterministicamente
# "runRegion() lancia E failWorkflowExecution() lancia nello stesso istante"
# richiederebbe mockare piu' moduli con dipendenze Prisma (cacheService,
# lib/scrapers, regionLock) senza toccare i file di implementazione — un
# costo di mocking (monkeypatch del require.cache di piu' moduli) che non e'
# stato ritenuto proporzionato qui. Il gap e' stato escalato per una verifica
# manuale (vedi 15-VALIDATION.md): iniettare un errore in failWorkflowExecution
# (es. staccare temporaneamente il Postgres locale a meta' di un refresh
# on-demand fallito) e osservare via `SELECT count(*) FROM region_locks WHERE
# region = '<regione>'` che il lock venga rilasciato una volta sola, non
# ripreso da un secondo processo e poi cancellato a sua insaputa.
#
# Questo script prova solo l'INVARIANTE STRUTTURALE che la fix introduce:
# failWorkflowExecution(), dentro il catch di triggerRegionRefresh, ha il
# proprio try/catch (cosi' un suo throw non può scappare dal catch esterno
# e raggiungere l'outer .catch, che rilascerebbe il lock una seconda volta).
# Una regressione che rimuovesse quel try/catch interno la fa fallire; una
# regressione che cambiasse il comportamento SENZA toccare questo pattern
# testuale (es. spostando la logica altrove con la stessa struttura) non
# verrebbe rilevata — e' il limite dichiarato di un gate statico.
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
repo_root="$(cd -- "${script_dir}/.." >/dev/null 2>&1 && pwd -P)"
cd "${repo_root}"

target="app/api/events/route.ts"

fail() {
  echo "FAIL: $1"
  exit 1
}

[[ -f "${target}" ]] || fail "${target} non trovato"

# --- S1: failWorkflowExecution e' chiamata dentro un try proprio, con un
# catch che NON rilancia (solo un console.error) -- estratto testualmente fra
# "} catch (err) {" (il catch esterno di triggerRegionRefresh) e il successivo
# "} finally {" (il rilascio del lock), cosi' la ricerca resta ancorata al
# blocco corretto anche se altri try/catch esistono altrove nel file.
outer_catch_to_finally="$(awk '/\.then\(async \(executionId\) => \{/{flag=1} flag{print} flag && /\} finally \{/{exit}' "${target}")"
[[ -n "${outer_catch_to_finally}" ]] || fail "S1: non ho trovato il blocco .then(...)...finally in ${target} — la struttura attesa da WR-01 non e' piu' presente in questa forma"

echo "${outer_catch_to_finally}" | grep -q "try {" || fail "S1: nessun 'try {' interno trovato fra il catch esterno e il finally — failWorkflowExecution potrebbe non avere piu' un try/catch proprio"
echo "${outer_catch_to_finally}" | grep -q "await failWorkflowExecution(executionId, String(err))" || fail "S1: la chiamata a failWorkflowExecution non e' nella forma attesa dentro il blocco try/catch interno"
echo "${outer_catch_to_finally}" | grep -q "catch (innerErr)" || fail "S1: nessun catch dedicato (innerErr) trovato subito dopo la chiamata a failWorkflowExecution — il suo throw potrebbe di nuovo scappare verso l'outer .catch"
echo "ok  S1: failWorkflowExecution e' avvolta dal proprio try/catch (innerErr), dentro il catch esterno, prima del finally che rilascia il lock"

# --- S2: releaseRegionLock compare esattamente due volte in tutto il file:
# una nel finally del ramo .then (rilascio dopo esito noto), una nel .catch
# esterno (raggiungibile SOLO se createWorkflowExecution stessa rigetta,
# prima che il lock sia mai stato preso da questo ramo. Un terzo rilascio, o
# uno spostato fuori da questi due punti, e' il segnale che qualcuno ha
# reintrodotto un doppio rilascio sullo stesso percorso.
release_count="$(grep -c "await releaseRegionLock(region)" "${target}")"
[[ "${release_count}" -eq 2 ]] || fail "S2: releaseRegionLock(region) compare ${release_count} volte in ${target}, attese esattamente 2 (finally del ramo .then + outer .catch) — un conteggio diverso e' un segnale di doppio rilascio potenziale"
echo "ok  S2: releaseRegionLock(region) compare esattamente 2 volte (finally + outer .catch), non un rilascio aggiuntivo raggiungibile dallo stesso percorso di errore"

echo "PASS (STATIC-ONLY): rilascio singolo del lock sul percorso di fallimento (WR-01, Fase 15 review) — invariante strutturale verificato, NON il comportamento a runtime"
exit 0
