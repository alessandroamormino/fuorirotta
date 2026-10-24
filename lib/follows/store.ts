'use client'

/**
 * Cosa segue l'utente (Fase 23), per tutta l'app: bottoni Segui, rail, finestra
 * di benvenuto e /account leggono lo stesso modulo. Singleton di modulo letto
 * con useSyncExternalStore, MAI un Context (stessa scelta di lib/saved/store.ts:
 * il popup della mappa e' una createRoot a parte). Gli ospiti non scrivono
 * nulla da nessuna parte: i follow esistono solo per un account.
 *
 * Idratazione: gli snapshot del server sono `false`/`null`/'pending', uguali per
 * tutti, quindi HTML del server e primo render del client coincidono (React 418).
 * La lista sta SOLO in memoria, mai in localStorage o sessionStorage: su un
 * computer condiviso quella di chi e' uscito non deve restare.
 */
import { useSyncExternalStore } from 'react'
import { followId, sortFollows, type FollowItem, type FollowKind } from './keys'

export type FollowResult = 'followed' | 'unfollowed' | 'busy' | 'cap' | 'error-follow' | 'error-unfollow'
type Auth = { enabled: boolean | null; signedIn: boolean }
type Status = 'pending' | 'ready' | 'error'

let auth: Auth = { enabled: null, signedIn: false }
// followId -> voce. null = non ancora caricata. Sempre una Map NUOVA a ogni modifica.
let items: ReadonlyMap<string, FollowItem> | null = null
let status: Status = 'pending'
// Cresce a ogni cambio di modo: una risposta arrivata dopo l'uscita non riempie la lista di nessuno.
let authEpoch = 0
const pending = new Set<string>()
const listeners = new Set<() => void>()
// Lista ordinata, ricostruita solo quando la Map cambia (identita' nuova a ogni modifica).
let listCache: readonly FollowItem[] | null = null

const emit = () => listeners.forEach((l) => l())

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function setItems(next: ReadonlyMap<string, FollowItem> | null, nextStatus: Status = status): void {
  items = next
  status = nextStatus
  listCache = null
  emit()
}

export function setFollowAuth(state: Auth): void {
  const modeChanged = state.signedIn !== auth.signedIn
  const enabledChanged = state.enabled !== auth.enabled
  if (!modeChanged && !enabledChanged) return
  auth = state
  if (modeChanged) {
    authEpoch += 1
    pending.clear()
    items = null
    status = 'pending'
    listCache = null
  }
  emit()
}

export function followAuth(): Auth {
  return auth
}

/** Per i componenti: si ridisegnano quando l'interruttore o il modo cambiano. Server: stato da ospite. */
export function useFollowAuth(): Auth {
  return useSyncExternalStore(
    subscribe,
    () => auth,
    () => GUEST
  )
}
const GUEST: Auth = { enabled: null, signedIn: false }

/** Carica la lista dal server. Senza accesso non fa nulla. Restituisce se la finestra di benvenuto e' gia' stata mostrata. */
export async function loadFollows(): Promise<{ onboarded: boolean } | null> {
  if (!auth.signedIn) return null
  const epoch = authEpoch
  try {
    const res = await fetch('/api/v1/me/follows', { credentials: 'same-origin', cache: 'no-store' })
    if (epoch !== authEpoch) return null
    if (!res.ok) {
      setItems(items, 'error')
      return null
    }
    const json = (await res.json()) as { onboarded?: unknown; follows?: unknown }
    if (epoch !== authEpoch) return null
    if (!Array.isArray(json.follows)) {
      setItems(items, 'error')
      return null
    }
    const next = new Map<string, FollowItem>()
    for (const f of json.follows as FollowItem[]) {
      if (f && typeof f.kind === 'string' && typeof f.key === 'string') next.set(followId(f.kind, f.key), f)
    }
    // Le chiavi con una richiesta in volo vincono sulla fotografia: il server non l'ha ancora vista.
    for (const id of pending) {
      const cur = items?.get(id)
      if (cur) next.set(id, cur)
      else next.delete(id)
    }
    setItems(next, 'ready')
    return { onboarded: json.onboarded === true }
  } catch {
    if (epoch === authEpoch) setItems(items, 'error')
    return null
  }
}

/** Seleziona un booleano: ogni bottone si ridisegna solo quando cambia il suo. */
export function useIsFollowing(kind: FollowKind, key: string): boolean {
  const id = followId(kind, key)
  return useSyncExternalStore(
    subscribe,
    () => items?.has(id) === true,
    () => false
  )
}

export function useFollowList(): readonly FollowItem[] | null {
  return useSyncExternalStore(
    subscribe,
    () => (items === null ? null : (listCache ??= sortFollows([...items.values()]))),
    () => null
  )
}

export function useFollowsStatus(): Status {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => 'pending'
  )
}

/**
 * Segue o smette di seguire. Ottimistico: la voce cambia subito e, se il server
 * rifiuta, torna com'era SOLO quella chiave e solo se l'utente e' lo stesso.
 * 'busy' = nessun effetto (lista non pronta o stessa chiave gia' in volo).
 */
export async function setFollowed(kind: FollowKind, key: string, chip: string, on: boolean): Promise<FollowResult> {
  const id = followId(kind, key)
  if (status === 'error') void loadFollows() // un errore di rete non lascia il bottone morto per sempre
  if (!auth.signedIn || items === null || status !== 'ready' || pending.has(id)) return 'busy'
  const before = items.get(id)
  if ((before !== undefined) === on) return on ? 'followed' : 'unfollowed'

  const epoch = authEpoch
  const next = new Map(items)
  if (on) next.set(id, { kind, key, label: chip })
  else next.delete(id)
  setItems(next)
  pending.add(id)

  const rollBack = () => {
    if (epoch !== authEpoch || items === null) return
    const restored = new Map(items)
    if (before) restored.set(id, before)
    else restored.delete(id)
    setItems(restored)
  }
  try {
    const res = await fetch('/api/v1/me/follows', {
      method: on ? 'PUT' : 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, key }),
    })
    if (res.ok) {
      if (on && epoch === authEpoch && items?.has(id)) {
        // L'etichetta buona la dice il server (nome del comune, della provincia).
        const label = ((await res.json().catch(() => null)) as { label?: unknown } | null)?.label
        if (typeof label === 'string' && label !== chip) setItems(new Map(items).set(id, { kind, key, label }))
      }
      return on ? 'followed' : 'unfollowed'
    }
    rollBack()
    return res.status === 409 ? 'cap' : on ? 'error-follow' : 'error-unfollow'
  } catch {
    rollBack()
    return on ? 'error-follow' : 'error-unfollow'
  } finally {
    // Dopo un cambio di utente pending e' gia' stato svuotato: togliere la chiave qui e' innocuo.
    pending.delete(id)
  }
}

export async function toggleFollow(kind: FollowKind, key: string, chip: string): Promise<FollowResult> {
  return setFollowed(kind, key, chip, items?.has(followId(kind, key)) !== true)
}
