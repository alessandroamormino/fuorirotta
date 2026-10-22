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
import { GUEST_CAP, parseDeviceList, validateSnap, type DeviceEntry, type ResolvedItem } from './snapshot'

export type { DeviceEntry }
export type ToggleResult = 'saved' | 'removed' | 'busy' | 'cap' | 'error-save' | 'error-remove'

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

// Rilegge SEMPRE lo storage corrente: due schede non si sovrascrivono a vicenda.
// Dati altrui, corrotti o scaduti si scartano voce per voce (parseDeviceList),
// mai un crash di una card; se qualcosa e' stato scartato si riscrive la lista pulita.
function readStorage(): DeviceEntry[] {
  if (memoryOnly) return cache
  try {
    const raw = window.localStorage.getItem(KEY)
    const list = parseDeviceList(raw, new Date())
    if (raw !== null && JSON.stringify(list) !== raw) window.localStorage.setItem(KEY, JSON.stringify(list))
    return list
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
    () => (auth.signedIn ? accountIds?.has(eventId) === true : includes(getList(), eventId)),
    () => false
  )
}

export function useSavedCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => (auth.signedIn ? (accountIds?.size ?? 0) : getList().length),
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

// Stato dell'accesso, scritto da SavedSync: lo store non importa il Context (popup = altra radice).
let auth: { enabled: boolean | null; signedIn: boolean } = { enabled: null, signedIn: false }
// Modo account (D-07): gli id canonici stanno SOLO in memoria, mai nel localStorage (AUTH-09:
// su un computer condiviso la lista di chi e' uscito non deve restare). null = non ancora caricati.
let accountIds: Set<number> | null = null
// Cresce a ogni cambio di modo: una risposta arrivata dopo l'uscita non riempie la lista di nessuno.
let authEpoch = 0
// Vero quando SavedSync ha finito unione e id per l'utente corrente: solo allora /salvati legge l'account.
let accountReady = false
export function setSavedAuth(state: { enabled: boolean | null; signedIn: boolean }): void {
  const modeChanged = state.signedIn !== auth.signedIn
  auth = state
  if (!modeChanged) return
  authEpoch += 1
  accountIds = null
  accountReady = false
  listeners.forEach((l) => l())
}
export function savedAuth(): { enabled: boolean | null; signedIn: boolean } {
  return auth
}

/** Chiamata da SavedSync a unione e caricamento degli id finiti: /salvati passa da 'pending' ad 'account'. */
export function markAccountReady(): void {
  if (!auth.signedIn || accountReady) return
  accountReady = true
  listeners.forEach((l) => l())
}

/**
 * Da quale lista legge /salvati. 'pending' finche' lo stato dell'accesso non e'
 * noto (con il flag di build acceso) e, per chi ha l'accesso, finche' l'unione non
 * e' finita: una lista mezza unita non si mostra mai (AUTH-09). Il valore del
 * flag e' inlinato alla build, uguale sul server e sul client (idratazione).
 */
export type SavedMode = 'pending' | 'guest' | 'account'
export function useSavedMode(): SavedMode {
  const flagOn = process.env.NEXT_PUBLIC_AUTH_ENABLED === 'true'
  return useSyncExternalStore(
    subscribe,
    () => (!flagOn ? 'guest' : auth.enabled === null ? 'pending' : !auth.signedIn ? 'guest' : accountReady ? 'account' : 'pending'),
    () => (flagOn ? 'pending' : 'guest')
  )
}

function setAccountIds(next: Set<number>): void {
  accountIds = next
  listeners.forEach((l) => l())
}

/** Modo account: riempie gli id canonici in memoria dal server. Senza accesso non fa nulla. */
export async function loadAccountIds(): Promise<void> {
  if (!auth.signedIn) return
  const epoch = authEpoch
  try {
    const res = await fetch('/api/v1/me/saved/ids', { credentials: 'same-origin' })
    if (!res.ok) return
    const json = (await res.json()) as { ids?: unknown }
    if (epoch !== authEpoch || !Array.isArray(json.ids)) return
    setAccountIds(new Set(json.ids.filter((n): n is number => Number.isSafeInteger(n))))
  } catch {
    // Offline: restano null e il prossimo tocco riprova a caricare.
  }
}

async function toggleAccount(eventId: number): Promise<ToggleResult> {
  if (accountIds === null) await loadAccountIds()
  const before = accountIds
  if (before === null) return 'error-save'
  const epoch = authEpoch
  const wasSaved = before.has(eventId)
  const next = new Set(before)
  if (wasSaved) next.delete(eventId)
  else {
    next.add(eventId)
    pulse += 1
  }
  setAccountIds(next)
  // Torna come prima solo per questo id e solo se l'utente e' lo stesso.
  const rollBack = () => {
    if (epoch !== authEpoch || accountIds === null) return
    const restored = new Set(accountIds)
    if (wasSaved) restored.add(eventId)
    else restored.delete(eventId)
    setAccountIds(restored)
  }
  try {
    const res = await fetch(`/api/v1/me/saved/${eventId}`, {
      method: wasSaved ? 'DELETE' : 'PUT',
      credentials: 'same-origin',
    })
    if (res.ok) return wasSaved ? 'removed' : 'saved'
    rollBack()
    return res.status === 409 ? 'cap' : wasSaved ? 'error-remove' : 'error-save'
  } catch {
    rollBack()
    return wasSaved ? 'error-remove' : 'error-save'
  }
}

/**
 * Toglie dal dispositivo gli id dati (tutto se omessi). Dopo l'unione, per gli id
 * mandati; all'uscita e alla cancellazione dell'account, per tutto (D-07): su un
 * computer condiviso niente di chi e' uscito deve restare.
 */
export function clearDeviceSaves(ids?: number[]): void {
  const drop = ids ? new Set(ids) : null
  commit(drop ? readStorage().filter((e) => !drop.has(e.id)) : [])
}

/** D-16: una riga di sola istantanea se ne va subito. Ospite: la voce locale; account: DELETE gone/{ref}. */
export async function removeGone(ref: number): Promise<'removed' | 'error-remove'> {
  if (!auth.signedIn) {
    clearDeviceSaves([ref])
    return 'removed'
  }
  try {
    const res = await fetch(`/api/v1/me/saved/gone/${ref}`, { method: 'DELETE', credentials: 'same-origin' })
    return res.ok ? 'removed' : 'error-remove'
  } catch {
    return 'error-remove'
  }
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
    // Stessa porta della lettura: un'istantanea che il parse scarterebbe non si scrive.
    const snap = entry.snap ?? validateSnap(item.live)
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
    if (auth.signedIn) return await toggleAccount(eventId)
    const current = readStorage()
    if (includes(current, eventId)) {
      commit(current.filter((e) => e.id !== eventId && e.c !== eventId))
      return 'removed'
    }
    // D-06: al tetto non cambia nulla e non pulsa; l'avviso lo mostra il cuore.
    if (current.length >= GUEST_CAP) return 'cap'
    pulse += 1
    commit([...current, { id: eventId, savedAt: new Date().toISOString(), snap: null }])
    resolveInBackground(eventId)
    return 'saved'
  } finally {
    pending.delete(eventId)
  }
}
