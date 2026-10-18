// Un'unica regola per il nome visualizzato (D-09), usata dagli hook di
// lib/auth.ts, dalle rotte /api/v1/me/* e dal modulo del client. Pura, senza
// import: vale uguale sul server e nel browser.
//
// Si contano PUNTI DI CODICE (Array.from), dopo normalizzazione NFC e trim,
// perche' e' l'unita' con cui Postgres conta VARCHAR(50): length conta unita'
// UTF-16 e vedrebbe un'emoji come due, rifiutando un nome che il database
// accetterebbe, o tagliandone uno a meta' di una coppia surrogata.

export const DISPLAY_NAME_MAX = 50

const FALLBACK_NAME = 'Utente'

// Caratteri di controllo (tra cui NUL, che Postgres rifiuta in un text con un
// errore invece di un 400) e gli override bidirezionali (U+202E rovescia il
// testo che segue). Gli altri Cf (ZWJ, selettori di variante) restano: servono
// alle sequenze emoji.
const FORBIDDEN = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u
const FORBIDDEN_ALL = new RegExp(FORBIDDEN.source, 'gu')

export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFC').trim()
}

function codePoints(text: string): string[] {
  return Array.from(text)
}

// Taglia a DISPLAY_NAME_MAX punti di codice senza spezzare una coppia
// surrogata, e ripulisce gli spazi che il taglio puo' lasciare in coda.
function clip(text: string): string {
  return codePoints(text.replace(FORBIDDEN_ALL, '')).slice(0, DISPLAY_NAME_MAX).join('').trim()
}

export function isValidDisplayName(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false
  const text = normalizeDisplayName(raw)
  if (FORBIDDEN.test(text)) return false
  const length = codePoints(text).length
  return length >= 1 && length <= DISPLAY_NAME_MAX
}

// Il nome che arriva da Google non e' controllato da noi: puo' essere vuoto,
// mancante o lungo piu' di 50. Si tronca, e se non resta nulla si ripiega sulla
// parte locale dell'e-mail, poi su 'Utente'.
export function displayNameFromProvider(name: unknown, email: unknown): string {
  const fromName = typeof name === 'string' ? clip(normalizeDisplayName(name)) : ''
  if (fromName) return fromName
  const local = typeof email === 'string' ? email.split('@')[0] : ''
  return clip(normalizeDisplayName(local)) || FALLBACK_NAME
}

// Iniziale per il cerchio dell'avatar: primo punto di codice del nome, altrimenti
// dell'e-mail, in maiuscolo secondo l'italiano.
export function displayInitial(name: unknown, email: unknown): string {
  const source = typeof name === 'string' && normalizeDisplayName(name)
    ? normalizeDisplayName(name)
    : typeof email === 'string' ? normalizeDisplayName(email) : ''
  const first = codePoints(source)[0]
  return first ? first.toLocaleUpperCase('it') : FALLBACK_NAME[0]
}
