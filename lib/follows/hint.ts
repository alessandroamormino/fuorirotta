// Suggerimento "su questo dispositivo ci sono follow" (Fase 23). Browser-safe.
// Serve solo a riservare lo spazio di "Per te" prima del primo paint (lo script
// nel <head> di app/layout.tsx legge la stessa chiave). Non contiene dati
// personali: un valore vecchio o modificato costa, al massimo, un riquadro vuoto.
import { PERTE_HINT_KEY } from './device'

export function setPerTeHint(on: boolean): void {
  try {
    if (on) localStorage.setItem(PERTE_HINT_KEY, '1')
    else localStorage.removeItem(PERTE_HINT_KEY)
  } catch {}
  try {
    if (on) document.documentElement.setAttribute('data-perte', '1')
    else document.documentElement.removeAttribute('data-perte')
  } catch {}
}

export function hasPerTeHint(): boolean {
  try {
    return localStorage.getItem(PERTE_HINT_KEY) === '1'
  } catch {
    return false
  }
}
