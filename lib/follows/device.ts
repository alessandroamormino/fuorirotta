// Tracce dei follow sul dispositivo (Fase 23). Browser-safe. Nessuna contiene
// dati personali, ma su un computer condiviso non devono sopravvivere all'utente
// che se ne va (research Pitfall 10, T-23-25). Le due chiavi restano letterali
// su una riga: il piano 07 ne legge il valore con sed.
export const FOLLOW_INTENT_KEY = 'fuorirotta.follow-intent'
export const PERTE_HINT_KEY = 'fuorirotta.perte'

/** Toglie l'intento di follow, il suggerimento Per te e data-perte. Non lancia mai. */
export function clearFollowDeviceState(): void {
  try {
    sessionStorage.removeItem(FOLLOW_INTENT_KEY)
  } catch {}
  try {
    localStorage.removeItem(PERTE_HINT_KEY)
  } catch {}
  try {
    document.documentElement.removeAttribute('data-perte')
  } catch {}
}
