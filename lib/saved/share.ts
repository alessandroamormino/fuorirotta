/**
 * Il link di condivisione della lista salvata (Fase 24, SHARE-02). Solo server:
 * node:crypto e prisma vivono qui e non in lib/saved/view.ts (raggiungibile dal browser).
 *
 * L'indirizzo /l/{codice} e' una capability: chi lo ha legge la lista in arrivo del
 * proprietario. E' un segreto SEPARATO da quello del calendario (lib/saved/feed.ts).
 * Ogni link che non sia vivo (codice malformato, ignoto, disattivato, sostituito,
 * account cancellato, accesso spento) e' la STESSA pagina morta: una riga cancellata
 * o sovrascritta non lascia nulla che distingua "non esiste" da "non piu' valido".
 */
import { randomBytes } from 'node:crypto'
import type { Metadata } from 'next'
import { listAccountItems } from './resolve'
import { buildSharedView, type SharedEvent } from './view'

/** 22 caratteri base64url (128 bit). */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{22}$/

export function newShareToken(): string {
  return randomBytes(16).toString('base64url')
}

/**
 * Gli eventi in arrivo che un estraneo vede ORA: la stessa funzione serve la pagina
 * pubblica e il conteggio della finestra del proprietario, cosi' i due numeri non
 * possono divergere.
 */
export async function listSharedEvents(userId: string, now: Date = new Date()): Promise<SharedEvent[]> {
  return buildSharedView(await listAccountItems(userId), now)
}

// Qui e non in not-found.tsx: la pagina viva la riusa quando il codice non c'e' (generateMetadata)
// senza un export non standard su un file speciale.
export const SHARE_DEAD_METADATA: Metadata = {
  title: 'Link non disponibile',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}
