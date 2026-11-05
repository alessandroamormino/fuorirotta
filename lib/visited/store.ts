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
import { todayInRome } from '../dateWindow'
import { savedAuth, useSavedMode } from '../saved/store'
import { GUEST_CAP, validateSnap, type Snap } from '../saved/snapshot'
import { parseVisitedDevice, visitDayFor, type VisitedDeviceEntry } from './rules'

export type VisitedToggleResult = 'visited' | 'removed' | 'busy' | 'cap' | 'error'

// Ospite (D-07): la lista sta nel localStorage di questo browser e non va mai sul server prima dell'accesso.
const KEY = 'fuorirotta:visited'
// Copia in memoria: e' la lista quando lo storage lancia (navigazione privata, storage disattivato).
let cache: VisitedDeviceEntry[] = []
let loaded = false
// Vero dopo una scrittura fallita: da li' in poi la verita' e' la memoria.
let memoryOnly = false

// Rilegge SEMPRE lo storage corrente: due schede non si sovrascrivono. Voci malformate
// si scartano una per una (parseVisitedDevice) e si riscrive la lista pulita.
function readStorage(): VisitedDeviceEntry[] {
  if (memoryOnly) return cache
  try {
    const raw = window.localStorage.getItem(KEY)
    const list = parseVisitedDevice(raw)
    if (raw !== null && JSON.stringify(list) !== raw) window.localStorage.setItem(KEY, JSON.stringify(list))
    return list
  } catch {
    return cache
  }
}

function commit(next: VisitedDeviceEntry[]): void {
  cache = next
  loaded = true
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    memoryOnly = true
  }
  notifyAll()
}

// Lettura pigra, alla prima richiesta sul client, mai all'import del modulo.
function getList(): VisitedDeviceEntry[] {
  if (!loaded) {
    cache = readStorage()
    loaded = true
  }
  return cache
}

function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== KEY) return
  cache = readStorage()
  loaded = true
  notifyAll()
}

const listeners = new Set<() => void>()
function subscribe(cb: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}
function notifyAll(): void {
  listeners.forEach((l) => l())
}

/** La lista dell'ospite, per l'unione dopo l'accesso. */
export function readVisitedDevice(): VisitedDeviceEntry[] {
  return readStorage()
}

/** Toglie dalla lista del dispositivo solo gli id mandati e accettati dal server. */
export function clearVisitedDevice(ids: number[]): void {
  const sent = new Set(ids)
  commit(readStorage().filter((e) => !sent.has(e.id)))
}

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
    () => (savedAuth().signedIn ? accountIds?.has(eventId) === true : getList().some((e) => e.id === eventId)),
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

/** Cio' che serve a segnare un evento sul dispositivo (l'ospite): date per il giorno di visita, testo per l'istantanea. */
export interface VisitedEntryInput {
  dateStart: string
  dateEnd: string | null
  snap: Snap | null
}

function toggleGuest(eventId: number, entry: VisitedEntryInput): VisitedToggleResult {
  const list = getList()
  if (list.some((e) => e.id === eventId)) {
    commit(list.filter((e) => e.id !== eventId))
    return 'removed'
  }
  if (list.length >= GUEST_CAP) return 'cap'
  // Il giorno lo ricalcola comunque il server all'unione; qui serve a tenerlo vicino al segno (D-05).
  const visitDay = visitDayFor(entry.dateStart, entry.dateEnd, todayInRome())
  if (visitDay === null) return 'error'
  const snap = entry.snap === null ? null : validateSnap(entry.snap)
  commit([...list, { id: eventId, savedAt: new Date().toISOString(), visitDay, ...(snap ? { snap } : {}) }])
  return 'visited'
}

/**
 * Segna o toglie "Ci sono stato". Con l'accesso scrive il server, che decide se l'evento
 * e' iniziato (D-02); senza, la lista resta in questo browser (D-07).
 */
export async function toggleVisited(eventId: number, entry: VisitedEntryInput): Promise<VisitedToggleResult> {
  if (pending.has(eventId)) return 'busy'
  pending.add(eventId)
  try {
    return savedAuth().signedIn ? await toggleAccount(eventId) : toggleGuest(eventId, entry)
  } finally {
    pending.delete(eventId)
  }
}
