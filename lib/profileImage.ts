// Foto del profilo Google (D-20). E' un indirizzo che il browser dell'utente
// carica da solo, quindi lo si accetta solo se e' davvero di Google: https,
// nome host che finisce in ".googleusercontent.com", niente credenziali.
// Tutto il resto diventa null e l'avatar mostra l'iniziale. Si applica due
// volte: prima di salvarlo (hook in lib/auth.ts) e prima di servirlo.
const MAX_LENGTH = 1000 // come image_url degli eventi

export function googleProfileImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  if (!url.hostname.endsWith('.googleusercontent.com')) return null
  return url.href
}
