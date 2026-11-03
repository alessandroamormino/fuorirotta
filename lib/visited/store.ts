'use client'

/**
 * Stato di "Ci sono stato" per il sito (Fase 27.1, D-08). Stesse regole dello
 * store dei salvati (lib/saved/store.ts): singleton di modulo letto con
 * useSyncExternalStore, MAI un Context; lo snapshot lato server e' `false`,
 * uguale per tutti, cosi' HTML del server e primo render del client sono il
 * bottone non premuto (React error 418).
 *
 * Lo stato dell'accesso NON si duplica: lo scrive SavedSync nello store dei
 * salvati e qui si legge con savedAuth(). D-04: nessuna funzione di questo
 * modulo tocca i salvati, ne' viceversa.
 */
import { useSyncExternalStore } from 'react'
import { savedAuth, useSavedMode } from '../saved/store'

export type VisitedToggleResult = 'visited' | 'removed' | 'busy' | 'cap' | 'error'

const listeners = new Set<() => void>()
function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
const notifyAll = () => listeners.forEach((l) => l())

// Modo account: gli id canonici stanno SOLO in memoria (come i salvati, AUTH-09).
let accountIds: Set<number> | null = null
// Cresce a ogni cambio di utente: una risposta arrivata dopo l'uscita non riempie la lista di nessuno.
let epoch = 0
// Id con una richiesta in volo: un secondo tocco prima della risposta non parte.
const pending = new Set<number>()

/** Chiamata da VisitedSync a ogni cambio di utente (anche l'uscita): svuota gli id. */
export function resetVisitedIds(): void {
  epoch += 1
  accountIds = null
  notifyAll()
}

/** Riempie gli id dei visitati dell'account. Con `onlyIfMissing` non rifa' la richiesta se gli id ci sono gia'. */
export async function loadVisitedIds(onlyIfMissing = false): Promise<void> {
  if (!savedAuth().signedIn || (onlyIfMissing && accountIds !== null)) return
  const mine = epoch
  try {
    const res = await fetch('/api/v1/me/visited/ids', { credentials: 'same-origin' })
    if (!res.ok) return
    const json = (await res.json()) as { ids?: unknown }
    if (mine !== epoch || !Array.isArray(json.ids)) return
    accountIds = new Set(json.ids.filter((n): n is number => Number.isSafeInteger(n)))
    notifyAll()
  } catch {
    // Offline: restano null e il prossimo tocco riprova a caricare.
  }
}

/**
 * Un booleano per bottone. useSavedMode() qui serve solo a far rileggere lo
 * snapshot quando cambia l'accesso (lo store dei salvati e' quello che lo sa).
 */
export function useIsVisited(eventId: number): boolean {
  useSavedMode()
  return useSyncExternalStore(
    subscribe,
    () => (savedAuth().signedIn ? accountIds?.has(eventId) === true : false),
    () => false
  )
}

async function toggleAccount(eventId: number): Promise<VisitedToggleResult> {
  if (accountIds === null) await loadVisitedIds()
  const before = accountIds
  if (before === null) return 'error'
  const mine = epoch
  const was = before.has(eventId)
  const next = new Set(before)
  if (was) next.delete(eventId)
  else next.add(eventId)
  accountIds = next
  notifyAll()
  // Torna come prima solo per questo id e solo se l'utente e' lo stesso.
  const rollBack = () => {
    if (mine !== epoch || accountIds === null) return
    const restored = new Set(accountIds)
    if (was) restored.add(eventId)
    else restored.delete(eventId)
    accountIds = restored
    notifyAll()
  }
  try {
    const res = await fetch(`/api/v1/me/visited/${eventId}`, { method: was ? 'DELETE' : 'PUT', credentials: 'same-origin' })
    if (res.ok) return was ? 'removed' : 'visited'
    rollBack()
    if (!was && res.status === 409) {
      const j = (await res.json().catch(() => null)) as { error?: unknown } | null
      if (j?.error === 'cap') return 'cap'
    }
    return 'error'
  } catch {
    rollBack()
    return 'error'
  }
}

/** Segna o toglie "Ci sono stato". Il server decide se l'evento e' iniziato (D-02): qui si prova e basta. */
export async function toggleVisited(eventId: number): Promise<VisitedToggleResult> {
  if (pending.has(eventId)) return 'busy'
  pending.add(eventId)
  try {
    return await toggleAccount(eventId)
  } finally {
    pending.delete(eventId)
  }
}
