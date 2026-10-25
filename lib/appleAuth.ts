import { createPrivateKey, sign, type KeyObject } from 'node:crypto'

// Accesso con Apple (Fase 25). Helper SOLO server, usati da lib/auth.ts. Quattro
// regole:
//
// - Il client secret di Apple e' un JWT ES256 firmato a runtime con la chiave
//   .p8 (D-16): niente stringa da sei mesi da ruotare a mano. Vive poco (un'ora)
//   e si ri-firma quando restano meno di dieci minuti.
// - Qui si parla di NOMI di variabili, mai di valori: nessuna funzione di
//   questo file scrive in un log la chiave, il JWT o un identificativo.
// - La revoca (piano 03) si basa su appleConfigured(), cioe' sulla
//   configurazione, non sull'interruttore: se l'interruttore e' spento ma le
//   chiavi ci sono, eliminare un account deve comunque revocare il token.
// - Nessun import da ./auth: lib/auth.ts importa questo file, un ciclo
//   romperebbe l'avvio pigro. Che nessun codice client lo raggiunga lo
//   controlla check:browser-bundle (SERVER_ONLY_MODULES).

export const APPLE_ISSUER = 'https://appleid.apple.com'

const REQUIRED = ['APPLE_CLIENT_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY_B64'] as const

const TTL = 3600 // secondi; Apple ne accetta fino a 15777000, corto = meno danno se esce
const REFRESH_BEFORE = 600 // si ri-firma sotto i dieci minuti residui

// Il parse della chiave si ricorda per valore dell'ambiente: nei test si
// cambia la chiave e il risultato deve seguirla.
const parsed = new Map<string, KeyObject | null>()

function privateKey(): KeyObject | null {
  const b64 = process.env.APPLE_PRIVATE_KEY_B64 ?? ''
  if (!b64) return null
  if (parsed.has(b64)) return parsed.get(b64) ?? null
  let key: KeyObject | null = null
  try {
    const candidate = createPrivateKey(Buffer.from(b64, 'base64').toString('utf8'))
    if (candidate.asymmetricKeyType === 'ec' && candidate.asymmetricKeyDetails?.namedCurve === 'prime256v1') {
      key = candidate
    }
  } catch {
    key = null
  }
  parsed.set(b64, key)
  return key
}

/** Nomi delle variabili assenti o non valide; [] = configurato. Non scrive log, non lancia, non restituisce valori. */
export function appleMissingConfig(): string[] {
  const missing: string[] = REQUIRED.filter((name) => !process.env[name])
  if (process.env.APPLE_PRIVATE_KEY_B64 && !privateKey()) missing.push('APPLE_PRIVATE_KEY_B64')
  return missing
}

export function appleConfigured(): boolean {
  return appleMissingConfig().length === 0
}

/** [Services ID, bundle ID?]: il Services ID e' il primo (scambio del codice web). */
export function appleClientIds(): string[] {
  return [process.env.APPLE_CLIENT_ID, process.env.APPLE_APP_BUNDLE_ID].filter((id): id is string => !!id)
}

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')
const cache = new Map<string, { jwt: string; exp: number }>()

/** Client secret ES256 per un client id, in cache, ri-firmato quando sta per scadere. */
export function appleClientSecret(clientId: string, now: number = Math.floor(Date.now() / 1000)): string {
  const key = privateKey()
  if (!key) throw new Error('chiave Apple non valida')
  const kid = process.env.APPLE_KEY_ID
  const team = process.env.APPLE_TEAM_ID
  const cacheKey = `${clientId}|${kid}|${team}|${process.env.APPLE_PRIVATE_KEY_B64}`
  const hit = cache.get(cacheKey)
  if (hit && hit.exp - now > REFRESH_BEFORE) return hit.jwt
  const head = b64url(JSON.stringify({ alg: 'ES256', kid }))
  const body = b64url(JSON.stringify({ iss: team, iat: now, exp: now + TTL, aud: APPLE_ISSUER, sub: clientId }))
  const signature = sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' })
  const jwt = `${head}.${body}.${b64url(signature)}`
  cache.set(cacheKey, { jwt, exp: now + TTL })
  return jwt
}
