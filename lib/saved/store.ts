'use client'

/**
 * Lista dei salvati sul dispositivo (D3: gli ospiti non scrivono nulla sul
 * server). Singleton di modulo letto con useSyncExternalStore, MAI un Context:
 * il popup della mappa e' una createRoot a parte, senza provider sopra, e un
 * cuore che dipendesse da un Context li' sarebbe sempre "non salvato"
 * (22-RESEARCH Pitfall 1). Stessa scelta di ShareButton e di notify().
 *
 * Idratazione (Pitfall 2): lo snapshot lato server e' `false`/`0`, uguale per
 * tutti, quindi l'HTML del server e il primo render del client sono il cuore
 * vuoto. Il localStorage si legge in modo pigro, alla prima lettura sul
 * client, mai all'import del modulo.
 */
import { useSyncExternalStore } from 'react'
import type { ResolvedItem, Snap } from './snapshot'

export interface DeviceEntry {
  /** L'id dell'evento come lo mostrava la superficie al momento del tocco (D-08: quella data). */
  id: number
  savedAt: string
  /** Riempita dal server (resolve) dopo il salvataggio; null finche' non e' arrivata. */
  snap: Snap | null
  /** Id canonico risolto dal server: due salvataggi dello stesso gruppo accendono lo stesso cuore. */
  c?: number
}

export type ToggleResult = 'saved' | 'removed' | 'busy'

const KEY = 'fuorirotta.saved.v1'

// Copia in memoria: e' la lista quando lo storage lancia (Safari in navigazione
// privata, storage disattivato) e la base dello snapshot, sostituito solo a ogni modifica.
let cache: DeviceEntry[] = []
let loaded = false
// Vero dopo una scrittura fallita: da li' in poi lo storage non e' piu' la verita', la memoria si'.
let memoryOnly = false
const listeners = new Set<() => void>()
// Cresce solo quando un tocco dell'utente salva: fa pulsare il punto della navbar.
// Idratazione, altre schede e unione non lo toccano.
let pulse = 0
const pending = new Set<number>()

const isEntry = (e: unknown): e is DeviceEntry => {
  const x = e as DeviceEntry | null
  return (
    typeof x === 'object' &&
    x !== null &&
    Number.isSafeInteger(x.id) &&
    typeof x.savedAt === 'string' &&
    (x.snap === null || (typeof x.snap === 'object' && typeof x.snap.title === 'string')) &&
    (x.c === undefined || Number.isSafeInteger(x.c))
  )
}

// Rilegge SEMPRE lo storage corrente: due schede non si sovrascrivono a vicenda.
// Dati altrui o corrotti si scartano voce per voce, mai un crash di una card.
function readStorage(): DeviceEntry[] {
  if (memoryOnly) return cache
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return cache
  }
}

function commit(next: DeviceEntry[]): void {
  cache = next
  loaded = true
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage non scrivibile: la lista vive in memoria per la sessione.
    memoryOnly = true
  }
  listeners.forEach((l) => l())
}

function getList(): DeviceEntry[] {
  if (!loaded) {
    cache = readStorage()
    loaded = true
  }
  return cache
}

const includes = (list: DeviceEntry[], id: number): boolean => list.some((e) => e.id === id || e.c === id)

function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== KEY) return
  cache = readStorage()
  loaded = true
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage)
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) window.removeEventListener('storage', onStorage)
  }
}

/** Seleziona un booleano: ogni cuore si ridisegna solo quando cambia il suo. */
export function useIsSaved(eventId: number): boolean {
  return useSyncExternalStore(
    subscribe,
    () => includes(getList(), eventId),
    () => false
  )
}

export function useSavedCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => getList().length,
    () => 0
  )
}

export function useSavedPulse(): number {
  return useSyncExternalStore(
    subscribe,
    () => pulse,
    () => 0
  )
}

export function readDeviceList(): DeviceEntry[] {
  return typeof window === 'undefined' ? [] : getList()
}

/** Riempie le istantanee mancanti e fissa l'id canonico; tace se non cambia nulla. */
export function applyResolved(items: ResolvedItem[]): void {
  const current = readStorage()
  let changed = false
  const next = current.map((entry) => {
    const item = items.find((i) => i.ref === entry.id)
    if (!item) return entry
    const snap = entry.snap ?? item.live
    const c = item.eventId ?? entry.c
    if (snap === entry.snap && c === entry.c) return entry
    changed = true
    return { ...entry, snap, c }
  })
  if (changed) commit(next)
}

// Una sola richiesta in background per un nuovo salvataggio: la risposta riempie
// l'istantanea. Se fallisce (offline) la voce resta senza istantanea e /salvati
// la riempie al prossimo caricamento. Non si aspetta: il cuore e' gia' acceso.
function resolveInBackground(id: number): void {
  fetch('/api/v1/saved/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((json: { items?: ResolvedItem[] } | null) => {
      if (json?.items) applyResolved(json.items)
    })
    .catch(() => {})
}

export async function toggleSaved(eventId: number): Promise<ToggleResult> {
  if (pending.has(eventId)) return 'busy'
  pending.add(eventId)
  try {
    const current = readStorage()
    if (includes(current, eventId)) {
      commit(current.filter((e) => e.id !== eventId && e.c !== eventId))
      return 'removed'
    }
    pulse += 1
    commit([...current, { id: eventId, savedAt: new Date().toISOString(), snap: null }])
    resolveInBackground(eventId)
    return 'saved'
  } finally {
    pending.delete(eventId)
  }
}
